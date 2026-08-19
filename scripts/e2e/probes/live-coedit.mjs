/**
 * Drive probe — an external edit in TWO places must leave the prose between
 * them alone, in the running app.
 *
 * The unit tests prove DocSessionCore emits two changes; this proves the
 * consequence a human would notice, through the whole real pipeline: the
 * project tree watcher, checkDisk's re-read, diffSpans, the mapped
 * ChangeSet, and CodeMirror's own decoration mapping.
 *
 * A comment highlight is the instrument. comments/anchorExtension MAPS its
 * anchors through incoming changes (it only re-locates when the comment list
 * itself changes), and it drops any anchor an edit collapses. So a highlight
 * that still shows its original words after a two-place edit is proof the
 * paragraph it sits in was never deleted and reinserted — which is exactly
 * what the old single-span diff did to everything between the first and last
 * difference.
 *
 * A second scenario covers the three-way merge (§11c): the author is typing
 * — buffer dirty, nothing saved — when the file changes underneath. An edit in
 * a paragraph they are not in must land silently, with their unsaved text
 * untouched and no banner. Before the merge that combination stopped dead at
 * an all-or-nothing prompt whose both answers destroyed somebody's work.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/live-coedit.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** W3C-style quote anchor, matching packages/core/src/anchor.ts's shape. */
