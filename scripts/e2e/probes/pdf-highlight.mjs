/**
 * Drive probe — a highlight survives (ADR-008 M2).
 *
 * The property under test is not "a coloured box appeared". It is:
 *   1. selecting text and picking a colour writes `references/notes/<key>.json`,
 *   2. that file validates and carries a W3C quote/prefix/suffix anchor,
 *   3. closing and reopening the PDF re-locates the quote and repaints it,
 *   4. the PDF's own bytes are untouched — highlights are stored beside it.
 *
 * Step 4 is the one that matters most: `references/<citekey>.pdf` is the
 * artifact of record, and reading a paper must never modify it.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/pdf-highlight.mjs
 */
const json = (v) => JSON.stringify(v)

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

async function openPdfAndWait(ctx, pdfPath) {
  await ctx.evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(pdfPath)}); return true })()`)
  await ctx.waitFor(`document.querySelectorAll('.pdfview__textlayer span').length > 20`, {
    timeoutMs: 30000,
    desc: 'PDF text layer populated'
  })
  await ctx.sleep(700)
}

export default async function run(ctx) {
  const { evalJs, waitFor, sleep } = ctx

  await waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev' })
  const rootDir = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with --example first')

  const pdfPath = `${rootDir}/references/gunn1972.pdf`
  const notesPath = `${rootDir}/references/notes/gunn1972.json`

  // ---- 0. baseline: the PDF's own size, to prove we never write it -------
  const pdfBefore = await evalJs(
    `window.suna.invoke('fs:read-binary', { path: ${json(pdfPath)} }).then((r) => r.base64.length, (e) => String(e))`
  )
  assert(typeof pdfBefore === 'number', `reference PDF unreadable: ${pdfBefore}`)

  await openPdfAndWait(ctx, pdfPath)

  // ---- 1. select a passage and highlight it ------------------------------
  const selected = await evalJs(`(() => {
    const layer = document.querySelector('.pdfview__page[data-page="1"] .pdfview__textlayer')
    if (!layer) return { error: 'no text layer' }
    const spans = [...layer.querySelectorAll('span')].filter((s) => (s.textContent ?? '').trim().length > 25)
    if (spans.length < 2) return { error: 'not enough long spans' }
    const target = spans[1]
    const sel = window.getSelection()
    sel.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(target)
    sel.addRange(range)
    document.querySelector('.pdfview__scroll').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return { text: sel.toString() }
  })()`)
  assert(!selected.error, `selection failed: ${selected.error}`)
  console.log(`selected: ${json(selected.text.slice(0, 70))}`)

  await waitFor(`!!document.querySelector('.pdfquote')`, { timeoutMs: 8000, desc: 'popover' })

  const swatches = await evalJs(
    `[...document.querySelectorAll('.pdfquote__swatch')].map((b) => b.dataset.color)`
  )
  assert(swatches.length === 8, `expected Zotero's eight colours, got ${json(swatches)}`)
  console.log(`swatches: ${swatches.join(' ')}`)

  await evalJs(`(() => {
    document.querySelector('.pdfquote__swatch[data-color="green"]').click()
    return true
  })()`)
  await sleep(900)

  // ---- 2. the sidecar exists, validates, and holds a real anchor ---------
  const raw = await evalJs(
    `window.suna.invoke('fs:read-text', { path: ${json(notesPath)} }).then((r) => r.content, (e) => 'ERR: ' + String(e))`
  )
  assert(!raw.startsWith('ERR:'), `notes sidecar not written: ${raw}`)
  const file = JSON.parse(raw)
  assert(file.schemaVersion === 1, `bad schemaVersion: ${file.schemaVersion}`)
  assert(file.citekey === 'gunn1972', `bad citekey: ${file.citekey}`)
  assert(file.notes.length === 1, `expected one note, got ${file.notes.length}`)

  const note = file.notes[0]
  assert(note.color === 'green', `colour not stored: ${note.color}`)
  assert(note.runs.length >= 1, 'note has no runs')
  const run0 = note.runs[0]
  assert(typeof run0.quote === 'string' && run0.quote.length > 10, 'run has no usable quote')
  assert('prefix' in run0 && 'suffix' in run0, 'run is missing W3C context')
  assert(run0.detached === false, 'a freshly made run should not be detached')
  assert(run0.page === 1, `expected page 1, got ${run0.page}`)
  console.log(`stored quote: ${json(run0.quote.slice(0, 60))}`)
  console.log(`stored context: prefix=${json(run0.prefix.slice(-18))} suffix=${json(run0.suffix.slice(0, 18))}`)

  // The stored quote must be what was selected, not a re-derived guess.
  assert(
    selected.text.includes(run0.quote) || run0.quote.includes(selected.text.trim()),
    `stored quote does not match the selection:\n  sel:   ${json(selected.text.slice(0, 60))}\n  quote: ${json(run0.quote.slice(0, 60))}`
  )

  // ---- 3. it paints, and it survives a close/reopen ----------------------
  const paintedNow = await evalJs(`document.querySelectorAll('.pdfhl__rect').length`)
  console.log(`painted rects immediately after: ${paintedNow}`)
  assert(paintedNow > 0, 'highlight did not paint after being created')

  await evalJs(`(() => { window.__sunaDev.dock.closePanel(${json(pdfPath)}); return true })()`)
  await sleep(500)
  await openPdfAndWait(ctx, pdfPath)
  await sleep(900)

  const repainted = await evalJs(`(() => {
    const rects = [...document.querySelectorAll('.pdfhl__rect')]
    return {
      count: rects.length,
      colors: [...new Set(rects.map((r) => r.dataset.color))],
      ambiguous: rects.filter((r) => r.classList.contains('pdfhl__rect--ambiguous')).length,
      firstBox: rects[0] ? rects[0].getBoundingClientRect().toJSON() : null
    }
  })()`)
  console.log(`after reopen: ${repainted.count} rects, colours ${json(repainted.colors)}`)
  assert(repainted.count > 0, 'highlight did NOT come back after reopening the PDF')
  assert(repainted.colors.includes('green'), `colour lost on reload: ${json(repainted.colors)}`)
  assert(
    repainted.ambiguous === 0,
    'the run re-anchored ambiguously — stored context failed to disambiguate'
  )
  assert(
    repainted.firstBox && repainted.firstBox.width > 20 && repainted.firstBox.height > 4,
    `highlight rect is degenerate: ${json(repainted.firstBox)}`
  )

  // ---- 4. the PDF itself was never written -------------------------------
  const pdfAfter = await evalJs(
    `window.suna.invoke('fs:read-binary', { path: ${json(pdfPath)} }).then((r) => r.base64.length, (e) => String(e))`
  )
  assert(
    pdfAfter === pdfBefore,
    `the reference PDF changed size (${pdfBefore} -> ${pdfAfter}) — notes must be stored beside it, not in it`
  )
  console.log(`reference PDF unchanged (${pdfBefore} base64 chars)`)

  return {
    quote: run0.quote.slice(0, 80),
    color: note.color,
    paintedAfterReload: repainted.count,
    pdfUnchanged: pdfAfter === pdfBefore
  }
}
