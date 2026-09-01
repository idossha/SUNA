/**
 * Drive probe — quoting a passage out of a reference PDF (ARCHITECTURE §14.4).
 *
 * Measures the whole path in the running app, not a stub: a real drag-shaped
 * DOM selection over pdf.js's live text layer, the popover that follows it,
 * the citekey reverse-resolved from `references/gunn1972.pdf`, and the text
 * Copy puts on the clipboard.
 *
 * There is exactly one clipboard action now, and it produces prose rather
 * than a markdown block — "simply text as if we typed it. eg: xxx [@cite]."
 * The separate "Copy with citation" and "Quote into manuscript" commands are
 * gone, so this no longer asserts anything about the manuscript buffer.
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

  // ---- 1. open the PDF and wait for a live text layer ---------------------
  await evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(pdfPath)}); return true })()`)
  await waitFor(`document.querySelectorAll('.pdfview__textlayer span').length > 20`, {
    timeoutMs: 30000,
    desc: 'PDF text layer populated'
  })
  await sleep(700)

  // ---- 2. the citekey must reverse-resolve from the filename -------------
  const match = await evalJs(`(() => {
    const map = window.__sunaDev.referencePdfsStore.getState().map
    return { size: map.size, gunn: map.get('gunn1972') ?? null }
  })()`)
  assert(match.size > 0, 'reference PDF scan produced an empty map')
  assert(match.gunn !== null, 'gunn1972 did not resolve to a PDF — the scan may not have re-run')
  console.log(`citekey map: ${match.size} entries, gunn1972 -> ${match.gunn.how}`)

  // ---- 3. select a real passage and let the viewer read it ---------------
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
  const labels = popover.buttons.map((b) => b.label)
  assert(
    labels.includes('Copy') && !labels.includes('Copy with citation'),
    `expected one Copy action, got ${json(labels)}`
  )
  assert(!labels.includes('Quote into manuscript'), 'the manuscript command should be gone')
  assert(popover.rect.top >= 0 && popover.rect.left >= 0, 'popover placed off-screen')

  // ---- 4. Copy puts prose on the clipboard, citation inline -------------
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.pdfquote__btn')].find((b) => b.textContent === 'Copy')
    btn.click()
    return true
  })()`)
  await sleep(600)

  const notice = await evalJs(`document.querySelector('.pdfview__note')?.textContent ?? null`)
  console.log(`notice: ${json(notice)}`)
  assert(notice !== null, 'no confirmation shown after Copy')

  const clipboard = await evalJs(`navigator.clipboard.readText().then((t) => t, (e) => 'ERR: ' + String(e))`)
  if (typeof clipboard === 'string' && !clipboard.startsWith('ERR:')) {
    console.log(`clipboard: ${json(clipboard.slice(0, 90))}`)
    assert(clipboard.includes('[@gunn1972, p. 1]'), `clipboard lacks the citation: ${json(clipboard)}`)
    assert(!clipboard.startsWith('>'), 'Copy should produce prose, not a blockquote')
    assert(!clipboard.includes('\n'), 'a PDF column break should not survive into the copy')
    // The citation goes inline, before any sentence-final punctuation.
    const at = clipboard.indexOf('[@gunn1972')
    assert(at > 0, 'the passage should come before the citation')
  } else {
    console.log(`clipboard unreadable in this context (${clipboard}); popover contract still asserted`)
  }

  assert(
    (await evalJs(`!!document.querySelector('.pdfquote')`)) === false,
    'the popover should dismiss after Copy'
  )

  return { citekey: popover.cite, notice, buttons: labels }
}
