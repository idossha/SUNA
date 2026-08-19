/**
 * Drive probe — the AI-change review view (feature-plan-11 §11e–§11g).
 *
 * Drives the real surfaces end to end: a baseline is written to
 * manuscript/revisions.json, the manuscript is edited the way an agent's
 * write edits it, and the assertions read the app's own DOM — the green
 * addition marks, the red removal widgets, the review bar's count — then
 * exercise accept and reject and check the file and the sidecar afterwards.
 *
 * It also proves the two things that would quietly ruin a manuscript: removed
 * text must never be part of the document (or it reaches exports and word
 * counts), and turning the setting off must remove the paint.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/ai-diff-review.mjs
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')
  const manuscriptPath = join(rootDir, 'manuscript', 'manuscript.md')
  const revisionsPath = join(rootDir, 'manuscript', 'revisions.json')
  const original = readFileSync(manuscriptPath, 'utf8')

  let commentId = null
  const failures = []
  const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`)
    else {
      console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
      failures.push(name)
    }
  }

  // A word to replace and a place to add one, both unique so the edit is exact.
  const unique = (s) => original.indexOf(s) !== -1 && original.indexOf(s) === original.lastIndexOf(s)
  const line = original
    .split('\n')
    .find((l) => /^[A-Za-z(]/.test(l) && l.trim().length >= 55 && unique(l))
  assert(line !== undefined, 'no usable prose line in the example manuscript')
  const word = line.trim().split(/\s+/).find((w) => /^[a-z]{6,}$/.test(w) && unique(w))
  assert(word !== undefined, `no unique lowercase word in: ${line}`)

  try {
    await ctx.evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(manuscriptPath)})`)
    await ctx.sleep(1500)

    // The agent's run: baseline first, then the file changes underneath.
    const newLine = `${line.replace(word, 'REPLACEMENT')} A sentence the agent added.`
    const edited = original.replace(line, newLine)
    assert(edited !== original, 'the simulated agent edit changed nothing')
    await ctx.evalJs(`(async () => {
      await window.__sunaDev.revisionsStore.getState().open(
        'manuscript.md', 'Comment fix — probe', ${JSON.stringify(original)}
      )
    })()`)
    writeFileSync(manuscriptPath, edited, 'utf8')
    await ctx.waitFor(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})?.includes('A sentence the agent added.')`,
      { timeoutMs: 15000, desc: "the agent's edit reaching the buffer" }
    )
    await ctx.sleep(900)

    check('revisions.json holds the pre-run baseline', existsSync(revisionsPath))
    if (existsSync(revisionsPath)) {
      const file = JSON.parse(readFileSync(revisionsPath, 'utf8'))
      check('the baseline is the text from before the run',
        file.revisions?.[0]?.base === original,
        `stored ${file.revisions?.[0]?.base?.length} chars, original is ${original.length}`)
      check('the manuscript on disk carries NO diff markers',
        !readFileSync(manuscriptPath, 'utf8').includes('<<<') &&
          !readFileSync(manuscriptPath, 'utf8').includes('REPLACEMENT<'))
    }

    // ---- the paint ---------------------------------------------------------
    const paint = await ctx.evalJs(`(() => {
      const ins = [...document.querySelectorAll('.cm-content .cm-sunaDiff-ins')].map((e) => e.textContent)
      const del = [...document.querySelectorAll('.cm-content .cm-sunaDiff-del')].map((e) => e.textContent)
      return { ins, del }
    })()`)
    check('additions are marked green in the editor', paint.ins.length > 0, JSON.stringify(paint.ins))
    check('removals are shown in red in the editor', paint.del.length > 0, JSON.stringify(paint.del))
    check('the replaced word is shown as removed',
      paint.del.some((t) => t.includes(word)), JSON.stringify(paint.del))
    check('the new word is marked as added',
      paint.ins.some((t) => t.includes('REPLACEMENT')), JSON.stringify(paint.ins))
    check('marks are word-sized, not whole lines',
      paint.ins.every((t) => t.length < 60), JSON.stringify(paint.ins))

    // The removal widget must not be part of the document text at all.
    const buffer = await ctx.evalJs(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})`
    )
    check('removed text is NOT in the document (exports and word counts stay clean)',
      !buffer.includes(word), `"${word}" leaked back into the buffer`)
    check('the buffer still equals the file on disk',
      buffer === readFileSync(manuscriptPath, 'utf8'))

    const bar = await ctx.evalJs(`(() => {
      const el = document.querySelector('.editor-review')
      return el === null ? null : el.textContent
    })()`)
    check('the review bar names the run and counts the changes',
      bar !== null && /AI change/.test(bar) && bar.includes('Comment fix'), JSON.stringify(bar))

    await ctx.screenshot('/tmp/suna-ai-diff.png').catch(() => {})

    // ---- the setting -------------------------------------------------------
    await ctx.evalJs(`window.__sunaDev.settingsStore.getState().setGlobal('review.aiDiffs', 'off')`)
    await ctx.sleep(700)
    const off = await ctx.evalJs(`({
      marks: document.querySelectorAll('.cm-content .cm-sunaDiff-ins, .cm-content .cm-sunaDiff-del').length,
      bar: !!document.querySelector('.editor-review')
    })`)
    check('review.aiDiffs=off hides the paint', off.marks === 0, `${off.marks} marks still painted`)
    check('review.aiDiffs=off hides the review bar too', off.bar === false)

    await ctx.evalJs(`window.__sunaDev.settingsStore.getState().setGlobal('review.aiDiffs', 'inline')`)
    await ctx.sleep(700)
    const back = await ctx.evalJs(
      `document.querySelectorAll('.cm-content .cm-sunaDiff-ins, .cm-content .cm-sunaDiff-del').length`
    )
    check('turning it back on restores the paint', back > 0, `${back} marks`)

    // A comment over the SAME prose must not wash out the diff colours: the
    // anchor is a TRAIL (text-decoration), never a background. This is the
    // exact collision that made a commented, AI-edited sentence unreadable.
    const live = readFileSync(manuscriptPath, 'utf8')
    const quote = newLine.slice(0, 60)
    assert(live.includes(quote), 'the edited sentence is not on disk to anchor to')
    commentId = await ctx.evalJs(`(async () => {
      const store = window.__sunaDev.commentsStore.getState()
      const c = await store.add(
        { kind: 'section', path: 'manuscript.md', anchor: {
            quote: ${JSON.stringify(quote)}, prefix: '', suffix: '' } },
        'revise this sentence'
      )
      return c === null ? null : c.id
    })()`)
    check('a comment can be anchored over the AI-edited sentence', commentId !== null)
    await ctx.sleep(900)

    const anchorStyle = await ctx.evalJs(`(() => {
      const el = document.querySelector('.cm-content .cmt-anchor')
      if (!el) return null
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, line: cs.textDecorationLine, style: cs.textDecorationStyle }
    })()`)
    check('the comment anchor is rendered at all', anchorStyle !== null,
      'no .cmt-anchor in the editor — the trail assertion below would be vacuous')
    check('a comment anchor draws a trail, not a background wash',
      anchorStyle !== null &&
        anchorStyle.line.includes('underline') &&
        (anchorStyle.bg === 'rgba(0, 0, 0, 0)' || anchorStyle.bg === 'transparent'),
      JSON.stringify(anchorStyle))
    check('the diff marks keep their own background under the comment',
      (await ctx.evalJs(`(() => {
        const el = document.querySelector('.cm-content .cm-sunaDiff-ins')
        if (!el) return false
        const bg = getComputedStyle(el).backgroundColor
        return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
      })()`)) === true)

    // ---- the per-hunk popover ---------------------------------------------
    const markBox = await ctx.evalJs(`(() => {
      const el = document.querySelector('.cm-content .cm-sunaDiff-ins')
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    check('an addition mark is on screen to click', markBox !== null)
    if (markBox !== null) {
      await ctx.click(markBox.x, markBox.y)
      await ctx.sleep(500)
      const pop = await ctx.evalJs(`(() => {
        const el = document.querySelector('.cm-sunaDiff-actions')
        return el === null ? null : {
          text: el.textContent,
          buttons: [...el.querySelectorAll('button')].map((b) => b.textContent)
        }
      })()`)
      check('clicking a change opens its Accept/Reject popover',
        pop !== null && pop.buttons.includes('Accept') && pop.buttons.includes('Reject'),
        JSON.stringify(pop))

      const beforePopover = await ctx.evalJs(
        `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})`
      )
      const rejectBtn = await ctx.evalJs(`(() => {
        const b = [...document.querySelectorAll('.cm-sunaDiff-action')].find((e) => e.textContent === 'Reject')
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`)
      if (rejectBtn !== null) {
        await ctx.click(rejectBtn.x, rejectBtn.y)
        await ctx.sleep(1200)
        const afterPopover = await ctx.evalJs(
          `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})`
        )
        check('Reject in the popover edits the prose back', afterPopover !== beforePopover)
        check('the popover closes after acting',
          (await ctx.evalJs(`!document.querySelector('.cm-sunaDiff-actions')`)) === true)
      }
    }

    // ---- reject one hunk, then accept the rest -----------------------------
    const beforeReject = readFileSync(manuscriptPath, 'utf8')
    await ctx.evalJs(`document.querySelector('.cm-content')?.focus()`)
    // Alt-] walks to the first change, Alt-n rejects it (modifier bit 1 = Alt).
    await ctx.key(']', 'BracketRight', 1)
    await ctx.sleep(250)
    await ctx.key('n', 'KeyN', 1)
    await ctx.sleep(1400)
    const afterReject = await ctx.evalJs(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptPath)})`
    )
    check('rejecting a hunk puts the original words back',
      afterReject.includes(word) && afterReject !== beforeReject,
      'the rejected hunk did not restore')

    const accepted = await ctx.evalJs(`(async () => {
      await window.__sunaDev.revisionsStore.getState().close('manuscript.md')
      return true
    })()`)
    check('accepting all closes the revision', accepted === true)
    await ctx.sleep(800)
    const cleared = await ctx.evalJs(
      `document.querySelectorAll('.cm-content .cm-sunaDiff-ins, .cm-content .cm-sunaDiff-del').length`
    )
    check('a closed revision leaves no paint behind', cleared === 0, `${cleared} marks`)
  } finally {
    if (commentId !== null) {
      await ctx
        .evalJs(`(async () => {
          const store = window.__sunaDev.commentsStore.getState()
          if (typeof store.remove === 'function') await store.remove(${JSON.stringify('COMMENT_ID')})
        })()`.replace('COMMENT_ID', commentId))
        .catch(() => {})
    }
    writeFileSync(manuscriptPath, original, 'utf8')
    rmSync(revisionsPath, { force: true })
    await ctx
      .evalJs(`window.__sunaDev.settingsStore.getState().setGlobal('review.aiDiffs', 'inline')`)
      .catch(() => {})
    await ctx.sleep(800)
  }

  if (failures.length > 0) throw new Error(`ai-diff probe failed: ${failures.join(', ')}`)
  console.log('AI diff review probe: all checks passed')
}
