/**
 * The reading-notes suite (ADR-008) — the whole highlight/note paradigm, driven
 * in the running app.
 *
 * Every scenario checks the FILE, not the UI's opinion of it: annotations are
 * read back in Node through a fresh pdf.js document, because the renderer holds
 * its own loaded copy and paints its own overlay, and asking it what happened
 * would let a write that never landed look successful.
 *
 * The suite exists because this feature keeps failing in the seam between the
 * DOM and the file. Both defects found so far lived there: a highlight could
 * not receive its own click (the text layer sits above it), and removing a note
 * whose page was scrolled out of view deleted the note but orphaned its
 * annotation in the PDF forever — twice over, because the removal region was
 * never captured AND the page's annotations were never read.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/pdf-notes-suite.mjs
 *
 * Or through the runner that stages the fixture: pnpm probes:pdf
 */
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const pdfjs = await import(
  require.resolve('pdfjs-dist/legacy/build/pdf.mjs', {
    paths: [new URL('../../../apps/desktop', import.meta.url).pathname]
  })
)

const json = (v) => JSON.stringify(v)
const CITEKEY = 'gunn1972'

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

// ---------------------------------------------------------------- the file --

/** Every /Highlight the FILE carries, read fresh in Node. */
async function fileHighlights(pdfPath) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)) }).promise
  const out = []
  for (let page = 1; page <= doc.numPages; page += 1) {
    const annots = await (await doc.getPage(page)).getAnnotations({ intent: 'any' })
    for (const a of annots) {
      if (a.subtype !== 'Highlight') continue
      out.push({
        page,
        color: a.color ? [...a.color].join(',') : null,
        contents: a.contentsObj?.str ?? '',
        title: a.titleObj?.str ?? '',
        quads: a.quadPoints ? a.quadPoints.length : 0
      })
    }
  }
  return out
}

