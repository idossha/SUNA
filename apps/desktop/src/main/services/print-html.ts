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
import { HeadingLevel, Packer, type Document, type IStylesOptions } from 'docx'
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

/**
 * The simple-pipeline typography, as a docx styles block.
 *
 * Each simple export (letter, response, notes) already states its design once
 * — in its page CSS — and the Word file must be the same document, not that
 * document reskinned by Word's default theme (blue Calibri headings). So the
 * builders hand this helper the same numbers their CSS states — pt sizes,
 * hex colours — and it patches the built-in Title / Heading1..6 styles
 * through docx's `styles.default` hooks. Patching the built-ins (rather than
 * dropping `heading:`) keeps Word's outline pane and navigation working.
 *
 * `styles.default.headingN`, NOT `paragraphStyles: [{ id: 'HeadingN' }]`:
 * the docx library always writes its own Heading1..6 (in Word's theme blue,
 * `2E74B5`) and a `paragraphStyles` entry with the same id is appended as a
 * DUPLICATE, which Word resolves by keeping the first — the blue one. The
 * default hook replaces the built-in entry itself, so styles.xml carries one
 * definition per id and it is ours.
 *
 * Sizes are CSS points; docx wants half-points, so the ×2 lives here, once.
 * Colours are `RRGGBB` (no `#`), the way docx takes them. Headings default
 * to bold near-black in the shared serif — a spec entry states only what
 * differs.
 */
export const SIMPLE_DOC_FONT = 'Georgia'
/** The simple pages' body ink — #17181a in every simple-pipeline stylesheet. */
export const SIMPLE_DOC_COLOR = '17181A'

export interface SimpleHeadingSpec {
  /** Font size in CSS points (the number the page CSS states). */
  sizePt: number
  /** `RRGGBB`; defaults to the shared near-black. */
  color?: string
  /** Headings are bold unless a spec opts out. */
  bold?: boolean
  italics?: boolean
}

type SimpleParagraphStyle = NonNullable<NonNullable<IStylesOptions['default']>['title']>

function headingStyleOf(spec: SimpleHeadingSpec): SimpleParagraphStyle {
  return {
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: {
      font: SIMPLE_DOC_FONT,
      size: Math.round(spec.sizePt * 2),
      bold: spec.bold ?? true,
      italics: spec.italics ?? false,
      color: spec.color ?? SIMPLE_DOC_COLOR
    }
  }
}

export function simpleDocStyles(spec: {
  /** Body size in CSS points (11 everywhere today). */
  bodySizePt: number
  title: SimpleHeadingSpec
  /** Markdown-ish depth (1-6) -> that heading level's look. A level left
   *  out is still patched — to a bold body-size line in the body ink — so no
   *  level of any simple export ever falls through to Word's blue. */
  headings: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, SimpleHeadingSpec>>
}): IStylesOptions {
  const headings = { ...spec.headings }
  for (const level of [1, 2, 3, 4, 5, 6] as const) headings[level] ??= { sizePt: spec.bodySizePt }
  return {
    default: {
      document: {
        run: {
          font: SIMPLE_DOC_FONT,
          size: Math.round(spec.bodySizePt * 2),
          color: SIMPLE_DOC_COLOR
        },
        paragraph: { spacing: { line: 300 } }
      },
      title: headingStyleOf(spec.title),
      heading1: headingStyleOf(headings[1]!),
      heading2: headingStyleOf(headings[2]!),
      heading3: headingStyleOf(headings[3]!),
      heading4: headingStyleOf(headings[4]!),
      heading5: headingStyleOf(headings[5]!),
      heading6: headingStyleOf(headings[6]!)
    }
  }
}

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
