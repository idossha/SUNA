import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import katex from 'katex'
import { parseSciMark, renderHtml, type CrossRefKind, type FigureResolution } from '@suna/markdown'
import { renderCluster, type Run } from '@suna/bib'
import type { DocumentStyle, HeadingLevel } from '@suna/core'
import {
  collectMarkdownImages,
  formatReferenceRow,
  isNumericCitationMode,
  markdownImagePath,
  splitTexSpans,
  widthMmForPreset,
  type ExportContent
} from './export-content'
import { documentStyleFor, isHouseStyle } from './export-style'
import { assertInsideAllowedRoot } from './roots'

/**
 * Renders an `ExportContent` to one self-contained HTML document — the PDF
 * path's input (export-pdf.ts loads this in a hidden BrowserWindow and calls
 * `printToPDF`). Citations, cross-references and the reference list go
 * through the exact same `@suna/markdown`/`@suna/bib` engine the combined
 * Manuscript tab renders with (ReferencesBlock.tsx, citations.ts) — see
 * export-content.ts's module doc for why those pieces are duplicated here
 * rather than imported from renderer/src.
 *
 * Known, deliberate simplification (ADR-002): the publisher profile schema
 * carries no page-geometry fields (size/margins/running heads) — ADR-002
 * explicitly descopes "typeset page facsimile" from what a profile encodes.
 * Page size/margins are therefore fixed, generic submission-manuscript
 * defaults (A4, 1in margins), set by export-pdf.ts's `printToPDF` call, not
 * read from the profile.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** $-delimited math only (title/abstract/significance/highlights) — mirrors manuscript/titlepage-edit/TexText.tsx exactly, not the fuller SciMark pipeline body prose gets. */
function texHtml(text: string): string {
  return splitTexSpans(text)
    .map((seg) =>
      seg.kind === 'math'
        ? katex.renderToString(seg.value, { throwOnError: false })
        : escapeHtml(seg.value)
    )
    .join('')
}

function runsToHtml(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      let inner = escapeHtml(run.text)
      if (run.link !== undefined && 'url' in run.link) {
        inner = `<a href="${escapeHtml(run.link.url)}">${inner}</a>`
      }
      if (run.style === 'italic') inner = `<em>${inner}</em>`
      else if (run.style === 'bold') inner = `<strong>${inner}</strong>`
      return inner
    })
    .join('')
}

const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

/**
 * An image file as a data: URI. Everything the page shows has to be inlined:
 * export-pdf.ts writes this HTML into a temp directory and `loadFile`s it
 * there, so a relative url like `../figures/x.png` resolves against the temp
 * directory and can never be found.
 */
async function imageDataUri(path: string): Promise<string> {
  const mime = IMAGE_MIME[extname(path).toLowerCase()]
  if (mime === undefined) throw new Error(`unsupported image type: ${path}`)
  const bytes = await readFile(path)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/**
 * Every markdown image in the prose, inlined and keyed by the url as written —
 * `renderHtml` is synchronous, so the bytes have to be in hand before it runs
 * (the same shape `figuresHtml` uses for managed figures). A url that is
 * remote, outside the project, or unreadable maps to `null`, which
 * `resolveImage` turns into the image's alt text rather than a broken `<img>`.
 */
async function markdownImages(content: ExportContent): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  for (const section of content.sections) {
    if (section.root === null) continue
    for (const { url } of collectMarkdownImages(section.root)) {
      if (map.has(url)) continue
      const path = markdownImagePath(url, content.manuscriptDir)
      if (path === null) {
        map.set(url, null)
        continue
      }
      try {
        map.set(url, await imageDataUri(assertInsideAllowedRoot(path)))
      } catch (error) {
        console.warn(`export: image "${url}" left as its alt text:`, error)
        map.set(url, null)
      }
    }
  }
  return map
}

function headingHtml(level: HeadingLevel, text: string): string {
  const safe = escapeHtml(text)
  switch (level) {
    case 'A':
      return `<h2 class="ms-h-a">${safe}</h2>`
    case 'B':
      return `<h3 class="ms-h-b">${safe}</h3>`
    case 'C-runin':
      // Journal "run-in" headings typeset as a bold lead-in on the same line
      // as the paragraph that follows; reproducing that exactly is page
      // layout (ADR-002 out of scope). This renders as its own bold line —
      // structurally distinguishable from A/B, not a page facsimile.
      return `<p class="ms-h-c">${safe}</p>`
  }
}

