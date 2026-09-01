/**
 * Drive probe — highlights are NATIVE to the PDF, and removable (ARCHITECTURE §14.4,
 * amended on user direction: "the highlighting functionality should be native
 * to the pdf as if we were highlighting in Preview App" / "we must as easily
 * be able to remove the highlight").
 *
 * The properties under test, in the running app:
 *   1. highlighting writes a real /Highlight annotation INTO
 *      references/<citekey>.pdf, with /QuadPoints, /C and an /AP appearance
 *      stream — the things Preview needs to render it;
 *   2. the original bytes stay a byte-exact prefix, so the paper is not
 *      rewritten, only extended;
 *   3. a SECOND highlight gives two annotations, not one and a duplicate;
 *   4. removing one leaves exactly one — the regenerate-from-pristine path;
 *   5. removing both restores the file to its pristine bytes.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/pdf-native-highlight.mjs
 */
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjs = await import(
  require.resolve('pdfjs-dist/legacy/build/pdf.mjs', {
    paths: [new URL('../../../apps/desktop', import.meta.url).pathname]
  })
)

const json = (v) => JSON.stringify(v)

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/**
 * Read the PDF's annotations back in NODE, through a fresh pdf.js document.
 *
 * Deliberately outside the app: the question is what is in the FILE, and
 * asking the running renderer — which holds its own loaded copy and paints its
 * own overlay — could answer from something other than the bytes on disk.
 */
async function readAnnotations(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  const out = []
  for (let p = 1; p <= doc.numPages; p++) {
    const annots = await (await doc.getPage(p)).getAnnotations({ intent: 'any' })
    for (const a of annots) {
      out.push({
        page: p,
        subtype: a.subtype,
        color: a.color ? [...a.color] : null,
        quads: a.quadPoints ? a.quadPoints.length : 0,
        contents: a.contentsObj?.str ?? null,
        title: a.titleObj?.str ?? null
      })
    }
  }
  const highlights = out.filter((a) => a.subtype === 'Highlight')
  // The example PDF is one of SUNA's own exports and already carries link
  // annotations for its citations, so only /Highlight is ours to count.
  return { total: out.length, highlights, annots: out, bytes: statSync(path).size }
}

/** Do the file's first `n` bytes still hash to what they did before? */
function prefixSha(path, n) {
  return createHash('sha256').update(readFileSync(path).subarray(0, n)).digest('hex')
}

async function highlight(ctx, spanIndex, color) {
  const picked = await ctx.evalJs(`(() => {
    const layer = document.querySelector('.pdfview__page[data-page="1"] .pdfview__textlayer')
    const spans = [...layer.querySelectorAll('span')].filter((s) => (s.textContent ?? '').trim().length > 25)
    const target = spans[${spanIndex}]
    if (!target) return { error: 'no span at index ${spanIndex}' }
    const sel = window.getSelection()
    sel.removeAllRanges()
    const r = document.createRange()
    r.selectNodeContents(target)
    sel.addRange(r)
    document.querySelector('.pdfview__scroll').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return { text: sel.toString().slice(0, 50) }
  })()`)
  assert(!picked.error, picked.error)
  await ctx.waitFor(`!!document.querySelector('.pdfquote')`, { timeoutMs: 8000, desc: 'popover' })
  await ctx.evalJs(
    `(() => { document.querySelector('.pdfquote__swatch[data-color="${color}"]').click(); return true })()`
  )
  // The embed is debounced (700ms) so a burst of highlighting costs one
  // regeneration; wait past it plus the save.
  await ctx.sleep(2600)
  return picked.text
}

