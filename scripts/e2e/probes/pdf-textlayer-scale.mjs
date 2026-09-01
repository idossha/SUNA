/**
 * Drive probe — is the PDF text layer actually aligned with the rendered page?
 *
 * ARCHITECTURE §14.4 claims every selection-derived feature in the PDF viewer is
 * silently wrong at any zoom but 100%, because `.pdfview__pagesurface` pins
 * `--total-scale-factor: 1` (viewer.css) while pdf.js's TextLayer sizes its
 * spans through that variable — and because our `:is(span, br)` rule sets no
 * `font-size`, so every span inherits one size regardless of the
 * `--font-height` pdf.js wrote onto it.
 *
 * This measures it rather than reasoning about it. A highlight rectangle
 * derived from a DOM selection is only as good as the agreement between the
 * canvas box (what the reader sees) and the text-layer box (what a Range
 * measures against).
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/pdf-textlayer-scale.mjs
 */
const PDF_REL = 'output/ram-pressure-stripping-at-z-1-7.pdf'

const json = (v) => JSON.stringify(v)
const r2 = (n) => Math.round(n * 100) / 100

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** Canvas box, text-layer box, and the span font-size spread, for page 1. */
const MEASURE = `(() => {
  const page = document.querySelector('.pdfview__page[data-page="1"]')
  if (!page) return { error: 'no page 1' }
  const canvas = page.querySelector('.pdfview__canvas')
  const layer = page.querySelector('.pdfview__textlayer')
  if (!canvas || !layer) return { error: 'no canvas or text layer' }
  const c = canvas.getBoundingClientRect()
  const l = layer.getBoundingClientRect()
  const spans = [...layer.querySelectorAll('span')].slice(0, 60)
  const declared = spans.map((s) => s.style.getPropertyValue('--font-height') || null)
  const computed = spans.map((s) => getComputedStyle(s).fontSize)
  const surface = page.querySelector('.pdfview__pagesurface')
  const style = surface ? getComputedStyle(surface) : null
  return {
    canvas: { w: c.width, h: c.height },
    layer: { w: l.width, h: l.height },
    totalScaleFactor: style ? style.getPropertyValue('--total-scale-factor').trim() : null,
    zoomLabel: [...document.querySelectorAll('.pdfview__zoombtn')]
      .map((b) => b.textContent).find((t) => /%$/.test(t ?? '')) ?? null,
    distinctComputed: [...new Set(computed)],
    distinctDeclared: [...new Set(declared.filter(Boolean))].slice(0, 8),
    sampleCount: spans.length
  }
})()`

