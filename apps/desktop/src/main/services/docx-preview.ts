/**
 * Rendering a .docx that already exists on disk, so clicking one in the
 * explorer shows the document instead of a wall of zip bytes.
 *
 * Nothing in an Electron app renders Word natively — the same wall
 * export-preview.ts runs into for the DOCX format. The route here is the
 * same one that preview takes, applied to a file instead of to the project's
 * sources: mammoth converts the document's text and images to HTML, the
 * file's OWN page setup (page size, margins, default face and point size,
 * read straight out of the OOXML) styles it, and that page prints through
 * the shared hidden window to a PDF the viewer draws with PagedDocument.
 *
 * So the pages are the file's pages — Word's paper, Word's margins, Word's
 * body face — but Word breaks lines itself, so a page count near a boundary
 * can differ by one, and Word features mammoth does not convert (equations,
 * text boxes, headers/footers, tracked changes) are not on them. The viewer
 * says so rather than passing this off as Word's own render; "Open in Word"
 * is one click away for the real thing.
 *
 * Every parser here is a pure string-in/data-out function so the geometry
 * and style reading can be unit-tested without Electron or a .docx.
 */

import mammoth from 'mammoth'
import { DOCX_STYLE_MAP, countOmmlEquations, readDocxParts } from './docx-parts'
import { withPreviewWindow } from './export-preview'
import { htmlDocument, renderHtmlToPdf } from './print-html'
import { assertInsideAllowedRoot } from './roots'

/** One twip is 1/1440 inch — the unit every OOXML page measurement uses. */
const TWIPS_PER_INCH = 1440

/** US Letter with one-inch margins: what Word itself falls back to. */
export const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
  widthIn: 8.5,
  heightIn: 11,
  marginTopIn: 1,
  marginRightIn: 1,
  marginBottomIn: 1,
  marginLeftIn: 1
}

export interface PageGeometry {
  widthIn: number
  heightIn: number
  marginTopIn: number
  marginRightIn: number
  marginBottomIn: number
  marginLeftIn: number
}

export interface DocDefaults {
  /** The document's default body face, or null when it states none. */
  fontFamily: string | null
  /** Default body size in points, or null when it states none. */
  fontSizePt: number | null
}

function twipsToInches(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const twips = Number(value)
  // Word writes negative margins for gutters/mirrors we do not model, and a
  // zero page dimension is a corrupt file — either way the fallback is safer
  // than a page that cannot be printed.
  if (!Number.isFinite(twips) || twips <= 0) return fallback
  return twips / TWIPS_PER_INCH
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag)
  return match?.[1]
}

/**
 * The page setup from word/document.xml. Word puts one `<w:sectPr>` at the
 * end of the body for the document's own section and one INSIDE each
 * paragraph that starts a new section, so the last match is the body's —
 * anything missing falls back to Letter/1in rather than failing the render.
 */
export function parsePageGeometry(documentXml: string): PageGeometry {
  const sections = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)
  const section = sections === null ? null : (sections[sections.length - 1] ?? null)
  if (section === null) return DEFAULT_PAGE_GEOMETRY

  const pgSz = /<w:pgSz\b[^>]*>/.exec(section)?.[0] ?? ''
  const pgMar = /<w:pgMar\b[^>]*>/.exec(section)?.[0] ?? ''
  return {
    widthIn: twipsToInches(attr(pgSz, 'w:w'), DEFAULT_PAGE_GEOMETRY.widthIn),
    heightIn: twipsToInches(attr(pgSz, 'w:h'), DEFAULT_PAGE_GEOMETRY.heightIn),
    marginTopIn: twipsToInches(attr(pgMar, 'w:top'), DEFAULT_PAGE_GEOMETRY.marginTopIn),
    marginRightIn: twipsToInches(attr(pgMar, 'w:right'), DEFAULT_PAGE_GEOMETRY.marginRightIn),
    marginBottomIn: twipsToInches(attr(pgMar, 'w:bottom'), DEFAULT_PAGE_GEOMETRY.marginBottomIn),
    marginLeftIn: twipsToInches(attr(pgMar, 'w:left'), DEFAULT_PAGE_GEOMETRY.marginLeftIn)
  }
}

/**
 * The document's default face and size from word/styles.xml `docDefaults`.
 * Sizes are half-points in OOXML (`w:sz w:val="24"` is 12 pt).
 */
export function parseDocDefaults(stylesXml: string): DocDefaults {
  const defaults = /<w:docDefaults[\s\S]*?<\/w:docDefaults>/.exec(stylesXml)?.[0] ?? ''
  const fonts = /<w:rFonts\b[^>]*>/.exec(defaults)?.[0] ?? ''
  const family = attr(fonts, 'w:ascii') ?? null
  const sizeVal = attr(/<w:sz\b[^>]*>/.exec(defaults)?.[0] ?? '', 'w:val')
  const halfPoints = sizeVal === undefined ? NaN : Number(sizeVal)
  return {
    fontFamily: family !== null && family !== '' ? family : null,
    fontSizePt: Number.isFinite(halfPoints) && halfPoints > 0 ? halfPoints / 2 : null
  }
}

