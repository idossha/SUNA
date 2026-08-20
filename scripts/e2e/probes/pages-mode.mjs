/**
 * Drive probe — Pages mode in the manuscript and letter tabs
 * (feature-plan-13 §B).
 *
 * The claims worth checking are the ones a unit test cannot reach, because
 * they are about the real app's layout and the real exporter:
 *
 *   1. ⌘E cycles source -> reading -> pages, and the button says so.
 *   2. Pages mode shows REAL pages, and its page count matches what the
 *      exporter produces for the same document — that is the whole promise of
 *      the mode ("these are the export's own pages"), so it is asserted
 *      against a fresh export rather than assumed.
 *   3. There is NO editor in pages mode. Not a disabled one — none. A
 *      disabled CodeMirror still takes focus and shows a caret, which invites
 *      typing that silently does nothing.
 *   4. The pages have a BOUNDED scrollport, so "fit the whole page" has a
 *      height to fit into. Inside an `overflow-y: auto` ancestor the client
 *      height is the content height, the fit silently degrades to fit-width,
 *      and a page end is never on screen — which would defeat the point.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs run scripts/e2e/probes/pages-mode.mjs
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** How Vite exposes a workspace package's source to the running page. */
const FORMATTER_URL = `/@fs${join(ROOT, 'packages', 'formatter', 'src', 'index.ts')}`

const json = (v) => JSON.stringify(v)

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** The label of the lit segment in the view switch. */
const CURRENT_MODE = `document.querySelector('.seg__option.is-on')?.textContent ?? null`

/** Click the named segment. The control shows every mode, so this is one click. */
async function pickMode(ctx, want) {
  await ctx.evalJs(`(() => {
    const option = [...document.querySelectorAll('.seg__option')].find((b) => b.textContent === ${json(want)})
    if (option) option.click()
    return 1
  })()`)
  await ctx.sleep(400)
  return (await ctx.evalJs(CURRENT_MODE)) === want
}

