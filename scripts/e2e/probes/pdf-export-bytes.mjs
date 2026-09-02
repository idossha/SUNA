/**
 * Drive probe — `export:pdf` produces a real PDF, and the bytes are right
 * (ARCHITECTURE §13).
 *
 * This closes the gap ROADMAP recorded as "PDF export has never been produced
 * under automation". `printToPDF` needs a live Electron process, so for a long
 * time the DOCX half of export was asserted down to `word/document.xml` while
 * the PDF half stopped at the HTML that gets printed — and HTML-to-bytes is
 * exactly where page geometry, page breaks, figure embedding and the profile's
 * submission conventions either work or silently do not.
 *
 * A file appearing is not evidence. A zero-byte file, a one-page-of-nothing
 * render, or an export that quietly dropped every figure all look like success
 * from the IPC response, so every check below reads the PDF back with pdf.js
 * (already a dependency of apps/desktop — no new runtime dependency) and
 * asserts what is actually on the pages:
 *
 *   1. `%PDF-` header, `%%EOF` trailer, and a size no empty render reaches.
 *   2. pdf.js parses it and reports more than one page.
 *   3. Every page measures US Letter (612 x 792 pt), which is the ACTIVE
 *      PROFILE's paper size resolved through export-style.ts — not a Chromium
 *      default, and not the hidden window's own size.
 *   4. The text layer carries the manuscript: the title, both headings, an
 *      abstract phrase, table cell text, and a reference the citations derive.
 *      This is what catches an image-only or empty render.
 *   5. A figure really was embedded — an image XObject is painted, counted
 *      from the operator list rather than inferred from the file size.
 *
 * Then the same manuscript is exported again under a CONTRASTING profile, and
 * the two PDFs must differ in the ways the profile says they should. This is
 * the check that catches profile-driven page setup silently not applying:
 *
 *   6. `sleep` sets `figurePlacement: 'captions-list'`, which puts NO image in
 *      the body at all — so its PDF must contain zero painted images where
 *      `suna` (inline) contains at least one.
 *   7. `sleep` also sets `tablePlacement: 'end'`, so the figure captions and
 *      the tables sit AFTER the reference list. Page ordering, in the bytes.
 *
 * Deliberately NOT asserted: an exact page count. It moves with a font
 * substitution or a Chromium upgrade, and a check that goes red for that is
 * worse than no check. The bounds below are wide on purpose.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs run scripts/e2e/probes/pdf-export-bytes.mjs
 *
 * Or, with the boot and teardown done for you:
 *       node scripts/e2e/pdf-probes.mjs --only pdf-export-bytes.mjs
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** pdfjs-dist is a dependency of apps/desktop, not of scripts/ — resolve it there. */
const requireFromDesktop = createRequire(join(ROOT, 'apps', 'desktop', 'package.json'))

const json = (v) => JSON.stringify(v)

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** US Letter in PostScript points, and how far off a page may measure. */
const LETTER_PT = { width: 612, height: 792 }
const PT_TOLERANCE = 2

/**
 * Strings that must survive into the text layer.
 *
 * Each is a fragment, never a whole sentence: the title contains `$n = 1$`,
 * which KaTeX renders as separate glyph runs, and pdf.js reports a text item
 * per run. Matching on a fragment that no maths passes through keeps this
 * about "did the manuscript render" rather than about text-item chunking.
 */
const EXPECTED_TEXT = [
  ['the title', 'Hello SUNA: a working tour of a manuscript'],
  ['the abstract', 'researcher happiness rises monotonically'],
  ['the Results heading', 'Results'],
  ['the Methods heading', 'Methods'],
  ['body prose', 'a plain-text file under version control'],
  ['a table cell', 'Where it lives'],
  // A reference-list-only string. 'Knuth' alone would NOT do: the house
  // profile renders author-year citations, so it appears in the body prose
  // too and the check would pass with no reference list rendered at all.
  ['a derived reference-list entry', 'Literate Programming']
]

/** The figure caption title, used for the captions-list ordering check. */
const FIGURE_CAPTION = 'The measurable effect of SUNA on the working scientist'

