/**
 * The app's one HTML → PDF printer for the SIMPLE pipeline: build a page,
 * print it in a hidden window, hand back the bytes.
 *
 * Four surfaces print this way — reading notes, cover letters, the
 * response-to-reviewers document, and the .docx viewer's page render — and
 * they differ only in the HTML they build and the paper they want it on. The
 * mechanics they share (a temp host file, `loadFile`, `printToPDF`, deleting
 * the file whether or not the print threw) live here once, so a fix to any of
 * it reaches all four.
 *
 * NOT the manuscript pipeline. `renderContentPdf` (export-pdf.ts) prints a
 * profile-resolved manuscript and owns everything a submission needs — line
 * numbers, themed margin bands, oversized-block measurement. Nothing here has
 * a journal profile, and a page that needed one would belong there instead.
 *
 * `win` lets a caller print in a long-lived hidden window rather than paying
 * to create and destroy one per render: the letter preview and the .docx
 * viewer both pass the shared preview window (export-preview.ts).
 */

import { BrowserWindow, app } from 'electron'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { HeadingLevel, Packer, type Document } from 'docx'
import { writeFileAtomic } from './atomic'


/**
 * The document shell every simple-pipeline page is built into: doctype, the
 * charset, the title, and that page's own stylesheet inline.
 *
 * Only the shell is shared. Each document keeps its own CSS and its own body
 * — a letter is not laid out like a response-to-reviewers and neither is laid
 * out like a Word file's page render — but "what a self-contained printable
 * page looks like from the outside" is one answer, and the pages that print
 * through `renderHtmlToPdf` all give it.
 *
 * Self-contained by construction: the CSS goes inline and nothing here links
 * out, so the page prints the same with no network and reads the same when
 * someone opens the exported .html years later.
 */
export function htmlDocument({ title, css, body }: { title: string; css: string; body: string }): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${css}</style>`,
    '</head><body>',
    body,
    '</body></html>'
  ].join('\n')
}

/**
 * The one HTML escaper of the simple pipeline, shared by every body builder
 * (notes, letters, responses) and by the shell's own title. Re-exported from
 * export-notes.ts for older importers.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** US Letter with 0.75in margins: what every document without its own stated
 *  page setup prints on. */
const DEFAULT_PAGE = { widthIn: 8.5, heightIn: 11 }
const DEFAULT_MARGIN_IN = 0.75

export interface PrintHtmlOptions {
  /** Print in THIS window and leave it alive, instead of creating one. */
  win?: BrowserWindow
  /** Paper size in inches. Defaults to US Letter. */
  pageSize?: { widthIn: number; heightIn: number }
  /** Page margins in inches — a number applies to all four sides. */
  margins?: number | { topIn: number; rightIn: number; bottomIn: number; leftIn: number }
  /** Centred page numbers in the footer. On by default: these are documents
   *  people print and hand around. */
  pageNumbers?: boolean
}

function marginsOf(margins: PrintHtmlOptions['margins']): {
  top: number
  right: number
  bottom: number
  left: number
} {
  if (margins === undefined) {
    return { top: DEFAULT_MARGIN_IN, right: DEFAULT_MARGIN_IN, bottom: DEFAULT_MARGIN_IN, left: DEFAULT_MARGIN_IN }
  }
  if (typeof margins === 'number') return { top: margins, right: margins, bottom: margins, left: margins }
  return { top: margins.topIn, right: margins.rightIn, bottom: margins.bottomIn, left: margins.leftIn }
}

/** Print `html` and return the PDF bytes. */
export async function renderHtmlToPdf(html: string, options: PrintHtmlOptions = {}): Promise<Buffer> {
  const page = options.pageSize ?? DEFAULT_PAGE
  const margin = marginsOf(options.margins)
  const pageNumbers = options.pageNumbers ?? true

  // A file, not a data: URL — a page carrying inlined figures runs to
  // megabytes, which is past what a URL can reliably carry.
  const hostPath = join(app.getPath('temp'), `suna-print-${process.pid}-${Date.now()}.html`)
  await writeFileAtomic(hostPath, html)
  const own = options.win === undefined
  const target =
    options.win ?? new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  try {
    await target.loadFile(hostPath)
    return await target.webContents.printToPDF({
      pageSize: { width: page.widthIn, height: page.heightIn },
      margins: { top: margin.top, bottom: margin.bottom, left: margin.left, right: margin.right },
      printBackground: true,
      displayHeaderFooter: pageNumbers,
      // Chromium draws its own date/title header unless one is supplied.
      headerTemplate: pageNumbers ? '<span></span>' : undefined,
      footerTemplate: pageNumbers
        ? '<div style="font-size:9px;width:100%;text-align:center;color:#666;"><span class="pageNumber"></span></div>'
        : undefined
    })
  } finally {
    if (own) target.destroy()
    await unlink(hostPath).catch(() => undefined)
  }
}

/** Print `html` straight to a file. */
export async function printHtmlToPdf(html: string, target: string, options: PrintHtmlOptions = {}): Promise<void> {
  await writeFileAtomic(target, await renderHtmlToPdf(html, options))
}

/** Markdown heading depth (1-6) -> docx HeadingLevel, shared by the simple-pipeline DOCX builders. */
export const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
] as const

export interface SimpleExportInput {
  /** Absolute directory the file lands in (output/notes, output/letters, output/responses). */
  outputDir: string
  /** File name without extension. */
  name: string
  format: 'pdf' | 'docx' | 'html'
  /** The self-contained page — written as-is for 'html', printed for 'pdf'. */
  html: string
  /** Built only when format === 'docx', so the other formats never pay for it. */
  docx: () => Document | Promise<Document>
}

/**
 * The one format dispatch of the simple pipeline (letters, responses, notes):
 * html -> the page itself, docx -> the packed Document, pdf -> the page
 * printed. Returns the absolute path written.
 */
export async function writeSimpleExport(input: SimpleExportInput): Promise<string> {
  const target = join(input.outputDir, `${input.name}.${input.format}`)
  if (input.format === 'html') {
    await writeFileAtomic(target, input.html)
  } else if (input.format === 'docx') {
    await writeFileAtomic(target, await Packer.toBuffer(await input.docx()))
  } else {
    await printHtmlToPdf(input.html, target)
  }
  return target
}