/** Wait for the pages to land — the first render is a real print pass. */
async function waitForPages(ctx, desc) {
  return ctx.waitFor(`document.querySelectorAll('.paged-doc__page').length`, {
    timeoutMs: 45000,
    intervalMs: 500,
    desc
  })
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  // Opens the example project itself when none is open, rather than asserting
  // on ambient state: this probe should be runnable against a bare `--boot`,
  // and it must not depend on what a previous probe left behind.
  if ((await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)) === null) {
    await ctx.evalJs(`window.__sunaDev.projectStore.getState().openExampleProject()`)
  }
  const rootDir = await ctx.waitFor(`window.__sunaDev.projectStore.getState().rootDir`, {
    timeoutMs: 40000,
    desc: 'an open project'
  })
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')

  const failures = []
  const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`)
    else {
      console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
      failures.push(name)
    }
  }

  // ------------------------------------------------------ 1. the mode cycles
  await ctx.evalJs(`window.__sunaDev.dock.openManuscriptTab(${json(rootDir)})`)
  await ctx.waitFor(`!!document.querySelector('.seg__option')`, {
    timeoutMs: 20000,
    desc: 'the manuscript tab’s view switch'
  })

  const offered = await ctx.evalJs(`[...document.querySelectorAll('.seg__option')].map((b) => b.textContent)`)
  check(
    'the view switch offers all three modes at once, not one at a time',
    json(offered) === json(['Source', 'Reading', 'Pages']),
    `offered ${json(offered)}`
  )
  check(
    'exactly one segment is lit',
    (await ctx.evalJs(`document.querySelectorAll('.seg__option.is-on').length`)) === 1
  )

  // Every mode is reachable in ONE click — the reason the cycling button was
  // replaced, and the thing a segmented control has to actually deliver.
  const reachable = []
  for (const want of ['Pages', 'Source', 'Reading']) {
    if (await pickMode(ctx, want)) reachable.push(want)
  }
  check(
    'every mode is one click away',
    json(reachable) === json(['Pages', 'Source', 'Reading']),
    `reached ${json(reachable)}`
  )

  // ⌘E still cycles, so the shortcut people already use did not silently die.
  const before = await ctx.evalJs(CURRENT_MODE)
  await ctx.evalJs(`(() => {
    const node = document.querySelector('.mstab') || document.body
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', metaKey: true, bubbles: true }))
    return 1
  })()`)
  await ctx.sleep(400)
  const after = await ctx.evalJs(CURRENT_MODE)
  check('⌘E still moves to another mode', after !== null && after !== before, `${before} -> ${after}`)

  // ------------------------------------------------- 2/3/4. manuscript pages
  assert(await pickMode(ctx, 'Pages'), 'could not reach Pages mode from the view switch')
  const pageCount = await waitForPages(ctx, 'the manuscript’s pages')

  const layout = await ctx.evalJs(`(() => {
    const scroll = document.querySelector('.paged-doc__scroll')
    const first = document.querySelector('.paged-doc__page')
    return {
      editors: document.querySelectorAll('.cm-editor').length,
      scrollH: scroll ? scroll.clientHeight : null,
      scrollScrollH: scroll ? scroll.scrollHeight : null,
      pageH: first ? first.getBoundingClientRect().height : null,
      zoom: document.querySelector('.paged-doc__zoom-value')?.textContent ?? null
    }
  })()`)

  check('pages mode renders real pages', pageCount > 0, `page count ${pageCount}`)
  check(
    'pages mode has no editor at all — not a disabled one',
    layout.editors === 0,
    `${layout.editors} .cm-editor still mounted`
  )
  check(
    'the pages have a bounded scrollport, so fit-page has a height to fit',
    layout.scrollH !== null && layout.scrollH > 0 && layout.scrollH < layout.scrollScrollH,
    `client ${layout.scrollH} vs scroll ${layout.scrollScrollH}`
  )
  check(
    'a whole page fits on screen, which is what a page view is for',
    layout.pageH !== null && layout.scrollH !== null && layout.pageH <= layout.scrollH,
    `page ${Math.round(layout.pageH)}px in a ${layout.scrollH}px port at ${layout.zoom}`
  )

  // The count has to be the EXPORTER's, not merely plausible.
  const exported = await ctx.evalJs(`(async () => {
    try {
      const { rasterizeManuscriptFigures } = await import('/src/export/rasterizeFigures.ts')
      const state = window.__sunaDev.projectStore.getState()
      const profileId = state.manifest?.activeProfileId ?? 'suna'
      // Vite serves workspace sources under /@fs/<abs path>; a bare
      // '@suna/formatter' is not resolvable from a runtime dynamic import.
      const { getBundledProfile } = await import(${json(FORMATTER_URL)})
      const profile = getBundledProfile(profileId)
      const manuscript = window.__sunaDev.manuscriptStore.getState().manuscript
      const figurePngPaths = await rasterizeManuscriptFigures(${json(rootDir)}, manuscript, profile, {
        compress: true, cache: true
      })
      const submission = profile.manuscript.submissionFormat
      const res = await window.suna.invoke('export:preview', {
        dir: ${json(rootDir)},
        profileId,
        format: 'pdf',
        figurePngPaths,
        options: {
          doubleSpacing: submission.doubleSpacing ?? true,
          lineNumbers: submission.lineNumbers ?? true,
          pageNumbers: submission.pageNumbers ?? true,
          theme: window.__sunaDev.editorSettings.getState().editorTheme
        },
        target: 'manuscript'
      })
      // Count pages without pdf.js: every page is one /Type /Page object.
      const bytes = atob(res.data)
      return (bytes.match(/\\/Type\\s*\\/Page[^s]/g) || []).length
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) }
    }
  })()`)
  check(
    'the page count is the exporter’s own',
    typeof exported === 'number' && exported === pageCount,
    `view showed ${pageCount}, a fresh export has ${json(exported)}`
  )

  if (failures.length > 0) throw new Error(`${failures.length} check(s) failed: ${failures.join(', ')}`)
  console.log('pages-mode: all checks passed')
}