/** Read a PDF off disk into { pages: string[], sizes: [{w,h}], images: number }. */
async function readPdf(pdfjs, path) {
  const bytes = readFileSync(path)
  assert(bytes.length > 0, `${path} is zero bytes`)
  const head = bytes.subarray(0, 8).toString('latin1')
  assert(head.startsWith('%PDF-'), `${path} does not start with %PDF- (got ${json(head)})`)
  // The trailer marker is at the very end, but writers may pad it — search the
  // tail rather than requiring it to be the final byte.
  const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1')
  assert(tail.includes('%%EOF'), `${path} has no %%EOF trailer — the file is truncated`)

  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
  const pages = []
  const sizes = []
  let images = 0
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(
      content.items
        .map((it) => it.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
    )
    const [x0, y0, x1, y1] = page.view
    sizes.push({ w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
    // getOperatorList does not rasterize, so this works headless with no
    // canvas backend — it only asks what the page WOULD paint.
    const ops = await page.getOperatorList()
    for (const fn of ops.fnArray) {
      if (
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject ||
        fn === pdfjs.OPS.paintImageXObjectRepeat
      ) {
        images += 1
      }
    }
  }
  return { numPages: doc.numPages, pages, sizes, images, bytes: bytes.length }
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')
  assert(
    await ctx.evalJs(`!!window.__sunaDev.exportSeam`),
    'window.__sunaDev.exportSeam is missing — this build predates export/devSeam.ts'
  )
  await ctx.waitFor(`window.__sunaDev.manuscriptStore.getState().manuscript !== null`, {
    timeoutMs: 20000,
    desc: 'manuscript.json to load'
  })

  const failures = []
  const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`)
    else {
      console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
      failures.push(name)
    }
  }

  const outputs = []
  /** Export under one profile and hand back the parsed PDF. */
  const exportUnder = async (pdfjs, profileId, outputName) => {
    const outPath = join(rootDir, 'output', `${outputName}.pdf`)
    rmSync(outPath, { force: true })
    outputs.push(outPath)
    const res = await ctx.evalJs(
      `window.__sunaDev.exportSeam
        .exportManuscript(${json(rootDir)}, ${json(profileId)}, 'pdf', ${json(outputName)})
        .then((r) => ({ ok: true, path: r.path }))
        .catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) }))`
    )
    assert(res && res.ok, `export:pdf under '${profileId}' failed — ${res && res.error}`)
    assert(
      existsSync(outPath),
      `export:pdf under '${profileId}' reported success but wrote no file at ${outPath}`
    )
    assert(
      statSync(outPath).size > 0,
      `export:pdf under '${profileId}' wrote a ZERO-BYTE file at ${outPath}`
    )
    return await readPdf(pdfjs, outPath)
  }

  const pdfjs = await import(
    pathToFileURL(requireFromDesktop.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
  )

  try {
    // ------------------------------------------------ 1. the house profile
    console.log("exporting under 'suna' (house style, figures inline)…")
    const house = await exportUnder(pdfjs, 'suna', 'pdf-export-bytes-suna')
    console.log(`  · ${house.numPages} pages, ${house.bytes} bytes, ${house.images} painted images`)

    check(
      'the file is a PDF with a header, a trailer and real content',
      // readPdf already threw on a bad header/trailer; the size floor is what
      // separates a rendered manuscript from an empty page that also parses.
      house.bytes > 20_000,
      `${house.bytes} bytes`
    )
    check(
      'it has more than one page',
      house.numPages >= 2 && house.numPages <= 40,
      `${house.numPages} pages`
    )

    const wrongSize = house.sizes.findIndex(
      (s) =>
        Math.abs(s.w - LETTER_PT.width) > PT_TOLERANCE ||
        Math.abs(s.h - LETTER_PT.height) > PT_TOLERANCE
    )
    check(
      "every page is the active profile's paper size (US Letter, 612x792 pt)",
      wrongSize === -1,
      wrongSize === -1
        ? undefined
        : `page ${wrongSize + 1} measures ${house.sizes[wrongSize].w} x ${house.sizes[wrongSize].h} pt`
    )

    const all = house.pages.join(' ␟ ')
    for (const [what, needle] of EXPECTED_TEXT) {
      check(`the text layer carries ${what}`, all.includes(needle), `missing ${json(needle)}`)
    }

    check(
      'a figure was embedded, not silently dropped',
      house.images >= 1,
      `${house.images} painted images`
    )

    // ------------------------------------- 2. a contrasting journal profile
    // 'sleep' is the one bundled profile whose documentStyle states real
    // submission-convention deltas (figures as a captions list, tables at the
    // end, references on a new page). Every other profile inherits the house
    // page setup, so exporting under it would prove nothing about whether the
    // profile reached the printer.
    console.log("\nexporting under 'sleep' (figures as a captions list, tables at the end)…")
    const journal = await exportUnder(pdfjs, 'sleep', 'pdf-export-bytes-sleep')
    console.log(
      `  · ${journal.numPages} pages, ${journal.bytes} bytes, ${journal.images} painted images`
    )

    check(
      'the journal export is also a multi-page US Letter PDF',
      journal.numPages >= 2 &&
        journal.sizes.every(
          (s) =>
            Math.abs(s.w - LETTER_PT.width) <= PT_TOLERANCE &&
            Math.abs(s.h - LETTER_PT.height) <= PT_TOLERANCE
        ),
      `${journal.numPages} pages, first ${json(journal.sizes[0])}`
    )
    check(
      'it renders the same manuscript',
      journal.pages.join(' ').includes('Hello SUNA: a working tour of a manuscript'),
      'the title is not in the text layer'
    )
    check(
      "figurePlacement 'captions-list' put no image in the body",
      journal.images === 0 && house.images > journal.images,
      `suna painted ${house.images}, sleep painted ${journal.images}`
    )

    const pageOf = (pdf, needle) => pdf.pages.findIndex((t) => t.includes(needle)) + 1
    const capPage = pageOf(journal, FIGURE_CAPTION)
    const refPage = pageOf(journal, 'Literate Programming')
    check(
      'the figure captions list sits after the references',
      capPage > 0 && refPage > 0 && capPage >= refPage,
      `caption on page ${capPage || '(absent)'}, references from page ${refPage || '(absent)'}`
    )
    const houseCapPage = pageOf(house, FIGURE_CAPTION)
    const houseRefPage = pageOf(house, 'Literate Programming')
    check(
      'the house export keeps that caption with the figure, before the references',
      houseCapPage > 0 && houseRefPage > 0 && houseCapPage < houseRefPage,
      `caption on page ${houseCapPage || '(absent)'}, references from page ${houseRefPage || '(absent)'}`
    )
  } finally {
    // The example project under .userdata-drive is a scratch copy, but a probe
    // that leaves its exports behind makes the next run's "did it write?"
    // check pass on a stale file.
    for (const path of outputs) rmSync(path, { force: true })
  }

  if (failures.length > 0) throw new Error(`${failures.length} check(s) failed: ${failures.join(', ')}`)
  console.log('\nall checks passed')
}