function cssFontStack(family: string | null): string {
  // A face the machine does not have falls through to the generic serif
  // rather than to Chromium's default sans, which would misreport the
  // document's texture more than a substituted serif does.
  return family === null ? "'Times New Roman', Times, serif" : `'${family.replace(/'/g, '')}', 'Times New Roman', Times, serif`
}

/**
 * mammoth's fragment as a printable page: the document's own body face and
 * size, its page width as the layout width, and print rules for the pieces
 * mammoth does emit (tables, images, headings).
 *
 * Horizontal margins live in printToPDF's own margins, not in body padding —
 * this page has no themed background to paint into them (unlike the
 * manuscript export), so Chromium's refusal to paint page margins costs
 * nothing here.
 */
export function wrapDocxHtml(body: string, geometry: PageGeometry, defaults: DocDefaults): string {
  const textWidthIn = Math.max(1, geometry.widthIn - geometry.marginLeftIn - geometry.marginRightIn)
  // The same self-contained shell the letter, notes and response pages print
  // from (print-html.ts) — only the CSS below is this document's own.
  return htmlDocument({
    title: 'Document preview',
    css: `
  html { font-size: ${defaults.fontSizePt ?? 11}pt; }
  body {
    margin: 0;
    width: ${textWidthIn}in;
    font-family: ${cssFontStack(defaults.fontFamily)};
    font-size: 1rem;
    line-height: 1.35;
    color: #000;
  }
  p { margin: 0 0 0.5em; }
  h1, h2, h3, h4, h5, h6 { font-family: inherit; margin: 1em 0 0.4em; line-height: 1.25; page-break-after: avoid; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.3rem; }
  h3 { font-size: 1.15rem; }
  h4, h5, h6 { font-size: 1rem; }
  blockquote { margin: 0.6em 0 0.6em 0.5in; }
  ul, ol { margin: 0 0 0.5em; padding-left: 0.3in; }
  table { border-collapse: collapse; width: 100%; margin: 0.6em 0; page-break-inside: avoid; }
  th, td { border: 0.5pt solid #666; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  img { max-width: 100%; height: auto; }
  a { color: inherit; }
`,
    body
  })
}

export interface DocxPreviewResult {
  /** Base64 PDF bytes — the same shape PagedDocument already draws. */
  data: string
  /** Page geometry actually used, so the viewer can name the paper. */
  geometry: PageGeometry
  /** Non-fatal conversion notes (mammoth errors, unconverted equations). */
  warnings: string[]
  ms: number
}

/**
 * Render an existing .docx to PDF bytes. Root-confined exactly like the rest
 * of the fs surface: a preview may only be asked for a file inside an open
 * project.
 */
export async function previewDocx(path: string): Promise<DocxPreviewResult> {
  const started = Date.now()
  const abs = assertInsideAllowedRoot(path)
  const warnings: string[] = []

  const convertImage = mammoth.images.imgElement(async (image) => {
    const buffer = await image.read()
    // Data URIs, not temp files: the page is thrown away after the print, so
    // there is nothing to clean up and nothing for the print to fail to find.
    return { src: `data:${image.contentType};base64,${buffer.toString('base64')}` }
  })
  // The SAME style map the import route converts with (docx-parts.ts): the
  // same file read two ways must not disagree about what a heading is.
  const converted = await mammoth.convertToHtml({ path: abs }, { styleMap: DOCX_STYLE_MAP, convertImage })
  for (const message of converted.messages) {
    if (message.type === 'error') warnings.push(message.message)
  }

  let geometry = DEFAULT_PAGE_GEOMETRY
  let defaults: DocDefaults = { fontFamily: null, fontSizePt: null }
  try {
    const { documentXml, stylesXml } = await readDocxParts(abs)
    geometry = parsePageGeometry(documentXml)
    defaults = parseDocDefaults(stylesXml)
    const equations = countOmmlEquations(documentXml)
    if (equations > 0) {
      warnings.push(
        `${equations} Word equation${equations === 1 ? '' : 's'} are not shown — mammoth does not convert OOXML math.`
      )
    }
  } catch (error) {
    // A readable .docx whose parts we cannot inspect still previews, just on
    // the default page.
    warnings.push(
      `Page setup could not be read from the file; showing US Letter with 1in margins (${
        error instanceof Error ? error.message : String(error)
      }).`
    )
  }

  const html = wrapDocxHtml(converted.value, geometry, defaults)
  // The shared simple-pipeline printer (print-html.ts) — the same one the
  // letter, notes and response exports print through — on this file's own
  // paper. No page-number footer: these are Word's pages, and Word puts its
  // own numbers on them (in a footer this render does not carry).
  const pdf = await withPreviewWindow((win) =>
    renderHtmlToPdf(html, {
      win,
      pageSize: { widthIn: geometry.widthIn, heightIn: geometry.heightIn },
      margins: {
        topIn: geometry.marginTopIn,
        rightIn: geometry.marginRightIn,
        bottomIn: geometry.marginBottomIn,
        leftIn: geometry.marginLeftIn
      },
      pageNumbers: false
    })
  )
  return { data: pdf.toString('base64'), geometry, warnings, ms: Date.now() - started }
}