/** The `src` for one markdown image url, or null when it has to fall back to alt text. */
type ImageResolver = (url: string) => string | null

async function figuresHtml(
  content: ExportContent,
  resolveImage: ImageResolver
): Promise<Map<string, FigureResolution>> {
  const map = new Map<string, FigureResolution>()
  for (const fig of content.figures) {
    const widthMm = widthMmForPreset(fig.figure.widthPreset, content.profile)
    const dataUri = await imageDataUri(fig.pngPath)
    // `max-width`, not a definite `width`: pageCss now caps every image's
    // height at the page text height, and a definite width against that cap
    // squashes any figure taller than the page instead of scaling it.
    const img = `<img src="${dataUri}" alt="" style="max-width:min(${widthMm}mm,100%);height:auto;display:block;margin:0 auto;" />`
    const titleHtml = renderHtml(parseSciMark(fig.figure.caption.title), { resolveImage })
    const bodyHtml =
      fig.figure.caption.body.trim() === ''
        ? ''
        : renderHtml(parseSciMark(fig.figure.caption.body), { resolveImage })
    const captionHtml = `<strong>${escapeHtml(fig.label)}.</strong> ${titleHtml} ${bodyHtml}`.trim()
    map.set(fig.figure.id, { svgHtml: img, captionHtml })
  }
  return map
}

function tablesHtml(content: ExportContent, resolveImage: ImageResolver): string {
  if (content.tables.length === 0) return ''
  const rows = content.tables
    .map((t) => {
      const title = renderHtml(parseSciMark(t.table.caption.title), { resolveImage })
      const body =
        t.table.caption.body === undefined
          ? ''
          : renderHtml(parseSciMark(t.table.caption.body), { resolveImage })
      const footnotes =
        t.table.footnotes.length === 0
          ? ''
          : `<ul class="ms-table-footnotes">${t.table.footnotes
              .map((f) => `<li><sup>${escapeHtml(f.mark)}</sup> ${escapeHtml(f.text)}</li>`)
              .join('')}</ul>`
      return `<div class="ms-table-entry"><p><strong>${escapeHtml(t.label)}.</strong> ${title}</p>${body ? `<p>${body}</p>` : ''}${footnotes}</div>`
    })
    .join('\n')
  return `<section class="ms-tables"><h2 class="ms-h-a">Tables</h2>${rows}</section>`
}

function referencesHtml(content: ExportContent): string {
  const numeric = isNumericCitationMode(content.profile)
  const rows = content.referenceRows
    .map((row) => {
      const runs = formatReferenceRow(row, content.profile)
      const num = numeric ? `<span class="ms-ref-num">${row.number}.</span> ` : ''
      const body =
        runs === null
          ? `<span class="ms-ref-flag">@${escapeHtml(row.key)}</span> — cited but not found in ${escapeHtml(
              content.manuscript.bibliography
            )}`
          : runsToHtml(runs)
      return `<div class="ms-ref">${num}<span>${body}</span></div>`
    })
    .join('\n')
  return `<section class="ms-references"><h2 class="ms-h-a">References</h2>${rows}</section>`
}