/** The sidecar as it is on disk. */
function sidecar(root) {
  const path = join(root, 'references', 'notes', `${CITEKEY}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

// ---------------------------------------------------------------- the app --

const SELECT_SPAN = (index) => `(() => {
  const layer = document.querySelector('.pdfview__page[data-page="1"] .pdfview__textlayer')
  if (!layer) return { error: 'page 1 has no text layer' }
  const spans = [...layer.querySelectorAll('span')].filter((s) => (s.textContent ?? '').trim().length > 25)
  const target = spans[${index}]
  if (!target) return { error: 'no span at index ${index}' }
  const sel = window.getSelection()
  sel.removeAllRanges()
  const range = document.createRange()
  range.selectNodeContents(target)
  sel.addRange(range)
  document.querySelector('.pdfview__scroll').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  return { text: (target.textContent ?? '').slice(0, 50) }
})()`

export default async function run(ctx) {
  const { evalJs, waitFor, sleep } = ctx
  const failures = []
  let passed = 0

  await waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev' })
  const root = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(root, 'no project open — boot with --example first')
  const pdfPath = join(root, 'references', `${CITEKEY}.pdf`)
  assert(existsSync(pdfPath), `no reference PDF at ${pdfPath}`)

  /** The debounce is 700ms; give the write room to land and be flushed. */
  const settle = () => sleep(2600)

  /** Back to one clean paper with no notes, without restarting the app. */
  async function reset() {
    await evalJs(`(() => { window.__sunaDev.dock.closePanel(${json(pdfPath)}); return 1 })()`)
    await sleep(1600) // let any debounced write land on the OLD file
    rmSync(join(root, 'references', 'notes'), { recursive: true, force: true })
    const source = join(root, 'output', 'ram-pressure-stripping-at-z-1-7.pdf')
    const { copyFileSync } = await import('node:fs')
    copyFileSync(source, pdfPath)
    await evalJs(
      `window.__sunaDev.referencePdfsStore.getState().scan(${json(root)}).then(() => 'ok')`
    )
    await evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(pdfPath)}); return 1 })()`)
    await waitFor(`document.querySelectorAll('.pdfview__textlayer span').length > 20`, {
      timeoutMs: 30000,
      desc: 'text layer'
    })
    await sleep(900)
  }

  async function highlight(spanIndex, color) {
    const picked = await evalJs(SELECT_SPAN(spanIndex))
    assert(!picked.error, picked.error)
    await waitFor(`!!document.querySelector('.pdfquote')`, { timeoutMs: 8000, desc: 'popover' })
    await evalJs(
      `(() => { document.querySelector('.pdfquote__swatch[data-color="${color}"]').click(); return 1 })()`
    )
    await settle()
    return picked.text
  }

  const openRail = () =>
    evalJs(`(() => {
      const btn = document.querySelector('.pdfview__notesbtn')
      if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click()
      return 1
    })()`)

  const removeFromRail = (index = 0) =>
    evalJs(`(() => {
      const cards = [...document.querySelectorAll('.pdfnotes__list .cmt-card')]
      const card = cards[${index}]
      if (!card) return 'no card'
      const btn = [...card.querySelectorAll('.cmt__btn')].find((b) => b.textContent === 'Remove')
      btn.click()
      return 'removed'
    })()`)

  async function scenario(name, fn) {
    try {
      await reset()
      await fn()
      passed += 1
      console.log(`  PASS  ${name}`)
    } catch (error) {
      failures.push({ name, error: error.message })
      console.log(`  FAIL  ${name}\n        ${error.message}`)
    }
  }

  console.log('\nreading notes — full lifecycle\n')

  // ------------------------------------------------------------------ create
  await scenario('1. a bare highlight reaches the file, the overlay and the rail', async () => {
    await highlight(1, 'yellow')
    const inFile = await fileHighlights(pdfPath)
    assert(inFile.length === 1, `expected 1 annotation in the file, got ${inFile.length}`)
    assert(inFile[0].quads >= 8, 'annotation carries no QuadPoints')
    assert(inFile[0].contents === '', 'a bare highlight should carry no /Contents')

    const painted = await evalJs(
      `document.querySelectorAll('.pdfhl__rect:not(.pdfhl__rect--foreign)').length`
    )
    assert(painted > 0, 'nothing painted on the page')

    const file = sidecar(root)
    assert(file !== null && file.notes.length === 1, 'the sidecar has no note')
    assert(file.notes[0].body === '', 'a bare highlight should have an empty body')
  })

  await scenario('2. the note records where the annotation went, in user space', async () => {
    // Without this, removal has to consult the DOM, and the DOM only has
    // geometry for pages that are rendered.
    await highlight(1, 'yellow')
    const note = sidecar(root).notes[0]
    assert(Array.isArray(note.embed) && note.embed.length === 1, 'no embed recorded')
    assert(note.embed[0].page === 1, `embed names page ${note.embed[0].page}`)
    assert(note.embed[0].quads.length >= 8, 'embed carries no quads')
  })

  // ------------------------------------------------------------------- click
  await scenario('3. clicking a highlight opens the popover, not the text layer', async () => {
    await highlight(1, 'yellow')
    const opened = await evalJs(`(() => {
      window.getSelection().removeAllRanges()
      const rect = document.querySelector('.pdfhl__rect')
      const b = rect.getBoundingClientRect()
      const x = b.left + b.width / 2, y = b.top + b.height / 2
      const scroll = document.querySelector('.pdfview__scroll')
      for (const type of ['mousedown', 'mouseup']) {
        scroll.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }))
      }
      return true
    })()`)
    assert(opened === true)
    await sleep(500)
    const buttons = await evalJs(
      `[...document.querySelectorAll('.pdfquote__btn')].map((b) => b.textContent)`
    )
    assert(buttons.includes('Remove'), `popover lacks Remove: ${json(buttons)}`)
    assert(buttons.includes('Copy') && buttons.includes('Note'), json(buttons))
  })

  // ------------------------------------------------------------------ remove
  await scenario('4. removing with the page ON SCREEN clears it from the file', async () => {
    await highlight(1, 'yellow')
    await openRail()
    await sleep(400)
    assert((await removeFromRail()) === 'removed', 'no card to remove')
    await settle()
    const inFile = await fileHighlights(pdfPath)
    assert(inFile.length === 0, `expected 0 annotations, got ${inFile.length}`)
  })

  await scenario('5. removing with the page SCROLLED AWAY clears it too', async () => {
    // The reported bug. The rail lists notes on every page, so this is the
    // ordinary case, not an edge one: the note left the sidecar while its
    // annotation stayed in the PDF, invisible and permanent.
    await highlight(1, 'yellow')
    await evalJs(`(() => { const s = document.querySelector('.pdfview__scroll'); s.scrollTo({ top: s.scrollHeight }); return 1 })()`)
    await sleep(2200)
    const rendered = await evalJs(
      `!!document.querySelector('.pdfview__page[data-page="1"] .pdfview__textlayer span')`
    )
    assert(rendered === false, 'page 1 is still rendered; the scenario did not set itself up')

    await openRail()
    await sleep(400)
    assert((await removeFromRail()) === 'removed', 'no card to remove')
    await settle()
    const inFile = await fileHighlights(pdfPath)
    assert(inFile.length === 0, `the highlight was orphaned in the file (${inFile.length} left)`)
  })

  await scenario('6. removing one of several leaves the others alone', async () => {
    await highlight(1, 'yellow')
    await highlight(3, 'green')
    assert((await fileHighlights(pdfPath)).length === 2, 'setup: expected 2 annotations')
    await openRail()
    await sleep(400)
    await removeFromRail(0)
    await settle()
    const inFile = await fileHighlights(pdfPath)
    assert(inFile.length === 1, `expected 1 left, got ${inFile.length}`)
    assert(sidecar(root).notes.length === 1, 'the sidecar disagrees with the file')
  })

  // ------------------------------------------------------------------ change
  await scenario('7. recolouring replaces the annotation rather than adding one', async () => {
    await highlight(1, 'yellow')
    const before = await fileHighlights(pdfPath)
    assert(before[0].color === '255,212,0', `expected yellow, got ${before[0].color}`)
    await evalJs(`(() => {
      window.getSelection().removeAllRanges()
      const rect = document.querySelector('.pdfhl__rect')
      const b = rect.getBoundingClientRect()
      const scroll = document.querySelector('.pdfview__scroll')
      for (const type of ['mousedown', 'mouseup']) {
        scroll.dispatchEvent(new MouseEvent(type, {
          bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2
        }))
      }
      return 1
    })()`)
    await sleep(500)
    await evalJs(`(() => { document.querySelector('.pdfquote__swatch[data-color="green"]').click(); return 1 })()`)
    await settle()
    const after = await fileHighlights(pdfPath)
    assert(after.length === 1, `recolour duplicated the annotation (${after.length})`)
    assert(after[0].color === '95,178,54', `colour did not change: ${after[0].color}`)
  })

  await scenario('8. a note body reaches /Contents so other readers see it', async () => {
    await highlight(1, 'yellow')
    await openRail()
    await sleep(400)
    await evalJs(`(() => {
      const card = document.querySelector('.pdfnotes__list .cmt-card')
      const edit = [...card.querySelectorAll('.cmt__btn')].find((b) => /Add note|Edit/.test(b.textContent))
      edit.click()
      return 1
    })()`)
    await sleep(400)
    await evalJs(`(() => {
      const ta = document.querySelector('.pdfnotes__list .cmt-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, 'the mechanism I want to cite')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      const save = [...ta.closest('.cmt-card').querySelectorAll('.cmt__btn')].find((b) => b.textContent === 'Save')
      save.click()
      return 1
    })()`)
    await settle()
    const inFile = await fileHighlights(pdfPath)
    assert(inFile.length === 1, `body edit duplicated the annotation (${inFile.length})`)
    assert(
      inFile[0].contents === 'the mechanism I want to cite',
      `/Contents is ${json(inFile[0].contents)}`
    )
  })

  // ------------------------------------------------------------------ reopen
  await scenario('9. reopening repaints once, and writes nothing new', async () => {
    await highlight(1, 'yellow')
    const before = readFileSync(pdfPath).length
    await evalJs(`(() => { window.__sunaDev.dock.closePanel(${json(pdfPath)}); return 1 })()`)
    await sleep(1200)
    await evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(pdfPath)}); return 1 })()`)
    await waitFor(`document.querySelectorAll('.pdfview__textlayer span').length > 20`, {
      timeoutMs: 30000,
      desc: 'text layer'
    })
    await settle()

    const inFile = await fileHighlights(pdfPath)
    assert(inFile.length === 1, `reopening duplicated the annotation (${inFile.length})`)
    assert(
      readFileSync(pdfPath).length === before,
      'reopening rewrote the file; an unchanged paper must not be touched'
    )
    const painted = await evalJs(`document.querySelectorAll('.pdfhl__rect').length`)
    assert(painted > 0, 'the highlight did not repaint')
    const foreign = await evalJs(`document.querySelectorAll('.pdfhl__rect--foreign').length`)
    assert(foreign === 0, 'our own highlight came back as a foreign one')
  })

  // ----------------------------------------------------------------- foreign
  await scenario('10. a highlight made elsewhere shows, and survives our edits', async () => {
    // Written straight into the file, as Preview or Zotero would.
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)) }).promise
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 })
    const x0 = 90, y0 = vp.height - 250, x1 = 380, y1 = vp.height - 232
    doc.annotationStorage.setValue('pdfjs_internal_editor_0', {
      annotationType: 9,
      color: [255, 102, 102],
      opacity: 0.4,
      quadPoints: [x0, y1, x1, y1, x0, y0, x1, y0],
      outlines: [[x0, y0, x0, y1, x1, y1, x1, y0]],
      rect: [x0, y0, x1, y1],
      rotation: 0,
      pageIndex: 0,
      user: 'Preview'
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(pdfPath, new Uint8Array(await doc.saveDocument()))

    await evalJs(`(() => { window.__sunaDev.dock.closePanel(${json(pdfPath)}); return 1 })()`)
    await sleep(1000)
    await evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(pdfPath)}); return 1 })()`)
    await waitFor(`document.querySelectorAll('.pdfview__textlayer span').length > 20`, {
      timeoutMs: 30000,
      desc: 'text layer'
    })
    await sleep(1200)

    const foreign = await evalJs(`document.querySelectorAll('.pdfhl__rect--foreign').length`)
    assert(foreign >= 1, 'a highlight made outside SUNA is not rendered')

    // Now make and remove our own; the stranger's must be untouched throughout.
    await highlight(1, 'green')
    assert(
      (await fileHighlights(pdfPath)).length === 2,
      'our highlight did not join the foreign one'
    )
    await openRail()
    await sleep(400)
    await removeFromRail(0)
    await settle()
    const left = await fileHighlights(pdfPath)
    assert(left.length === 1, `expected the foreign one to remain alone, got ${left.length}`)
    assert(left[0].color === '255,102,102', `we deleted the wrong annotation: ${left[0].color}`)
  })

  // ------------------------------------------------------------ degenerate --
  await scenario('11. an empty selection offers nothing to highlight', async () => {
    const popover = await evalJs(`(() => {
      window.getSelection().removeAllRanges()
      document.querySelector('.pdfview__scroll').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return !!document.querySelector('.pdfquote')
    })()`)
    assert(popover === false, 'a popover appeared for an empty selection')
    assert((await fileHighlights(pdfPath)).length === 0, 'something was written')
  })

  await scenario('12. highlighting the same passage twice is two notes, two annotations', async () => {
    await highlight(1, 'yellow')
    await highlight(1, 'blue')
    const inFile = await fileHighlights(pdfPath)
    assert(inFile.length === 2, `expected 2 annotations, got ${inFile.length}`)
    assert(sidecar(root).notes.length === 2, 'the sidecar disagrees')
    // And removing one must leave exactly one, not collapse both.
    await openRail()
    await sleep(400)
    await removeFromRail(0)
    await settle()
    assert(
      (await fileHighlights(pdfPath)).length === 1,
      'removing one of two co-located highlights took both'
    )
  })

  // -------------------------------------------------------------------------
  console.log('')
  for (const f of failures) console.log(`  FAILED: ${f.name}\n          ${f.error}`)
  console.log(`\n${passed}/${passed + failures.length} scenarios passed`)
  if (failures.length > 0) throw new Error(`${failures.length} scenario(s) failed`)
  return { passed, failed: failures.length }
}
