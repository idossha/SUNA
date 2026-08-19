/**
 * "Start from an existing manuscript" (new-project wizard, step 3). One
 * entry point — `analyzeDocument` — turns a .docx, .html or .pdf file into
 * the same `DocxAnalysis` the DOCX importer already produces, so all three
 * formats land in a project through one writer (`writeAnalysisIntoProject`).
 *
 * The three readers differ only in how they reach an HTML fragment:
 *   .docx  mammoth (docx-import.ts)
 *   .html  the file itself, with <head>/<script>/<style> dropped
 *   .pdf   pdfjs text items, reassembled into headings and paragraphs
 *
 * A PDF carries no structure — only glyphs and positions — so that last one
 * is a heuristic and says so, loudly, in a warning the wizard surfaces.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { DocxAnalysis, DocxWarning } from '@suna/core'
import { analyzeDocx, analyzeHtmlDocument, writeAnalysisIntoProject } from './docx-import'

export type ImportableDocumentKind = 'docx' | 'html' | 'pdf'

/** The extensions the wizard's file picker offers, in the order it offers them. */
export const IMPORTABLE_DOCUMENT_EXTENSIONS = ['docx', 'pdf', 'html', 'htm'] as const

export function documentKind(path: string): ImportableDocumentKind | null {
  switch (extname(path).toLowerCase()) {
    case '.docx':
      return 'docx'
    case '.html':
    case '.htm':
      return 'html'
    case '.pdf':
      return 'pdf'
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* HTML                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Reduces a whole HTML page to the fragment the block parser wants: no
 * doctype/head, no scripts, styles or comments, and — when the page has a
 * <body> — only what is inside it.
 */
export function htmlToFragment(source: string): string {
  let html = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, '')
    .replace(/<!doctype[^>]*>/gi, '')
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)
  if (body !== null) html = body[1] as string
  return html.trim()
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */

/** A line of a PDF page: the text items between two end-of-line markers. */
function linesFromItems(items: readonly { str: string; hasEOL?: boolean }[]): string[] {
  const lines: string[] = []
  let current = ''
  for (const item of items) {
    current += item.str
    if (item.hasEOL === true) {
      lines.push(current)
      current = ''
    }
  }
  if (current !== '') lines.push(current)
  return lines.map((line) => line.replace(/\s+/g, ' ').trim())
}

const SECTION_WORDS =
  'abstract|introduction|background|related work|materials and methods|methods?|methodology|results|results and discussion|discussion|conclusions?|references|bibliography|works cited|acknowledgements?|acknowledgments?|data availability|code availability|supplementary(?: information| material)?|appendix'
const HEADING_RE = new RegExp(`^(?:\\d+(?:\\.\\d+)*\\.?\\s+)?(?:${SECTION_WORDS})\\b[:.]?$`, 'i')
/** A numbered heading the document invented ("3.2 Sample selection"): short, numbered, no closing period. */
const NUMBERED_HEADING_RE = /^\d+(?:\.\d+)*\.?\s+[A-Z][^.!?]{2,60}$/

function isHeading(line: string): boolean {
  if (line.length > 80) return false
  return HEADING_RE.test(line) || NUMBERED_HEADING_RE.test(line)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Turns a PDF's lines into an HTML fragment the shared analyzer understands.
 *
 * Two things have to be recovered that the file does not state: where a
 * paragraph ends, and which lines are headings. Paragraph breaks come from
 * line length — a line noticeably shorter than the body's typical measure
 * ends its paragraph, which is how justified academic text actually looks —
 * and headings from the section vocabulary above. The first line of the
 * document becomes the title, because that is where a title is.
 */
export function pdfLinesToHtml(pages: readonly (readonly string[])[]): string {
  // Running heads and page numbers repeat; anything on three or more pages
  // that is short is furniture, not prose.
  const seen = new Map<string, number>()
  for (const page of pages) {
    for (const line of new Set(page)) seen.set(line, (seen.get(line) ?? 0) + 1)
  }
  const isFurniture = (line: string): boolean => {
    if (line === '') return true
    if (/^\d{1,4}$/.test(line)) return true
    return line.length <= 80 && pages.length >= 3 && (seen.get(line) ?? 0) >= 3
  }

  const lines = pages.flat().filter((line) => !isFurniture(line))
  if (lines.length === 0) return ''

  const bodyLengths = lines.map((l) => l.length).sort((a, b) => a - b)
  const median = bodyLengths[Math.floor(bodyLengths.length / 2)] as number
  const shortEnoughToEndAParagraph = median * 0.75

  const out: string[] = []
  let paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length === 0) return
    out.push(`<p>${escapeHtml(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const [first, ...rest] = lines
  out.push(`<h1>${escapeHtml(first as string)}</h1>`)

  for (const line of rest) {
    if (isHeading(line)) {
      flush()
      out.push(`<h2>${escapeHtml(line)}</h2>`)
      continue
    }
    paragraph.push(line)
    if (line.length < shortEnoughToEndAParagraph) flush()
  }
  flush()
  return out.join('\n')
}

async function readPdfLines(path: string): Promise<string[][]> {
  // pdfjs-dist is externalized in the main bundle, and its legacy build is the
  // one that runs outside a browser — the same entry scripts/e2e uses.
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as {
    getDocument: (params: { data: Uint8Array }) => { promise: Promise<PdfDocumentLike> }
  }
  const data = new Uint8Array(await readFile(path))
  const doc = await pdfjs.getDocument({ data }).promise
  const pages: string[][] = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const items = content.items.filter(
      (item): item is PdfTextItem => typeof item === 'object' && item !== null && 'str' in item
    )
    pages.push(linesFromItems(items))
  }
  await doc.destroy?.()
  return pages
}

interface PdfTextItem {
  str: string
  hasEOL?: boolean
}
interface PdfDocumentLike {
  numPages: number
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>
  destroy?: () => Promise<void>
}

/* ------------------------------------------------------------------ */
/* analyze + apply                                                      */
/* ------------------------------------------------------------------ */

/** Analyzes any supported manuscript file. Writes nothing. */
export async function analyzeDocument(path: string): Promise<DocxAnalysis> {
  const kind = documentKind(path)
  if (kind === null) {
    throw new Error(`unsupported manuscript file (expected .docx, .pdf or .html): ${path}`)
  }
  if (kind === 'docx') return analyzeDocx(path)

  if (kind === 'html') {
    const html = htmlToFragment(await readFile(path, 'utf8'))
    return analyzeHtmlDocument({ sourcePath: path, html, figures: [], warnings: [], tempDir: null })
  }

  const pages = await readPdfLines(path)
  const html = pdfLinesToHtml(pages)
  const warnings: DocxWarning[] = [
    {
      code: 'pdf-structure-inferred',
      message:
        'A PDF stores glyphs, not structure — headings, paragraph breaks and figures were inferred from the text layout and images were not extracted. Read the imported manuscript through before trusting it.',
      context: null
    }
  ]
  if (html === '') {
    warnings.push({
      code: 'pdf-no-text-layer',
      message: 'No text could be extracted — this PDF is probably scanned images and needs OCR first.',
      context: null
    })
  }
  return analyzeHtmlDocument({ sourcePath: path, html, figures: [], warnings, tempDir: null })
}

/**
 * Fills the gaps the standalone importer's review screen would have had the
 * user fill. The wizard has no such screen: it imports what it found and
 * reports, as warnings, everything it had to stand in for.
 */
function fillGaps(analysis: DocxAnalysis, projectName: string): { analysis: DocxAnalysis; warnings: string[] } {
  const warnings: string[] = []
  let next = analysis
  if (next.title.value === null || next.title.value.trim() === '') {
    warnings.push(`No title was found in the document — the project name "${projectName}" was used instead.`)
    next = { ...next, title: { ...next.title, value: projectName } }
  }
  if (next.abstract.value === null || next.abstract.value.trim() === '') {
    warnings.push('No abstract was found in the document — an empty one was written.')
    next = { ...next, abstract: { ...next.abstract, value: '' } }
  }
  if (next.authors.length === 0) {
    warnings.push('No authors were found in the document — add them in the Manuscript view.')
  }
  if (next.sections.length === 0) {
    warnings.push('No body text could be read out of the document — the manuscript was left empty.')
  }
  return { analysis: next, warnings }
}

/**
 * The wizard's whole "start from a document" step: analyze the file, fill
 * what it could not find, and write the result over the blank manuscript the
 * scaffold just made. Returns warnings for step 7's list — a document that
 * imports badly must never fail the project's creation, only explain itself.
 */
export async function importDocumentIntoProject(
  path: string,
  projectDir: string,
  projectName: string
): Promise<{ warnings: string[] }> {
  const raw = await analyzeDocument(path)
  const { analysis, warnings } = fillGaps(raw, projectName)
  await writeAnalysisIntoProject(analysis, projectDir)
  return { warnings: [...warnings, ...analysis.warnings.map((w) => w.message)] }
}