export default async function run(ctx) {
  const { evalJs, waitFor, sleep } = ctx

  await waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with --example first')

  const pdfPath = `${rootDir}/${PDF_REL}`
  const exists = await evalJs(
    `window.suna.invoke('fs:read-binary', { path: ${json(pdfPath)} }).then(() => true, (e) => String(e))`
  )
  assert(exists === true, `test PDF unreadable at ${pdfPath}: ${exists}`)

  await evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(pdfPath)}); return true })()`)
  await waitFor(`document.querySelectorAll('.pdfview__textlayer span').length > 20`, {
    timeoutMs: 30000,
    desc: 'text layer populated'
  })
  await sleep(500)

  // ---- fit-width --------------------------------------------------------
  const fit = await evalJs(MEASURE)
  assert(!fit.error, `fit-width measurement failed: ${fit.error}`)

  console.log('\n--- fit-width ---')
  console.log(`  zoom readout          ${fit.zoomLabel}`)
  console.log(`  --total-scale-factor  ${fit.totalScaleFactor}`)
  console.log(`  canvas box            ${r2(fit.canvas.w)} x ${r2(fit.canvas.h)}`)
  console.log(`  text-layer box        ${r2(fit.layer.w)} x ${r2(fit.layer.h)}`)
  console.log(`  font-size across ${fit.sampleCount} spans — computed: ${json(fit.distinctComputed)}`)
  console.log(`                                  declared: ${json(fit.distinctDeclared)}`)

  // ---- zoomed -----------------------------------------------------------
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.pdfview__zoombtn')].find((b) => (b.title ?? '').startsWith('Zoom in'))
    for (let i = 0; i < 4; i++) btn?.click()
    return true
  })()`)
  await sleep(1200)
  const zoomed = await evalJs(MEASURE)
  assert(!zoomed.error, `zoom measurement failed: ${zoomed.error}`)

  console.log('\n--- after 4x zoom-in ---')
  console.log(`  zoom readout          ${zoomed.zoomLabel}`)
  console.log(`  canvas box            ${r2(zoomed.canvas.w)} x ${r2(zoomed.canvas.h)}`)
  console.log(`  text-layer box        ${r2(zoomed.layer.w)} x ${r2(zoomed.layer.h)}`)
  console.log(`  font-size computed:   ${json(zoomed.distinctComputed)}`)

  // ---- selection round-trip: does a Range land on the glyphs? -----------
  const sel = await evalJs(`(() => {
    const layer = document.querySelector('.pdfview__page[data-page="1"] .pdfview__textlayer')
    const span = [...layer.querySelectorAll('span')].find((s) => (s.textContent ?? '').trim().length > 8)
    if (!span) return { error: 'no span with text' }
    const range = document.createRange()
    range.selectNodeContents(span)
    const rect = range.getBoundingClientRect()
    const box = span.getBoundingClientRect()
    return {
      text: (span.textContent ?? '').slice(0, 40),
      declaredFontHeight: span.style.getPropertyValue('--font-height') || null,
      computedFontSize: getComputedStyle(span).fontSize,
      rangeRect: { x: rect.x, w: rect.width, h: rect.height },
      spanRect: { x: box.x, w: box.width, h: box.height }
    }
  })()`)
  console.log('\n--- one span, measured as a Range would ---')
  console.log(`  text            ${json(sel.text)}`)
  console.log(`  --font-height   ${sel.declaredFontHeight}   computed font-size ${sel.computedFontSize}`)
  console.log(`  range width     ${r2(sel.rangeRect.w)}   span width ${r2(sel.spanRect.w)}`)

  // ---- verdict ----------------------------------------------------------
  const fitDelta = Math.abs(fit.canvas.w - fit.layer.w)
  const zoomDelta = Math.abs(zoomed.canvas.w - zoomed.layer.w)
  const fontCollapsed = fit.distinctComputed.length === 1 && fit.distinctDeclared.length > 1

  console.log('\n--- verdict ---')
  console.log(`  |canvas.w - layer.w| fit-width : ${r2(fitDelta)} px`)
  console.log(`  |canvas.w - layer.w| zoomed    : ${r2(zoomDelta)} px`)
  console.log(`  font-size collapsed to one value across varied --font-height : ${fontCollapsed}`)

  // ---- assertions: this probe FAILS on regression, it does not just report -
  // 1px of slack for the round(down, …, 1px) granularity pdf.js applies to the
  // layer box against our Math.floor on the canvas box.
  assert(
    fitDelta <= 1,
    `text layer disagrees with the canvas by ${r2(fitDelta)}px at fit-width — ` +
      `--total-scale-factor is not tracking the render scale (canvas ${r2(fit.canvas.w)}, layer ${r2(fit.layer.w)})`
  )
  assert(
    zoomDelta <= 1,
    `text layer disagrees with the canvas by ${r2(zoomDelta)}px when zoomed ` +
      `(canvas ${r2(zoomed.canvas.w)}, layer ${r2(zoomed.layer.w)})`
  )
  assert(
    !fontCollapsed,
    'every text span computes to the same font-size despite varied --font-height — ' +
      "pdf.js's span sizing rules are missing from viewer.css, so selection rectangles are fiction"
  )
  assert(
    zoomed.distinctComputed.length > 1,
    'zoomed spans collapsed to one font-size'
  )

  return { fitDelta: r2(fitDelta), zoomDelta: r2(zoomDelta), fontCollapsed, fit, zoomed, sel }
}