export default async function run(ctx) {
  const { evalJs, waitFor, sleep } = ctx

  await waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev' })
  const rootDir = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open')

  const pdfPath = `${rootDir}/references/gunn1972.pdf`
  const before = await readAnnotations(pdfPath)
  console.log(
    `baseline: ${before.bytes} bytes, ${before.total} annotations ` +
      `(${before.highlights.length} highlights)`
  )
  assert(
    before.highlights.length === 0,
    `expected no highlights to start from, found ${before.highlights.length}`
  )
  const pristineBytes = before.bytes
  const pristineSha = prefixSha(pdfPath, pristineBytes)

  await evalJs(`(() => { window.__sunaDev.dock.openFileTab(${json(pdfPath)}); return true })()`)
  await waitFor(`document.querySelectorAll('.pdfview__textlayer span').length > 20`, {
    timeoutMs: 30000,
    desc: 'text layer'
  })
  await sleep(800)

  // ---- 1 & 2. one highlight, written natively, appended not rewritten ----
  const first = await highlight(ctx, 1, 'green')
  console.log(`highlighted: ${json(first)}`)

  const one = await readAnnotations(pdfPath)
  console.log(
    `after 1: ${one.bytes} bytes (+${one.bytes - pristineBytes}), ${one.highlights.length} highlights`
  )
  assert(one.highlights.length === 1, `expected 1 native highlight, got ${one.highlights.length}`)
  const a0 = one.highlights[0]
  assert(a0.subtype === 'Highlight', `expected /Highlight, got ${a0.subtype}`)
  assert(a0.quads >= 8, `expected QuadPoints, got ${a0.quads} numbers`)
  assert(a0.color !== null, 'annotation carries no colour')
  console.log(`  subtype=${a0.subtype} color=${json(a0.color)} quads=${a0.quads} title=${json(a0.title)}`)

  assert(one.bytes > pristineBytes, 'the file did not grow — nothing was appended')
  assert(
    prefixSha(pdfPath, pristineBytes) === pristineSha,
    'the original bytes changed — the paper was REWRITTEN, not extended'
  )
  console.log('  original bytes are still a byte-exact prefix')

  // The /AP appearance stream is what makes Preview render it rather than
  // showing nothing; assert it is in the bytes.
  const tail = readFileSync(pdfPath).subarray(-6000).toString('latin1')
  const hasAP = {
    ap: tail.includes('/AP'),
    sub: tail.includes('/Subtype /Highlight'),
    quad: tail.includes('/QuadPoints')
  }
  console.log(`  bytes carry: /Subtype /Highlight=${hasAP.sub}  /QuadPoints=${hasAP.quad}  /AP=${hasAP.ap}`)
  assert(hasAP.sub && hasAP.quad, 'the annotation is not in the file bytes')
  assert(hasAP.ap, 'no /AP appearance stream — Preview would render nothing')

  // ---- 3. a second highlight is a second annotation, not a duplicate ----
  await highlight(ctx, 3, 'yellow')
  const two = await readAnnotations(pdfPath)
  console.log(`after 2: ${two.bytes} bytes, ${two.highlights.length} highlights`)
  assert(
    two.highlights.length === 2,
    `expected 2 highlights, got ${two.highlights.length} — the file is being appended to, not regenerated`
  )

  // ---- 4. removing one leaves exactly one -------------------------------
  const railCount = await evalJs(`(() => {
    document.querySelector('.pdfview__notesbtn')?.click()
    return true
  })()`)
  assert(railCount === true)
  await sleep(400)
  const cards = await evalJs(`document.querySelectorAll('.pdfnotes__list .cmt-card').length`)
  console.log(`rail shows ${cards} note cards`)
  assert(cards === 2, `expected 2 cards in the rail, got ${cards}`)

  await evalJs(`(() => {
    const card = document.querySelector('.pdfnotes__list .cmt-card')
    const remove = [...card.querySelectorAll('.cmt__btn')].find((b) => b.textContent === 'Remove')
    remove.click()
    return true
  })()`)
  await sleep(2600)

  const afterRemove = await readAnnotations(pdfPath)
  console.log(`after removing one: ${afterRemove.bytes} bytes, ${afterRemove.highlights.length} highlights`)
  assert(
    afterRemove.highlights.length === 1,
    `expected 1 highlight after removal, got ${afterRemove.highlights.length} — removal is the thing pdf.js cannot do in place`
  )

  // ---- 5. removing everything restores the pristine bytes ---------------
  await evalJs(`(() => {
    const card = document.querySelector('.pdfnotes__list .cmt-card')
    const remove = [...card.querySelectorAll('.cmt__btn')].find((b) => b.textContent === 'Remove')
    remove.click()
    return true
  })()`)
  await sleep(2600)

  const empty = await readAnnotations(pdfPath)
  console.log(`after removing both: ${empty.bytes} bytes, ${empty.highlights.length} highlights`)
  assert(empty.highlights.length === 0, `expected 0 highlights, got ${empty.highlights.length}`)
  // NOT byte-identical to the original, and that is correct. An earlier design
  // rebuilt the file from a pristine baseline, so removing everything
  // truncated back to it; that baseline was a trap, because a foreign edit
  // invalidated it permanently. Highlights are now reconciled with incremental
  // saves, and an incremental save only ever appends — even a deletion, which
  // appends an update marking the object gone. What must hold is that the
  // paper's own bytes were never rewritten.
  assert(
    prefixSha(pdfPath, pristineBytes) === pristineSha,
    'the original bytes changed — the paper was rewritten rather than appended to'
  )
  assert(empty.bytes >= pristineBytes, 'the file shrank; an incremental save only grows')
  console.log(`  the paper's own ${pristineBytes} bytes are still intact and unmodified`)

  return {
    pristineBytes,
    afterOne: one.bytes,
    afterTwo: two.bytes,
    afterRemoveOne: afterRemove.highlights.length,
    afterRemoveAll: empty.highlights.length,
    finalBytes: empty.bytes,
    annotation: a0
  }
}
