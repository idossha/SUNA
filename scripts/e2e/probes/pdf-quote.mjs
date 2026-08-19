/**
 * Drive probe — quoting a passage out of a reference PDF (ADR-008 M1).
 *
 * Measures the whole path in the running app, not a stub: a real drag-shaped
 * DOM selection over pdf.js's live text layer, the popover that follows it,
 * the citekey reverse-resolved from `references/gunn1972.pdf`, and the
 * blockquote arriving in the manuscript's CodeMirror BUFFER — which is the
 * property that matters, because SUNA must never write prose to a markdown
 * file it does not own the buffer of.
 *
 * Prereq: `references/gunn1972.pdf` must exist in the project (the probe
 * refuses rather than inventing one) so the citekey resolves through the
 * conventional-filename tier.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/pdf-quote.mjs
 */
const json = (v) => JSON.stringify(v)

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export default async function run(ctx) {
  const { evalJs, waitFor, sleep } = ctx

  await waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with --example first')

  const pdfPath = `${rootDir}/references/gunn1972.pdf`
  const readable = await evalJs(
    `window.suna.invoke('fs:read-binary', { path: ${json(pdfPath)} }).then(() => true, (e) => String(e))`
  )
  assert(readable === true, `expected a reference PDF at ${pdfPath}: ${readable}`)

  // ---- 1. the manuscript must be OPEN for a quote to have anywhere to go --
  const manuscriptPath = `${rootDir}/manuscript/manuscript.md`
  await evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(manuscriptPath)}); return true })()`)
  await waitFor(`document.querySelectorAll('.cm-content').length > 0`, {
    timeoutMs: 20000,
    desc: 'manuscript editor mounted'
  })
  await sleep(600)

  const before = await evalJs(`window.__sunaDev.docSessions.peek(${json(manuscriptPath)})`)
  assert(typeof before === 'string', 'manuscript buffer not loaded')
  assert(!before.includes('[@gunn1972, p.'), 'manuscript already contains a page-cited quote — rerun on a clean example')

  // ---- 2. open the PDF and wait for a live text layer ---------------------
  await evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(pdfPath)}); return true })()`)
  await waitFor(`document.querySelectorAll('.pdfview__textlayer span').length > 20`, {
    timeoutMs: 30000,
    desc: 'PDF text layer populated'
  })
  await sleep(700)

  // ---- 3. the citekey must reverse-resolve from the filename -------------
  const match = await evalJs(`(() => {
    const map = window.__sunaDev.referencePdfsStore.getState().map
    return { size: map.size, gunn: map.get('gunn1972') ?? null }
  })()`)
  assert(match.size > 0, 'reference PDF scan produced an empty map')
  assert(match.gunn !== null, 'gunn1972 did not resolve to a PDF — the scan may not have re-run')
  console.log(`citekey map: ${match.size} entries, gunn1972 -> ${match.gunn.how}`)

  // ---- 4. select a real passage and let the viewer read it ---------------
  const selected = await evalJs(`(() => {
    const layer = document.querySelector('.pdfview__page[data-page="1"] .pdfview__textlayer')
    if (!layer) return { error: 'no text layer on page 1' }
    const spans = [...layer.querySelectorAll('span')].filter((s) => (s.textContent ?? '').trim().length > 12)
    if (spans.length < 3) return { error: 'not enough text spans to select' }
    const first = spans[1], last = spans[2]
    const sel = window.getSelection()
    sel.removeAllRanges()
    const range = document.createRange()
    range.setStart(first.firstChild, 0)
    range.setEnd(last.firstChild, last.firstChild.length)
    sel.addRange(range)
    document.querySelector('.pdfview__scroll').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return { text: sel.toString().slice(0, 80) }
  })()`)
  assert(!selected.error, `selection failed: ${selected.error}`)
  console.log(`selected: ${json(selected.text)}`)

  await waitFor(`!!document.querySelector('.pdfquote')`, {
    timeoutMs: 8000,
    desc: 'quote popover appeared'
  })

  const popover = await evalJs(`(() => {
    const el = document.querySelector('.pdfquote')
    return {
      cite: el.querySelector('.pdfquote__cite')?.textContent ?? null,
      len: el.querySelector('.pdfquote__len')?.textContent ?? null,
      warn: el.querySelector('.pdfquote__warn')?.textContent ?? null,
      buttons: [...el.querySelectorAll('.pdfquote__btn')].map((b) => ({
        label: b.textContent,
        disabled: b.disabled
      })),
      rect: el.getBoundingClientRect().toJSON()
    }
  })()`)
  console.log(`popover cite: ${popover.cite}   ${popover.len}`)
  assert(popover.warn === null, `popover reported a problem: ${popover.warn}`)
  assert(
    popover.cite?.includes('gunn1972'),
    `popover should name the citekey, got ${json(popover.cite)}`
  )
  assert(popover.cite?.includes('p.'), `popover should name a page, got ${json(popover.cite)}`)
  const copyWithCitation = popover.buttons.find((b) => b.label === 'Copy with citation')
  assert(copyWithCitation && !copyWithCitation.disabled, 'Copy with citation should be enabled')
  assert(popover.rect.top >= 0 && popover.rect.left >= 0, 'popover placed off-screen')

  // ---- 5. quote into the manuscript, and prove it landed in the BUFFER ---
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.pdfquote__btn')].find((b) => b.textContent === 'Quote into manuscript')
    btn.click()
    return true
  })()`)
  await sleep(700)

  const note = await evalJs(`document.querySelector('.pdfview__note')?.textContent ?? null`)
  console.log(`note: ${json(note)}`)
  assert(note !== null, 'no confirmation shown after quoting')

  // Assert against the BUFFER, not `.cm-content.textContent`: CodeMirror only
  // renders the lines in view, so the DOM is silent about an insert that
  // landed outside the viewport or in a tab the dock has hidden. The buffer is
  // also the thing ADR-008 actually claims — the quote reaches the manuscript
  // as a transaction, never as a file write behind an open editor.
  const after = await evalJs(`window.__sunaDev.docSessions.peek(${json(manuscriptPath)})`)
  assert(typeof after === 'string', 'manuscript buffer disappeared')
  const at = after.indexOf('[@gunn1972, p.')
  assert(at >= 0, `the citation never reached the manuscript buffer. Notice was ${json(note)}`)

  const lines = after.slice(0, at + 40).split('\n')
  const citeLine = lines.find((l) => l.includes('[@gunn1972, p.')) ?? ''
  const quoteLine = lines[lines.indexOf(citeLine) - 1] ?? ''
  console.log(`manuscript now carries:\n  ${quoteLine.slice(0, 90)}\n  ${citeLine.slice(0, 90)}`)
  assert(citeLine.startsWith('> —'), `expected a blockquote attribution line, got ${json(citeLine)}`)
  assert(quoteLine.startsWith('> '), `expected the quote as a blockquote, got ${json(quoteLine)}`)
  assert(
    after.length > before.length,
    `buffer did not grow: ${before.length} -> ${after.length}`
  )

  // ---- 6. every character that was there before is still there -----------
  // An insert must never be a rewrite. The old buffer has to survive intact
  // around the insertion point.
  const head = before.slice(0, 24)
  assert(after.includes(head), 'the start of the manuscript was lost')
  assert(
    after.includes(before.slice(-40)),
    'the end of the manuscript was lost'
  )

  console.log(`buffer ${before.length} -> ${after.length} chars, quote at offset ${at}`)

  return { citekey: popover.cite, note, citeLine, beforeLength: before.length, afterLength: after.length }
}