function titlePageHtml(content: ExportContent): string {
  const m = content.manuscript
  const authorLine = content.authors.authors
    .map((author, i) => {
      const markers: string[] = []
      for (const id of author.affiliationRefs) {
        const n = content.affiliations.numberOf.get(id)
        if (n !== undefined) markers.push(String(n))
      }
      if (author.corresponding) markers.push('*')
      const sup = markers.length > 0 ? `<sup>${markers.join(',')}</sup>` : ''
      const comma = i > 0 ? ', ' : ''
      return `${comma}${escapeHtml(author.given)} ${escapeHtml(author.family)}${sup}`
    })
    .join('')
  const affiliationLines = content.affiliations.ordered
    .map((a, i) => `<div class="ms-affiliation"><sup>${i + 1}</sup>${escapeHtml(a.text)}</div>`)
    .join('')
  const correspondence = content.authors.authors
    .filter((a) => a.corresponding && a.email !== null)
    .map((a) => a.email)
    .filter((e): e is string => e !== null)
  const significance =
    m.significance != null
      ? `<section><div class="ms-label">Significance</div><p class="ms-front-text">${texHtml(m.significance)}</p></section>`
      : ''
  const highlights =
    m.highlights != null && m.highlights.length > 0
      ? `<section><div class="ms-label">Highlights</div><ul class="ms-highlights">${m.highlights
          .map((h) => `<li>${texHtml(h)}</li>`)
          .join('')}</ul></section>`
      : ''
  return `
<div class="ms-titlepage">
  <h1 class="ms-title">${texHtml(m.title)}</h1>
  <div class="ms-authors">${authorLine}</div>
  <div class="ms-affiliations">${affiliationLines}</div>
  ${correspondence.length > 0 ? `<div class="ms-correspondence">*e-mail: ${correspondence.map(escapeHtml).join(', ')}</div>` : ''}
  <section><div class="ms-label">Abstract</div><p class="ms-front-text">${texHtml(m.abstract.content)}</p></section>
  ${significance}
  ${highlights}
</div>`
}

/**
 * The PDF stylesheet, derived from the same DocumentStyle the DOCX writer
 * uses (export-style.ts) so a manuscript exported both ways is set the same:
 * same font, same point sizes, same line spacing, same caption treatment.
 *
 * A journal profile states no typography (ADR-002) and gets LEGACY_STYLE,
 * which reproduces exactly the CSS that was hardcoded here before — so
 * journal PDFs are unchanged. SUNA style brings docx-tools' geometry.
 */