function anchorFor(text, quote) {
  const at = text.indexOf(quote)
  assert(at !== -1, `quote not found in the manuscript: ${JSON.stringify(quote)}`)
  return {
    quote,
    prefix: text.slice(Math.max(0, at - 32), at),
    suffix: text.slice(at + quote.length, at + quote.length + 32)
  }
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')
  const manuscriptPath = join(rootDir, 'manuscript', 'manuscript.md')
  const commentsPath = join(rootDir, 'manuscript', 'comments.json')
  const original = readFileSync(manuscriptPath, 'utf8')
  const originalComments = readFileSync(commentsPath, 'utf8')

  // Three prose lines in document order: one to edit early, one to guard in
  // the middle, one to edit late. The manuscript is hard-wrapped, so lines
  // are short — each is checked for uniqueness rather than assumed unique.
  const unique = (needle) =>
    original.indexOf(needle) !== -1 && original.indexOf(needle) === original.lastIndexOf(needle)
  const prose = original
    .split('\n')
    .filter((l) => /^[A-Za-z(]/.test(l) && l.trim().length >= 55 && unique(l))
  assert(prose.length >= 6, `need at least 6 usable prose lines, found ${prose.length}`)
  const early = prose[1]
  const middle = prose[Math.floor(prose.length / 2)]
  const late = prose[prose.length - 2]
  assert(new Set([early, middle, late]).size === 3, 'early/middle/late lines must be distinct')
  assert(
    original.indexOf(early) < original.indexOf(middle) &&
      original.indexOf(middle) < original.indexOf(late),
    'the three lines are not in document order'
  )

  const guardQuote = middle.trim().slice(0, 40)
  assert(unique(guardQuote), `guard quote is not unique: ${JSON.stringify(guardQuote)}`)
  const failures = []
  const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`)
    else {
      console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
      failures.push(name)
    }
  }

  let commentId = null
  try {
    await ctx.evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(manuscriptPath)})`)
    await ctx.sleep(1500)

    commentId = await ctx.evalJs(`(async () => {
      const store = window.__sunaDev.commentsStore.getState()
      const c = await store.add(
        { kind: 'section', path: 'manuscript.md', anchor: ${JSON.stringify(anchorFor(original, guardQuote))} },
        'guard comment for the live-coedit probe'
      )
      return c === null ? null : c.id
    })()`)
    assert(commentId, 'could not create the guard comment')
    await ctx.sleep(800)

    // Bring the highlight into the rendered viewport — CodeMirror only builds
    // DOM for what is on screen, so an off-screen mark is absent either way.
    const sel = `[data-comment-id=${JSON.stringify(commentId)}]`
    await ctx.evalJs(`(() => {
      const el = document.querySelector('.cm-content ${sel}')
      if (el !== null) el.scrollIntoView({ block: 'center' })
    })()`)
    await ctx.sleep(600)

    const before = await ctx.evalJs(
      `document.querySelector('.cm-content ${sel}')?.textContent ?? null`
    )
    check('the guard comment is highlighted in the editor before the edit', before !== null, 'no highlight element')
    assert(before !== null, 'cannot run the probe without a visible guard highlight')

    // ONE external write carrying TWO distant edits — a write_manuscript, a
    // git checkout, or another editor saving. Not two sequential edits: the
    // point is a single reload whose diff must stay multi-span.
    const edited = original
      .replace(early, `${early} Sentence added near the top by an external writer.`)
      .replace(late, `${late} Sentence added near the bottom by an external writer.`)
    assert(edited !== original, 'the two-place edit changed nothing')
    assert(edited.includes(middle), 'the middle paragraph must be byte-identical in the new file')
    writeFileSync(manuscriptPath, edited, 'utf8')

    // watcher (150 ms debounce) + checkDisk re-read + mapped dispatch
    await ctx.waitFor(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})?.includes('near the bottom by an external writer')`,
      { timeoutMs: 15000, desc: 'the external edit reaching the open buffer' }
    )
    await ctx.sleep(800)

    const buffer = await ctx.evalJs(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})`
    )
    check('the open buffer converged on the new file', buffer === edited,
      buffer === null ? 'no session' : `buffer length ${buffer.length} vs disk ${edited.length}`)

    // `meta` on the seam is the zustand hook itself — read it via getState.
    const meta = await ctx.evalJs(
      `JSON.stringify(window.__sunaDev.docSessions.meta.getState().meta.get(${JSON.stringify(manuscriptPath)}) ?? null)`
    )
    check('a clean buffer took the edit silently, with no divergence banner',
      meta !== null && JSON.parse(meta).diverged === false, meta)

    const after = await ctx.evalJs(
      `document.querySelector('.cm-content ${sel}')?.textContent ?? null`
    )
    check(
      'the untouched middle paragraph kept its comment highlight',
      after !== null,
      'highlight vanished — its anchor was collapsed by the reload'
    )
    check(
      'the highlight still covers exactly the same words',
      after === before,
      `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
    )

    const stillAttached = await ctx.evalJs(`(() => {
      const c = window.__sunaDev.commentsStore.getState().comments
        .find((x) => x.id === ${JSON.stringify(commentId)})
      return c === undefined ? null : { detached: c.detached, quote: c.target.anchor.quote }
    })()`)
    check('the guard comment is still attached to its original quote',
      stillAttached !== null && stillAttached.detached === false && stillAttached.quote === guardQuote,
      JSON.stringify(stillAttached))
    // ---- 2. three-way merge into a DIRTY buffer (§11c) -------------------
    // Type into the editor without saving, so the buffer and disk genuinely
    // disagree, then change a different paragraph on disk.
    const caret = await ctx.evalJs(`(() => {
      const line = [...document.querySelectorAll('.cm-content .cm-line')].find((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.top > 120 && r.bottom < window.innerHeight - 60 &&
          el.textContent.includes(${JSON.stringify(guardQuote.slice(0, 20))})
      })
      if (!line) return null
      const r = line.getBoundingClientRect()
      return { x: r.left + 4, y: r.top + r.height / 2 }
    })()`)
    check('found the guard line to type into', caret !== null)
    if (caret !== null) {
      await ctx.click(caret.x, caret.y)
      await ctx.insertText('UNSAVED ')
      await ctx.sleep(200)

      const dirty = await ctx.evalJs(
        `window.__sunaDev.docSessions.meta.getState().meta.get(${JSON.stringify(manuscriptPath)})?.dirty === true`
      )
      check('the buffer is dirty before the external write', dirty === true)

      // A different paragraph changes on disk, the way an agent's write does.
      const onDisk = readFileSync(manuscriptPath, 'utf8')
      const merged = onDisk.replace(early, `${early} Added while the author was typing.`)
      writeFileSync(manuscriptPath, merged, 'utf8')

      await ctx.waitFor(
        `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})?.includes('while the author was typing')`,
        { timeoutMs: 15000, desc: 'the merge reaching the dirty buffer' }
      )
      await ctx.sleep(600)

      const after2 = await ctx.evalJs(
        `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})`
      )
      check('their edit merged into the dirty buffer', after2.includes('while the author was typing'))
      check('our unsaved typing survived the merge', after2.includes('UNSAVED '),
        'the human\'s in-progress text was lost')

      const meta2 = await ctx.evalJs(
        `JSON.stringify(window.__sunaDev.docSessions.meta.getState().meta.get(${JSON.stringify(manuscriptPath)}) ?? null)`
      )
      check('a merge in a different paragraph raised no conflict banner',
        meta2 !== null && JSON.parse(meta2).diverged === false, meta2)
      check('no divergence banner is on screen',
        (await ctx.evalJs(`!!document.querySelector('.editor-diverged')`)) === false)
    }

  } finally {
    writeFileSync(manuscriptPath, original, 'utf8')
    writeFileSync(commentsPath, originalComments, 'utf8')
    if (commentId !== null) {
      await ctx.evalJs(`(async () => {
        const store = window.__sunaDev.commentsStore.getState()
        if (typeof store.remove === 'function') await store.remove(${JSON.stringify(commentId)})
      })()`).catch(() => {})
    }
    await ctx.sleep(1200)
  }

  if (failures.length > 0) throw new Error(`live-coedit probe failed: ${failures.join(', ')}`)
  console.log('live co-edit probe: all checks passed')
}
