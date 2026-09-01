/**
 * A tiny, dependency-free multi-page PDF writer for the e2e suites.
 *
 * The PDF-viewer steps used to read three real journal PDFs from a LOCAL
 * stash at <repo>/references/, which was never in the repository — so those
 * steps failed on every checkout that did not happen to have the stash, and
 * publisher PDFs are exactly the kind of third-party content this repo must
 * not carry (see AGENTS.md rule 1 and the public-repo policy). They are
 * generated here instead: deterministic bytes, no fixture to keep in sync,
 * and nothing personal committed.
 *
 * The output is deliberately plain — Helvetica, one `Tj` per line — because
 * what the steps assert is pdf.js's page count, a rasterized page-1 canvas,
 * and a populated text layer (one span per show-text operator). Anything
 * fancier would only make the fixture harder to reason about.
 */
import { writeFileSync } from 'node:fs'

const LINES_PER_PAGE = 30

/** Escape a string for a PDF literal string `( … )`. */
const lit = (s) => s.replace(/([\\()])/g, '\\$1')

/**
 * Build a PDF with `pages` pages of ASCII text.
 * @param {{ title: string, pages?: number }} opts
 * @returns {Buffer}
 */
export function buildPdf({ title, pages = 12 }) {
  /** Object bodies, 1-indexed by position: objects[i] is object number i+1. */
  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length // the new object's number
  }

  // 1 catalog, 2 page tree, 3 font — fixed numbers so the tree can reference
  // page objects it does not know the numbers of yet.
  const CATALOG = add(null)
  const PAGE_TREE = add(null)
  const FONT = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  const pageNumbers = []
  for (let p = 1; p <= pages; p += 1) {
    let ops = ''
    for (let i = 0; i < LINES_PER_PAGE; i += 1) {
      const y = 760 - i * 24
      const text =
        i === 0
          ? `${title} — page ${p} of ${pages}`
          : `Line ${i} of page ${p}: the quick brown fox jumps over the lazy dog.`
      // One BT/ET pair per line, so pdf.js emits one text-layer span per line.
      ops += `BT /F1 12 Tf 72 ${y} Td (${lit(text)}) Tj ET\n`
    }
    const stream = add(
      `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}endstream`
    )
    pageNumbers.push(
      add(
        `<< /Type /Page /Parent ${PAGE_TREE} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${stream} 0 R >>`
      )
    )
  }

  objects[CATALOG - 1] = `<< /Type /Catalog /Pages ${PAGE_TREE} 0 R >>`
  objects[PAGE_TREE - 1] =
    `<< /Type /Pages /Count ${pageNumbers.length} ` +
    `/Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] >>`

  // Serialize, recording each object's byte offset for the xref table.
  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  let offset = chunks[0].length
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(offset)
    const buf = Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1')
    chunks.push(buf)
    offset += buf.length
  })

  const xrefStart = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG} 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`
  chunks.push(Buffer.from(xref, 'latin1'))

  return Buffer.concat(chunks)
}

/** Write one such PDF to `path`. Returns `path`. */
export function writePdf(path, opts) {
  writeFileSync(path, buildPdf(opts))
  return path
}