function pageCss(style: DocumentStyle, house: boolean): string {
  const s = style.sizesPt
  // The printable box, which is what an image may not exceed in either axis.
  const round1 = (mm: number): number => Math.round(mm * 10) / 10
  const textHeightMm = round1(style.page.heightMm - 2 * style.page.marginMm)
  return `
  * { box-sizing: border-box; }
  body { font-family: '${style.fonts.body}', Georgia, serif; font-size: ${s.body}pt; line-height: ${style.lineSpacing}; color: #000; margin: 0; }
  .ms-titlepage { text-align: center; margin-bottom: ${house ? 14 : 24}pt; }
  .ms-title { font-size: ${s.title}pt; font-weight: 700; margin: 0 0 ${house ? 4 : 10}pt; }
  .ms-authors { font-size: ${s.author}pt; margin-bottom: ${house ? 6 : 6}pt; }
  .ms-affiliation { font-size: ${s.affiliation}pt; margin-bottom: 1pt; }
  .ms-correspondence { font-size: ${s.affiliation}pt; font-style: italic; margin: ${house ? '4pt 0 14pt' : '6pt 0'}; }
  .ms-label { font-weight: 700; text-align: left; margin-top: 10pt; }
  .ms-front-text, .ms-highlights { text-align: left; }
  .ms-body { text-align: left; }
  .ms-body.ms-double p, .ms-body.ms-double li { line-height: 2; }
  .ms-body p { text-align: ${house ? 'left' : 'justify'}; margin: 0 0 ${style.bodySpaceAfterPt}pt; }
  .ms-h-a { font-size: ${s.heading1}pt; font-weight: 700; ${house ? 'color:#000;' : ''} margin: ${house ? '12pt 0 4pt' : '18pt 0 0'}; }
  .ms-h-b { font-size: ${s.heading2}pt; font-weight: 700; ${house ? 'color:#000;' : ''} margin: ${house ? '8pt 0 4pt' : '12pt 0 0'}; }
  .ms-h-c { font-weight: 700; font-style: italic; margin: 8pt 0 0; }
  .ms-h-box { font-size: ${s.heading2}pt; font-weight: 700; font-style: italic; margin-top: 12pt; }
  figure.figure { margin: ${house ? '6pt 0 12pt' : '12pt 0'}; text-align: center; }
  figure.figure figcaption { font-size: ${s.caption}pt; text-align: center; margin-top: 4pt; }
  ${house ? 'figure.figure figcaption .ms-caption-body { font-style: italic; }' : ''}
  img.md-image, .ms-body img, figure.figure img { display: block; margin: 0 auto; width: auto; height: auto; max-width: 100%; max-height: ${textHeightMm}mm; }
  .ms-ref { font-size: ${s.reference}pt; margin: 0 0 4pt 0; padding-left: ${style.referenceHangingMm}mm; text-indent: -${style.referenceHangingMm}mm; }
  .ms-ref-num { font-weight: 600; }
  .ms-ref-flag { color: #a00; }
  table { border-collapse: collapse; margin: 8pt auto; width: auto; max-width: 100%; }
  ${
    house
      ? // APA rules only, matching the DOCX writer's table treatment. The
        // house column convention is scoped to cells carrying no inline
        // style, so a GFM `:---:` delimiter row (which @suna/markdown emits
        // as `style="text-align:…"`) wins over it.
        `th, td { border: 0; padding: 2pt 3pt; font-size: ${s.tableCell}pt; text-align: start; }
  th:not([style]), td:not([style]) { text-align: center; }
  td:first-child:not([style]) { text-align: left; }
  thead th { border-top: 1pt solid #000; border-bottom: 1pt solid #000; font-weight: 700; }
  tbody tr:last-child td { border-bottom: 1pt solid #000; }`
      : `th, td { border: 0.5pt solid #666; padding: 3pt 6pt; font-size: 10pt; text-align: start; }`
  }
  .ms-table-entry { margin-bottom: 10pt; }
  .ms-table-footnotes { font-size: ${house ? s.caption : 9}pt; margin: 2pt 0 0; padding-left: 1.2em; }
`
}

export interface BuildHtmlOptions {
  doubleSpacing: boolean
  /** Reserves the left gutter export-pdf.ts's line-number injection writes into; ignored otherwise. */
  lineNumbers: boolean
}

export async function buildManuscriptHtml(
  content: ExportContent,
  options: BuildHtmlOptions
): Promise<string> {
  const imageMap = await markdownImages(content)
  // Anything the map does not carry — remote, outside the project, unreadable
  // — resolves to null, so a broken `<img>` can never reach the printed page.
  const resolveImage: ImageResolver = (url) => imageMap.get(url) ?? null
  const figureMap = await figuresHtml(content, resolveImage)

  const resolveCitation = (keys: string[], narrative: boolean): string => {
    const rendering = renderCluster({ keys, narrative }, content.numbers, content.citeStyle, content.entryMap)
    const html = runsToHtml(rendering.inline)
    return rendering.form === 'superscript' ? `<sup>${html}</sup>` : html
  }

  const resolveCrossRef = (kind: CrossRefKind, id: string, suffix?: string): string => {
    const map =
      kind === 'fig'
        ? content.labels.figures
        : kind === 'tbl'
          ? content.labels.tables
          : kind === 'eq'
            ? content.labels.equations
            : content.labels.sections
    const label = map.get(id)
    const text = label === undefined ? `${kind}:${id}` : suffix !== undefined ? `${label}${suffix}` : label
    return escapeHtml(text)
  }

  const resolveFigure = (figureId: string): FigureResolution => figureMap.get(figureId) ?? {}

  const sectionsHtml = content.sections
    .map((section) => {
      const heading = section.heading !== null ? headingHtml(section.level, section.heading) : ''
      const body =
        section.root === null
          ? ''
          : renderHtml(section.root, { resolveCitation, resolveCrossRef, resolveFigure, resolveImage })
      return `${heading}\n${body}`
    })
    .join('\n')

  const bodyClass = `ms-body${options.doubleSpacing ? ' ms-double' : ''}${options.lineNumbers ? ' ms-line-numbers' : ''}`

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="katex.min.css">
<style>${pageCss(documentStyleFor(content.profile), isHouseStyle(content.profile))}</style>
</head>
<body>
<div class="ms-page">
${titlePageHtml(content)}
<div class="${bodyClass}" id="ms-body">
${sectionsHtml}
${tablesHtml(content, resolveImage)}
${referencesHtml(content)}
</div>
</div>
</body></html>`
}
