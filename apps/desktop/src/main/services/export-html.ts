import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import katex from 'katex'
import {
  parseSciMark,
  renderHtml,
  type CrossRefKind,
  type FigureResolution,
  type SciMarkRoot,
  type TableResolution
} from '@suna/markdown'
import { renderCluster, type Run } from '@suna/bib'
import type { ExportOptions, HeadingLevel } from '@suna/core'
import {
  backMatterSections,
  buildExportContent,
  buildSupplementContent,
  collectMarkdownImages,
  collectTableEmbeds,
  collectTables,
  formatReferenceRow,
  isNumericCitationMode,
  markdownImagePath,
  slugifyHeading,
  splitTexSpans,
  withoutTables,
  type ExportContent,
  type RootChild,
  type TableNode
} from './export-content'
import { writeFileAtomic } from './atomic'
import { projectSubdir } from './paths'
import { exportPalette, resolveDocumentStyle, type ExportPalette, type ResolvedDocumentStyle } from './export-style'
import { assertInsideAllowedRoot } from './roots'

/**
 * Renders an `ExportContent` to one self-contained HTML document. Three pages
 * come out of this module:
 * - `buildManuscriptHtml` — the print-styled manuscript page the PDF path
 *   feeds to a hidden BrowserWindow's `printToPDF` (export-pdf.ts);
 * - `buildSupplementHtml` — its Supplementary Information twin;
 * - `buildReaderHtml` + `exportHtml` — the standalone 'export:html' web page
 *   that mirrors the SUNA reading tab (linked citations, in-page cross-refs,
 *   inlined KaTeX/figures; see its doc below).
 * Citations, cross-references and the reference list go
 * through the exact same `@suna/markdown`/`@suna/bib` engine the combined
 * Manuscript tab renders with (ReferencesBlock.tsx, citations.ts) — see
 * export-content.ts's module doc for why those pieces are duplicated here
 * rather than imported from renderer/src.
 *
 * Typography is the ALWAYS-ON SUNA house style resolved through
 * export-style.ts's `resolveDocumentStyle` — the same object the DOCX writer
 * consumes, so the two outputs are set the same. Journal profiles carry only
 * the convention deltas their guidelines state (figureLabel, figurePlacement,
 * tablePlacement, referencesStartNewPage); page size/margins reach the PDF
 * through export-pdf.ts's `printToPDF` call, from the same resolved style.
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

function headingHtml(level: HeadingLevel, text: string, anchorId?: string): string {
  const safe = escapeHtml(text)
  const id = anchorId !== undefined ? ` id="${escapeHtml(anchorId)}"` : ''
  switch (level) {
    case 'A':
      return `<h2 class="ms-h-a"${id}>${safe}</h2>`
    case 'B':
      return `<h3 class="ms-h-b"${id}>${safe}</h3>`
    case 'C-runin':
      // Journal "run-in" headings typeset as a bold lead-in on the same line
      // as the paragraph that follows; reproducing that exactly is page
      // layout (ADR-002 out of scope). This renders as its own bold line —
      // structurally distinguishable from A/B, not a page facsimile.
      return `<p class="ms-h-c"${id}>${safe}</p>`
  }
}

/** The `src` for one markdown image url, or null when it has to fall back to alt text. */
type ImageResolver = (url: string) => string | null

/**
 * Caption text rendered INLINE. The block pipeline wraps every paragraph in
 * `<p data-pos>`, which inside a `<figcaption>` / `<em>` splits a caption
 * into separate left-aligned paragraphs (and is invalid nesting besides) —
 * a caption is one run of styled text, so the wrappers come off.
 */
function inlineMd(md: string, resolveImage: ImageResolver): string {
  return renderHtml(parseSciMark(md), { resolveImage })
    .replace(/<p[^>]*>/g, '')
    .replace(/<\/p>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function figuresHtml(
  content: ExportContent,
  style: ResolvedDocumentStyle,
  resolveImage: ImageResolver,
  /** Fixed width in mm (the supplement's 165 mm ground truth) overriding the preset rule. */
  widthOverrideMm?: number
): Promise<Map<string, FigureResolution>> {
  const inline = style.figurePlacement === 'inline'
  const map = new Map<string, FigureResolution>()
  for (const fig of content.figures) {
    const titleHtml = inlineMd(fig.figure.caption.title, resolveImage)
    const bodyHtml =
      fig.figure.caption.body.trim() === ''
        ? ''
        : inlineMd(fig.figure.caption.body, resolveImage)
    const captionHtml = `<strong>${escapeHtml(fig.label)}.</strong> ${titleHtml} ${bodyHtml}`.trim()
    if (!inline) {
      // captions-list mode: no image in the body at all; the caption renders
      // in the "Figure Captions" section after the references instead.
      map.set(fig.figure.id, {})
      continue
    }
    // A journal preset wins when the profile states one; otherwise the
    // style's own default width — same rule as the DOCX writer's figureBlock.
    const widthMm =
      widthOverrideMm ?? content.profile.figures.widthPresetsMm[fig.figure.widthPreset] ?? style.figureWidthMm
    const dataUri = await imageDataUri(fig.pngPath)
    // `max-width`, not a definite `width`: pageCss caps every image's height
    // at the page text height, and a definite width against that cap
    // squashes any figure taller than the page instead of scaling it.
    const img = `<img src="${dataUri}" alt="" style="max-width:min(${widthMm}mm,100%);height:auto;display:block;margin:0 auto;" />`
    map.set(fig.figure.id, { svgHtml: img, captionHtml })
  }
  return map
}

/**
 * The "Note." line under a table: caption body first, then the superscript
 * footnotes, all one italic run (the SUNA standard; see the table-note CSS).
 * Empty string when the table has neither.
 */
function tableNoteHtml(content: ExportContent, tableId: string, resolveImage: ImageResolver): string {
  const entry = content.tables.find((t) => t.table.id === tableId)
  if (entry === undefined) return ''
  const parts: string[] = []
  if (entry.table.caption.body !== undefined && entry.table.caption.body.trim() !== '') {
    parts.push(inlineMd(entry.table.caption.body, resolveImage))
  }
  for (const f of entry.table.footnotes) {
    parts.push(`<sup>${escapeHtml(f.mark)}</sup> ${escapeHtml(f.text)}`)
  }
  if (parts.length === 0) return ''
  return `<em class="ms-note-label">Note.</em> ${parts.join(' ')}`
}

/**
 * `![[tbl:id]]` resolutions for a body render: bold derived "Table N." label,
 * italic title above the table, "Note." below. `anchored` adds the in-page
 * cross-ref jump target the reader/web page links to.
 */
function tablesResolutionMap(
  content: ExportContent,
  resolveImage: ImageResolver,
  anchored: boolean
): Map<string, TableResolution> {
  const map = new Map<string, TableResolution>()
  for (const t of content.tables) {
    const title = inlineMd(t.table.caption.title, resolveImage)
    const anchor = anchored ? `<span class="ms-anchor" id="tbl-${escapeHtml(t.table.id)}"></span>` : ''
    const captionHtml = `${anchor}<strong>${escapeHtml(t.label)}.</strong> <em>${title}</em>`
    const note = tableNoteHtml(content, t.table.id, resolveImage)
    map.set(t.table.id, note === '' ? { captionHtml } : { captionHtml, noteHtml: note })
  }
  return map
}

/** Table ids the prose embeds via `![[tbl:id]]` — those render in place, not in the trailing section. */
function embeddedTableIds(content: ExportContent): Set<string> {
  return new Set(content.sections.flatMap((s) => (s.root === null ? [] : collectTableEmbeds(s.root))))
}

function tableEntriesHtml(
  content: ExportContent,
  resolveImage: ImageResolver,
  exclude: ReadonlySet<string> = new Set()
): string {
  return content.tables
    .filter((t) => !exclude.has(t.table.id))
    .map((t) => {
      const title = inlineMd(t.table.caption.title, resolveImage)
      const body =
        t.table.caption.body === undefined
          ? ''
          : inlineMd(t.table.caption.body, resolveImage)
      const footnotes =
        t.table.footnotes.length === 0
          ? ''
          : `<ul class="ms-table-footnotes">${t.table.footnotes
              .map((f) => `<li><sup>${escapeHtml(f.mark)}</sup> ${escapeHtml(f.text)}</li>`)
              .join('')}</ul>`
      return `<div class="ms-table-entry"><p><strong>${escapeHtml(t.label)}.</strong> ${title}</p>${body ? `<p>${body}</p>` : ''}${footnotes}</div>`
    })
    .join('\n')
}

/**
 * The pre-references "Tables" section (`tablePlacement: 'inline'`): captions
 * of the managed tables the prose does NOT embed — embedded ones render in
 * place, caption above and note below.
 */
function tablesHtml(content: ExportContent, resolveImage: ImageResolver): string {
  const exclude = embeddedTableIds(content)
  if (content.tables.every((t) => exclude.has(t.table.id))) return ''
  return `<section class="ms-tables"><h2 class="ms-h-a">Tables</h2>${tableEntriesHtml(content, resolveImage, exclude)}</section>`
}

interface BodyResolvers {
  resolveCitation: (keys: string[], narrative: boolean) => string
  resolveCrossRef: (kind: CrossRefKind, id: string, suffix?: string) => string
  resolveImage: ImageResolver
}

/**
 * The `tablePlacement: 'end'` section: manuscript.json table captions plus
 * every markdown table the body suppressed, after the captions list —
 * mirroring the DOCX writer's endTablesParagraphs.
 */
function endTablesHtml(content: ExportContent, mdTables: readonly TableNode[], resolvers: BodyResolvers): string {
  if (content.tables.length === 0 && mdTables.length === 0) return ''
  const rendered = mdTables
    .map((t) => renderHtml({ type: 'root', children: [t] } as unknown as SciMarkRoot, resolvers))
    .join('\n')
  return `<section class="ms-tables"><h2 class="ms-h-a">Tables</h2>${tableEntriesHtml(content, resolvers.resolveImage)}${rendered}</section>`
}

/** The `figurePlacement: 'captions-list'` section: every figure's caption, after the references. */
function figureCaptionsHtml(content: ExportContent, resolveImage: ImageResolver): string {
  if (content.figures.length === 0) return ''
  const rows = content.figures
    .map((fig) => {
      const title = inlineMd(fig.figure.caption.title, resolveImage)
      const body =
        fig.figure.caption.body.trim() === ''
          ? ''
          : ` ${inlineMd(fig.figure.caption.body, resolveImage)}`
      return `<p class="ms-figure-caption"><strong>${escapeHtml(fig.label)}.</strong> ${title}${body}</p>`
    })
    .join('\n')
  return `<section class="ms-figure-captions"><h2 class="ms-h-a">Figure Captions</h2>${rows}</section>`
}

/**
 * Back matter as H1 sections in the ground-truth order (backMatterSections in
 * export-content.ts) — prose fields go through the full SciMark pipeline so
 * formatting and citations render exactly as they do in the body.
 */
function backMatterHtml(content: ExportContent, resolvers: BodyResolvers): string {
  return backMatterSections(content)
    .map(
      (section) =>
        `<section class="ms-backmatter"><h2 class="ms-h-a">${escapeHtml(section.title)}</h2>${section.paragraphs
          .map((text) => renderHtml(parseSciMark(text), resolvers))
          .join('')}</section>`
    )
    .join('\n')
}

function referencesHtml(content: ExportContent, title = 'References'): string {
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
  return `<section class="ms-references"><h2 class="ms-h-a">${escapeHtml(title)}</h2>${rows}</section>`
}

/**
 * The byline — authors with affiliation markers, numbered affiliations,
 * corresponding line — shared by the manuscript title page and the
 * Supplementary Information cover (which repeats the SAME author block).
 */
function bylineHtml(content: ExportContent): string {
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
  return `
  <div class="ms-authors">${authorLine}</div>
  <div class="ms-affiliations">${affiliationLines}</div>
  ${correspondence.length > 0 ? `<div class="ms-correspondence">* Corresponding author: ${correspondence.map(escapeHtml).join(', ')}</div>` : ''}`
}

function titlePageHtml(content: ExportContent): string {
  const m = content.manuscript
  const keywords =
    m.keywords !== undefined && m.keywords.length > 0
      ? `<p class="ms-keywords"><strong>Keywords: </strong><em>${m.keywords.map(escapeHtml).join('; ')}</em></p>`
      : ''
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
  ${bylineHtml(content)}
  <section><div class="ms-label">Abstract</div><p class="ms-front-text">${texHtml(m.abstract.content)}</p></section>
  ${keywords}
  ${significance}
  ${highlights}
</div>`
}

/**
 * Page-break rules for the printed stylesheet (feature-plan-13 §A2).
 *
 * Before this existed the ONLY break declaration in the whole print
 * stylesheet was `page-break-before` on the references section, so Chromium
 * split a table wherever the page happened to end, stranded a caption at a
 * page foot, and separated a figure from its legend. A split table is not a
 * cosmetic defect in a scientific manuscript — a row torn across a page
 * boundary is unreadable and an editor sees it before they see the science.
 *
 * `.table-block` is the wrapper that already holds caption + table + note
 * together (see the .table-block rules above), so `break-inside: avoid` on
 * it is the single rule that does the work. The `table`/`tbody tr` rules are
 * the fallback for a block too tall to honour it: the block splits, but a
 * ROW still never tears in half, and `table-header-group` repeats the header
 * on every continuation page. That degradation is measured and reported
 * rather than left silent — see measureOversizedBlocks in export-pdf.ts.
 *
 * `break-after: avoid` on the headings is not part of the user's ask, but a
 * heading alone at the foot of a page is the same class of defect and the
 * rule is one line.
 */
const BREAK_CSS = `
  .table-block, figure.figure, .ms-table-entry { break-inside: avoid; }
  table, thead, tbody tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .ms-h-a, .ms-h-b, .ms-h-c, .ms-h-box { break-after: avoid; }
  .ms-ref { break-inside: avoid; }
  .ms-body p, .ms-body li { orphans: 3; widows: 3; }
`

/**
 * The PDF stylesheet, derived from the same ResolvedDocumentStyle the DOCX
 * writer uses (export-style.ts) so a manuscript exported both ways is set the
 * same: same font, same point sizes, same line spacing, same caption
 * treatment. The SUNA house style is the always-on base; a journal profile
 * only shifts the convention fields its guidelines state.
 */
function pageCss(style: ResolvedDocumentStyle, palette?: ExportPalette): string {
  // Untinted print (black on the paper) unless the export asked for the app
  // theme — then ink/background/rules come from the theme palette so the PDF
  // reads like the tab it was exported from.
  const ink = palette?.ink ?? '#000'
  // On <html>, not <body>: the root element's background propagates to the
  // print canvas, so the theme fills the page MARGINS too instead of leaving
  // a white frame around the themed text box.
  const bg = palette === undefined ? '' : `html { background: ${palette.bg}; }`
  const err = palette === undefined ? '#a00' : '#d97b6c'
  const s = style.sizesPt
  // The printable box, which is what an image may not exceed in either axis.
  const round1 = (mm: number): number => Math.round(mm * 10) / 10
  const textHeightMm = round1(style.page.heightMm - 2 * style.page.marginMm)
  return `
  * { box-sizing: border-box; }
  ${bg}
  body { font-family: '${style.fonts.body}', Georgia, serif; font-size: ${s.body}pt; line-height: ${style.lineSpacing}; color: ${ink}; margin: 0; ${
    // Themed page: printToPDF zeroes the left/right page margins (Chromium
    // cannot paint them) and the body carries them as padding instead.
    palette === undefined ? '' : `padding: 0 ${style.page.marginMm}mm;`
  } }
  .ms-titlepage { text-align: center; margin-bottom: 14pt; }
  .ms-title { font-size: ${s.title}pt; font-weight: 700; margin: 0 0 4pt; }
  .ms-authors { font-size: ${s.author}pt; margin-bottom: 6pt; }
  .ms-affiliation { font-size: ${s.affiliation}pt; margin-bottom: 1pt; }
  .ms-correspondence { font-size: ${s.affiliation}pt; font-style: italic; margin: 4pt 0 14pt; }
  .ms-label { font-weight: 700; text-align: left; margin-top: 10pt; }
  .ms-front-text, .ms-highlights, .ms-keywords { text-align: left; }
  .ms-body { text-align: left; }
  .ms-body.ms-double p, .ms-body.ms-double li { line-height: 2; }
  .ms-body p { text-align: left; margin: 0 0 ${style.bodySpaceAfterPt}pt; }
  .ms-h-a { font-size: ${s.heading1}pt; font-weight: 700; color: ${ink}; margin: 12pt 0 4pt; }
  .ms-h-b { font-size: ${s.heading2}pt; font-weight: 700; color: ${ink}; margin: 8pt 0 4pt; }
  .ms-h-c { font-weight: 700; font-style: italic; margin: 8pt 0 0; }
  .ms-h-box { font-size: ${s.heading2}pt; font-weight: 700; font-style: italic; margin-top: 12pt; }
  figure.figure { margin: 6pt 0 12pt; text-align: center; }
  figure.figure figcaption { font-size: ${s.caption}pt; text-align: center; margin-top: 4pt; font-style: italic; }
  figure.figure figcaption strong { font-style: normal; }
  figure.figure figcaption .ms-caption-body { font-style: italic; }
  .table-block { margin: 8pt auto 12pt; width: fit-content; max-width: 100%; }
  .table-block table { margin-inline: 0; }
  .table-caption { font-size: ${s.caption}pt; margin: 0 0 2pt; }
  .table-caption--unresolved { color: ${err}; }
  .table-note { font-size: ${s.caption}pt; font-style: italic; margin: 2pt 0 0; }
  /* caption/note stay inline with the table: they fill (and wrap at) the
     table's width without contributing to the block's fit-content size */
  .table-block .table-caption, .table-block .table-note { width: 0; min-width: 100%; }
  img.md-image, .ms-body img, figure.figure img { display: block; margin: 0 auto; width: auto; height: auto; max-width: 100%; max-height: ${textHeightMm}mm; }
  .ms-ref { font-size: ${s.reference}pt; margin: 0 0 4pt 0; padding-left: ${style.referenceHangingMm}mm; text-indent: -${style.referenceHangingMm}mm; }
  ${style.referencesStartNewPage ? '.ms-references { page-break-before: always; }' : ''}
  .ms-ref-num { font-weight: 600; }
  .ms-ref-flag { color: ${err}; }
  .ms-figure-caption { font-size: ${s.caption}pt; }
  table { border-collapse: collapse; margin: 8pt auto; width: auto; max-width: 100%; }
  th, td { border: 0; padding: 2pt 3pt; font-size: ${s.tableCell}pt; text-align: start; }
  th:not([style]), td:not([style]) { text-align: center; }
  td:first-child:not([style]) { text-align: left; }
  thead th { border-top: 1pt solid ${ink}; border-bottom: 1pt solid ${ink}; font-weight: 700; }
  tbody tr:last-child td { border-bottom: 1pt solid ${ink}; }
  .ms-table-entry { margin-bottom: 10pt; }
  .ms-table-footnotes { font-size: ${s.caption}pt; margin: 2pt 0 0; padding-left: 1.2em; }
${BREAK_CSS}`
}

export interface BuildHtmlOptions {
  doubleSpacing: boolean
  /** Reserves the left gutter export-pdf.ts's line-number injection writes into; ignored otherwise. */
  lineNumbers: boolean
  /** The app's active editor theme; when it names a known palette the page renders in it. */
  theme?: string
}

export async function buildManuscriptHtml(
  content: ExportContent,
  options: BuildHtmlOptions
): Promise<string> {
  const style = resolveDocumentStyle(content.profile)
  const imageMap = await markdownImages(content)
  // Anything the map does not carry — remote, outside the project, unreadable
  // — resolves to null, so a broken `<img>` can never reach the printed page.
  const resolveImage: ImageResolver = (url) => imageMap.get(url) ?? null
  const figureMap = await figuresHtml(content, style, resolveImage)

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
  const tableMap = tablesResolutionMap(content, resolveImage, false)
  const resolveTable = (tableId: string): TableResolution => tableMap.get(tableId) ?? {}
  const resolvers: BodyResolvers = { resolveCitation, resolveCrossRef, resolveImage }

  const tablesAtEnd = style.tablePlacement === 'end'
  // The markdown tables the body suppresses under `tablePlacement: 'end'`,
  // gathered in document order for the trailing Tables section.
  const mdTables = tablesAtEnd
    ? content.sections.flatMap((s) => (s.root === null ? [] : collectTables(s.root.children)))
    : []

  const sectionsHtml = content.sections
    .map((section) => {
      const heading = section.heading !== null ? headingHtml(section.level, section.heading) : ''
      const root =
        section.root === null
          ? null
          : tablesAtEnd
            ? ({ ...section.root, children: withoutTables(section.root.children) } as SciMarkRoot)
            : section.root
      const body = root === null ? '' : renderHtml(root, { ...resolvers, resolveFigure, resolveTable })
      return `${heading}\n${body}`
    })
    .join('\n')

  const bodyClass = `ms-body${options.doubleSpacing ? ' ms-double' : ''}${options.lineNumbers ? ' ms-line-numbers' : ''}`

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="katex.min.css">
<style>${pageCss(style, exportPalette(options.theme))}</style>
</head>
<body>
<div class="ms-page">
${titlePageHtml(content)}
<div class="${bodyClass}" id="ms-body">
${sectionsHtml}
${backMatterHtml(content, resolvers)}
${tablesAtEnd ? '' : tablesHtml(content, resolveImage)}
${referencesHtml(content)}
${style.figurePlacement === 'captions-list' ? figureCaptionsHtml(content, resolveImage) : ''}
${tablesAtEnd ? endTablesHtml(content, mdTables, resolvers) : ''}
</div>
</div>
</body></html>`
}

/* ------------------------------------------------------------------ */
/* Supplementary Information                                            */
/* ------------------------------------------------------------------ */

/** Ground truth (sleepTI_supplement.docx): supplement figures embed inline at 165 mm. */
const SUPPLEMENT_FIGURE_WIDTH_MM = 165

/** The internal-hyperlink blue the DOCX writer uses (Word's cross-reference blue-gray). */
const SUPPLEMENT_TOC_COLOR = '#2B579A'

interface SupplementHeadingAnchor {
  heading: string
  level: HeadingLevel
  anchor: string | null
}

/** One `supp-<slug>` id per headed section, deduplicated — mirrors the DOCX writer's `_supp_<slug>` bookmarks. */
function supplementHtmlAnchors(content: ExportContent): SupplementHeadingAnchor[] {
  const used = new Set<string>()
  return content.sections.map((section) => {
    if (section.heading === null) return { heading: '', level: section.level, anchor: null }
    let slug = slugifyHeading(section.heading)
    if (slug === '') slug = 'section'
    let unique = slug
    for (let i = 2; used.has(unique); i++) unique = `${slug}-${i}`
    used.add(unique)
    return { heading: section.heading, level: section.level, anchor: `supp-${unique}` }
  })
}

/**
 * One supplement section's body, rendered block by block so every top-level
 * GFM table gets its "Table S<n>." caption written above it — matching the
 * DOCX writer's supplement table treatment.
 */
function supplementSectionBody(
  root: SciMarkRoot,
  resolvers: Parameters<typeof renderHtml>[1],
  tableCounter: { next: number }
): string {
  const html: string[] = []
  let chunk: RootChild[] = []
  const flush = (): void => {
    if (chunk.length === 0) return
    html.push(renderHtml({ ...root, children: chunk } as SciMarkRoot, resolvers))
    chunk = []
  }
  for (const node of root.children) {
    if (node.type === 'table') {
      flush()
      const n = tableCounter.next++
      html.push(`<p class="ms-table-caption"><strong>Table S${n}.</strong></p>`)
      html.push(renderHtml({ ...root, children: [node] } as SciMarkRoot, resolvers))
    } else {
      chunk.push(node)
    }
  }
  flush()
  return html.join('\n')
}

/** Styling the supplement adds on top of pageCss: cover, Contents links, table captions. */
function supplementCss(style: ResolvedDocumentStyle): string {
  const s = style.sizesPt
  return `
  .ms-supp-contents { text-align: left; margin: 10pt 0 14pt; }
  .ms-supp-contents-label { font-weight: 700; font-size: 12pt; margin-bottom: 6pt; }
  .ms-supp-toc { display: block; color: ${SUPPLEMENT_TOC_COLOR}; text-decoration: underline; margin-bottom: 3pt; }
  .ms-supp-toc--h1 { margin-left: 0.2in; }
  .ms-supp-toc--h2 { margin-left: 0.45in; }
  .ms-table-caption { font-size: ${s.caption}pt; margin: 4pt 0 4pt; }
`
}

/**
 * The Supplementary Information page for export-pdf.ts — the HTML twin of
 * export-docx.ts's buildSupplementDocx (see its doc for the ground-truth
 * shape): cover title + the same byline as the manuscript, a linked Contents
 * list, the body with 165 mm figures and S-captioned tables at 9 pt cells,
 * and independently numbered Supplementary References. No highlights /
 * abstract / keywords / back matter.
 */
export async function buildSupplementHtml(content: ExportContent, options: BuildHtmlOptions): Promise<string> {
  const base = resolveDocumentStyle(content.profile)
  // The supplement's ground-truth shape wins over the profile's MAIN-document
  // conventions — same overrides as the DOCX writer.
  const style: ResolvedDocumentStyle = {
    ...base,
    sizesPt: { ...base.sizesPt, tableCell: 9 },
    figurePlacement: 'inline',
    tablePlacement: 'inline'
  }
  const imageMap = await markdownImages(content)
  const resolveImage: ImageResolver = (url) => imageMap.get(url) ?? null
  const figureMap = await figuresHtml(content, style, resolveImage, SUPPLEMENT_FIGURE_WIDTH_MM)

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
  const resolvers = { resolveCitation, resolveCrossRef, resolveImage, resolveFigure }

  const anchors = supplementHtmlAnchors(content)
  const tocEntries = anchors
    .filter((a): a is SupplementHeadingAnchor & { anchor: string } => a.anchor !== null)
    .map((a) => {
      const cls = a.level === 'A' ? 'ms-supp-toc--h1' : 'ms-supp-toc--h2'
      return `<a class="ms-supp-toc ${cls}" href="#${a.anchor}">${escapeHtml(a.heading)}</a>`
    })
    .join('\n')
  const contents =
    tocEntries === ''
      ? ''
      : `<nav class="ms-supp-contents"><div class="ms-supp-contents-label">Contents</div>${tocEntries}</nav>`

  const tableCounter = { next: 1 }
  const sectionsHtml = content.sections
    .map((section, index) => {
      const anchor = anchors[index]?.anchor ?? undefined
      const heading = section.heading !== null ? headingHtml(section.level, section.heading, anchor) : ''
      const body = section.root === null ? '' : supplementSectionBody(section.root, resolvers, tableCounter)
      return `${heading}\n${body}`
    })
    .join('\n')

  const references = content.referenceRows.length > 0 ? referencesHtml(content, 'Supplementary References') : ''
  const bodyClass = `ms-body${options.doubleSpacing ? ' ms-double' : ''}${options.lineNumbers ? ' ms-line-numbers' : ''}`

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="katex.min.css">
<style>${pageCss(style, exportPalette(options.theme))}${supplementCss(style)}</style>
</head>
<body>
<div class="ms-page">
<div class="ms-titlepage">
  <h1 class="ms-title">Supplementary Information: ${texHtml(content.manuscript.title)}</h1>
  ${bylineHtml(content)}
</div>
${contents}
<div class="${bodyClass}" id="ms-body">
${sectionsHtml}
${references}
</div>
</div>
</body></html>`
}

/**
 * Internal links (citations, figure/table cross-references, the reference
 * list) land the target in the MIDDLE of the viewport rather than jamming it
 * against the top edge. The anchors are zero-height <span>s that sit before
 * the thing they name, so a native hash jump scrolls the figure or table
 * itself out of view above the fold. We resolve the anchor to its enclosing
 * block, centre that, and let the browser clamp at the document ends (a
 * reference near the bottom simply stays wherever it lands, in view).
 */
function readerScript(): string {
  return [
    '(function(){',
    'function box(el){',
    "  if (el.classList.contains('ms-anchor')) {",
    "    return el.closest('figure, .table-block, .ms-ref, li, table, p') || el.parentElement || el;",
    '  }',
    '  return el;',
    '}',
    'function centre(id){',
    '  var el = document.getElementById(id);',
    '  if (!el) return false;',
    '  var b = box(el);',
    '  var r = b.getBoundingClientRect();',
    '  var top = window.pageYOffset + r.top - Math.max(0, (window.innerHeight - r.height) / 2);',
    '  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });',
    '  return true;',
    '}',
    "document.addEventListener('click', function(e){",
    "  var a = e.target && e.target.closest ? e.target.closest('a[href^=\"#\"]') : null;",
    '  if (!a) return;',
    "  var id = decodeURIComponent(a.getAttribute('href').slice(1));",
    '  if (!id || !document.getElementById(id)) return;',
    '  e.preventDefault();',
    "  location.hash = '#' + id;",
    '  centre(id);',
    '});',
    "window.addEventListener('hashchange', function(){",
    '  if (location.hash.length > 1) centre(decodeURIComponent(location.hash.slice(1)));',
    '});',
    "window.addEventListener('load', function(){",
    '  if (location.hash.length > 1) centre(decodeURIComponent(location.hash.slice(1)));',
    '});',
    '})();',
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* Standalone web-page export ('export:html')                           */
/* ------------------------------------------------------------------ */

/**
 * KaTeX's stylesheet with its woff2 fonts inlined as data: URIs, cached per
 * process. The PDF path links katex.min.css from a temp directory beside the
 * page; a STANDALONE .html has nowhere to link from, and KaTeX markup
 * without its stylesheet renders as visibly duplicated MathML+HTML. Only the
 * woff2 sources are inlined — they are the first entry of every @font-face
 * src list and universally supported, so the woff/ttf fallbacks that follow
 * are never fetched.
 */
let katexCssInlined: string | null = null

async function inlineKatexCss(): Promise<string> {
  if (katexCssInlined !== null) return katexCssInlined
  const require = createRequire(import.meta.url)
  const cssPath = require.resolve('katex/dist/katex.min.css')
  const fontsDir = join(dirname(cssPath), 'fonts')
  let css = await readFile(cssPath, 'utf8')
  const fontNames = new Set(
    [...css.matchAll(/url\(fonts\/([A-Za-z0-9_-]+\.woff2)\)/g)].map((m) => m[1] as string)
  )
  for (const name of fontNames) {
    const bytes = await readFile(join(fontsDir, name))
    css = css
      .split(`url(fonts/${name})`)
      .join(`url(data:font/woff2;base64,${bytes.toString('base64')})`)
  }
  katexCssInlined = css
  return css
}

/** Swap the print pages' relative katex <link> for the inlined stylesheet. */
async function withInlineKatex(html: string): Promise<string> {
  return html.replace('<link rel="stylesheet" href="katex.min.css">', `<style>${await inlineKatexCss()}</style>`)
}

/**
 * The SUNA reading design, transcribed from the manuscript tab's stylesheets
 * (renderer/src/manuscript/manuscript.css + styles/tokens.css): the
 * "dark-adapted instrument" night-sky palette as the default and the
 * suna-light warm-paper palette under prefers-color-scheme: light, the serif
 * reading stack, 16px/1.7 body on the tab's 140ch measure, centred title
 * block, quiet small-caps section labels, and the tab's reference-row shape.
 * Values are copied, not invented — change them there first.
 */
function readerCss(palette?: ExportPalette): string {
  // With a palette the page is pinned to the app's active theme — an export
  // of a gruvbox project IS gruvbox, whatever the viewer's OS scheme says.
  // Without one (older callers), the historical auto light/dark pair stands.
  const rootVars =
    palette !== undefined
      ? `
  :root {
    --r-bg: ${palette.bg};
    --r-ink: ${palette.ink};
    --r-ink-muted: ${palette.inkMuted};
    --r-ink-faint: ${palette.inkFaint};
    --r-border: ${palette.border};
    --r-accent: ${palette.accent};
    --r-link: ${palette.link};
    color-scheme: ${palette.colorScheme};
  }`
      : `
  :root {
    --r-bg: #1e1e26;
    --r-ink: #e8e6e1;
    --r-ink-muted: #a09d97;
    --r-ink-faint: #6b6963;
    --r-border: #3a3a45;
    --r-accent: #e8b45c;
    --r-link: #8ab4d8;
    color-scheme: dark;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --r-bg: #f7f2e9;
      --r-ink: #2b2620;
      --r-ink-muted: #6b6257;
      --r-ink-faint: #9a9184;
      --r-border: #c2b8a5;
      --r-accent: #8a6a2f;
      --r-link: #3d6d99;
      color-scheme: light;
    }
  }`
  return `
  ${rootVars}
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--r-bg);
    color: var(--r-ink);
    font-family: 'Iowan Old Style', Palatino, 'Palatino Linotype', Georgia, serif;
    font-size: 16px;
    line-height: 1.7;
  }
  .ms-page { max-width: 140ch; margin: 0 auto; padding: 56px 16px 120px; }
  .ms-titlepage { user-select: text; }
  .ms-title { margin: 0 0 0.7em; font-size: 1.55em; font-weight: 650; line-height: 1.3; text-align: center; }
  .ms-authors { margin-bottom: 0.5em; font-size: 1.02em; text-align: center; }
  .ms-authors sup { margin-left: 1px; color: var(--r-ink-muted); font-size: 0.68em; }
  .ms-affiliations { margin-bottom: 0.4em; font-size: 0.82em; line-height: 1.55; text-align: center; color: var(--r-ink-muted); }
  .ms-affiliations sup { margin-right: 3px; color: var(--r-ink-faint); }
  .ms-correspondence { font-size: 0.82em; text-align: center; color: var(--r-ink-faint); }
  .ms-label {
    margin: 2em 0 0.45em;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--r-ink-faint);
  }
  .ms-front-text { margin: 0; font-size: 0.95em; }
  .ms-highlights { margin: 0; padding-left: 1.2em; font-size: 0.95em; }
  .ms-highlights li { margin-bottom: 0.3em; }
  .ms-keywords { margin: 0.6em 0 0; font-size: 0.85em; color: var(--r-ink-muted); }
  .ms-rule { height: 1px; margin: 2.4em 0; background: var(--r-border); opacity: 0.6; }
  .ms-h-a { font-size: 1.25em; font-weight: 650; margin: 1.8em 0 0.5em; }
  .ms-h-b { font-size: 1.05em; font-weight: 650; margin: 1.4em 0 0.4em; }
  .ms-h-c { font-weight: 650; font-style: italic; margin: 1.2em 0 0; }
  p { margin: 0 0 0.9em; }
  a { color: var(--r-link); }
  .ms-cite a, a.ms-cite-link { color: var(--r-link); text-decoration: none; }
  .ms-xref { color: var(--r-link); text-decoration: none; }
  .ms-anchor { position: relative; top: -8px; }
  figure.figure { margin: 1.6em 0 2em; text-align: center; }
  figure.figure img { max-width: 100%; height: auto; }
  figure.figure figcaption { margin-top: 0.6em; font-size: 0.88em; text-align: center; font-style: italic; color: var(--r-ink-muted); }
  figure.figure figcaption strong { color: var(--r-ink); font-style: normal; }
  .table-block { margin: 1.2em auto 1.6em; width: fit-content; max-width: 100%; }
  .table-block table { margin-inline: 0; }
  .table-block .table-caption, .table-block .table-note { width: 0; min-width: 100%; }
  .table-caption { font-size: 0.92em; margin: 0 0 0.2em; }
  .table-caption--unresolved { color: #d97b6c; }
  .table-note { font-size: 0.85em; font-style: italic; color: var(--r-ink-muted); margin: 0.2em 0 0; }
  .table-block:has(.ms-anchor:target) { outline: 1px solid var(--r-accent); outline-offset: 6px; border-radius: 2px; }
  img.md-image { display: block; margin: 1em auto; max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 1.2em auto; }
  th, td { border: 0; padding: 4px 10px; font-size: 0.9em; }
  thead th { border-top: 1px solid var(--r-ink); border-bottom: 1px solid var(--r-ink); font-weight: 650; }
  tbody tr:last-child td { border-bottom: 1px solid var(--r-ink); }
  code { font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 0.85em; }
  pre { overflow-x: auto; padding: 0.8em 1em; border: 1px solid var(--r-border); border-radius: 4px; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 2px solid var(--r-border); color: var(--r-ink-muted); }
  .ms-backmatter p { font-size: 0.95em; }
  .ms-references { user-select: text; }
  .ms-ref { display: flex; gap: 8px; margin-bottom: 0.45em; font-size: 0.88em; line-height: 1.55; }
  .ms-ref-num { flex-shrink: 0; min-width: 1.6em; text-align: right; color: var(--r-ink-muted); font-variant-numeric: tabular-nums; }
  .ms-ref a { color: var(--r-link); text-decoration: none; }
  .ms-ref:target, figure.figure:has(> figcaption .ms-anchor:target) { outline: 1px solid var(--r-accent); outline-offset: 6px; border-radius: 2px; }
  .ms-ref-flag { display: inline-block; padding: 0 6px; border: 1px solid #d97b6c; border-radius: 3px; color: #d97b6c; font-size: 0.85em; }
  .ms-table-entry { margin-bottom: 1em; font-size: 0.92em; }
  .ms-table-footnotes { font-size: 0.85em; margin: 0.3em 0 0; padding-left: 1.2em; color: var(--r-ink-muted); }
`
}

/** Reference-list runs with a citation's { refKey } link rendered as a real in-page anchor. */
function readerRunsToHtml(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      let inner = escapeHtml(run.text)
      if (run.link !== undefined) {
        inner =
          'url' in run.link
            ? `<a href="${escapeHtml(run.link.url)}">${inner}</a>`
            : `<a class="ms-cite-link" href="#ref-${escapeHtml(run.link.refKey)}">${inner}</a>`
      }
      if (run.style === 'italic') inner = `<em>${inner}</em>`
      else if (run.style === 'bold') inner = `<strong>${inner}</strong>`
      return inner
    })
    .join('')
}

/** The reference list as the reading tab draws it, every row an id'd link target. */
function readerReferencesHtml(content: ExportContent): string {
  const numeric = isNumericCitationMode(content.profile)
  const rows = content.referenceRows
    .map((row) => {
      const runs = formatReferenceRow(row, content.profile)
      const num = numeric ? `<span class="ms-ref-num">${row.number}.</span>` : ''
      const body =
        runs === null
          ? `<span class="ms-ref-flag">@${escapeHtml(row.key)}</span> — cited but not found in ${escapeHtml(
              content.manuscript.bibliography
            )}`
          : runsToHtml(runs)
      return `<div class="ms-ref" id="ref-${escapeHtml(row.key)}">${num}<span class="ms-ref-body">${body}</span></div>`
    })
    .join('\n')
  return `<section class="ms-references"><div class="ms-label">References</div>${rows}</section>`
}

/** The managed tables the prose does not embed, each entry an id'd cross-ref target. */
function readerTablesHtml(content: ExportContent, resolveImage: ImageResolver): string {
  const exclude = embeddedTableIds(content)
  if (content.tables.every((t) => exclude.has(t.table.id))) return ''
  const entries = content.tables
    .filter((t) => !exclude.has(t.table.id))
    .map((t) => {
      const title = inlineMd(t.table.caption.title, resolveImage)
      const body =
        t.table.caption.body === undefined
          ? ''
          : inlineMd(t.table.caption.body, resolveImage)
      const footnotes =
        t.table.footnotes.length === 0
          ? ''
          : `<ul class="ms-table-footnotes">${t.table.footnotes
              .map((f) => `<li><sup>${escapeHtml(f.mark)}</sup> ${escapeHtml(f.text)}</li>`)
              .join('')}</ul>`
      return `<div class="ms-table-entry" id="tbl-${escapeHtml(t.table.id)}"><p><strong>${escapeHtml(
        t.label
      )}.</strong> ${title}</p>${body ? `<p>${body}</p>` : ''}${footnotes}</div>`
    })
    .join('\n')
  return `<section class="ms-tables"><div class="ms-label">Tables</div>${entries}</section>`
}

/** Back matter under the reading tab's quiet small-caps labels. */
function readerBackMatterHtml(content: ExportContent, resolvers: BodyResolvers): string {
  return backMatterSections(content)
    .map(
      (section) =>
        `<section class="ms-backmatter"><div class="ms-label">${escapeHtml(section.title)}</div>${section.paragraphs
          .map((text) => renderHtml(parseSciMark(text), resolvers))
          .join('')}</section>`
    )
    .join('\n')
}

/**
 * The manuscript as ONE self-contained web page, mirroring the SUNA reading
 * tab as closely as a static page can ('export:html'):
 * - the reading tab's design (readerCss above — same palette, serif stack,
 *   measure, title-page shape, small-caps labels, reference rows);
 * - every in-text citation is a hyperlink to its reference-list entry
 *   (renderCluster's { refKey } run links, which the print/DOCX writers
 *   deliberately drop, become real anchors here);
 * - figure/table cross-references link to the figure/table in the page;
 * - figures and markdown images embed as data: URIs, KaTeX styles (fonts
 *   included) inline, so the file works from anywhere with zero requests;
 * - the reading tab always shows figures and tables in place, so the
 *   profile's figurePlacement/tablePlacement submission conventions do not
 *   apply here.
 */
export async function buildReaderHtml(content: ExportContent, theme?: string): Promise<string> {
  const m = content.manuscript
  const imageMap = await markdownImages(content)
  const resolveImage: ImageResolver = (url) => imageMap.get(url) ?? null

  const figureMap = new Map<string, FigureResolution>()
  for (const fig of content.figures) {
    const dataUri = await imageDataUri(fig.pngPath)
    const titleHtml = inlineMd(fig.figure.caption.title, resolveImage)
    const bodyHtml =
      fig.figure.caption.body.trim() === ''
        ? ''
        : inlineMd(fig.figure.caption.body, resolveImage)
    // The empty anchor span inside the caption is the cross-ref jump target —
    // renderHtml owns the <figure> element, so the id rides in with the caption.
    const captionHtml =
      `<span class="ms-anchor" id="fig-${escapeHtml(fig.figure.id)}"></span>` +
      `<strong>${escapeHtml(fig.label)}.</strong> ${titleHtml} ${bodyHtml}`.trim()
    figureMap.set(fig.figure.id, { svgHtml: `<img src="${dataUri}" alt="" />`, captionHtml })
  }

  const resolveCitation = (keys: string[], narrative: boolean): string => {
    const rendering = renderCluster({ keys, narrative }, content.numbers, content.citeStyle, content.entryMap)
    const html = readerRunsToHtml(rendering.inline)
    return rendering.form === 'superscript'
      ? `<sup class="ms-cite">${html}</sup>`
      : `<span class="ms-cite">${html}</span>`
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
    const text = escapeHtml(label === undefined ? `${kind}:${id}` : suffix !== undefined ? `${label}${suffix}` : label)
    if (label !== undefined && (kind === 'fig' || kind === 'tbl')) {
      return `<a class="ms-xref" href="#${kind === 'fig' ? 'fig' : 'tbl'}-${escapeHtml(id)}">${text}</a>`
    }
    return text
  }

  const resolveFigure = (figureId: string): FigureResolution => figureMap.get(figureId) ?? {}
  const tableMap = tablesResolutionMap(content, resolveImage, true)
  const resolveTable = (tableId: string): TableResolution => tableMap.get(tableId) ?? {}
  const resolvers: BodyResolvers = { resolveCitation, resolveCrossRef, resolveImage }

  const sectionsHtml = content.sections
    .map((section) => {
      const heading = section.heading !== null ? headingHtml(section.level, section.heading) : ''
      const body =
        section.root === null ? '' : renderHtml(section.root, { ...resolvers, resolveFigure, resolveTable })
      return `${heading}\n${body}`
    })
    .join('\n')

  const keywords =
    m.keywords !== undefined && m.keywords.length > 0
      ? `<p class="ms-keywords"><strong>Keywords: </strong><em>${m.keywords.map(escapeHtml).join('; ')}</em></p>`
      : ''
  const significance =
    m.significance != null
      ? `<div class="ms-label">Significance</div><p class="ms-front-text">${texHtml(m.significance)}</p>`
      : ''
  const highlights =
    m.highlights != null && m.highlights.length > 0
      ? `<div class="ms-label">Highlights</div><ul class="ms-highlights">${m.highlights
          .map((h) => `<li>${texHtml(h)}</li>`)
          .join('')}</ul>`
      : ''

  // Tab title: the math-stripped plain text — a browser tab cannot typeset
  // "$z = 1.7$", and the literal delimiters read as noise.
  const plainTitle = splitTexSpans(m.title)
    .map((seg) => seg.value)
    .join('')

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(plainTitle)}</title>
<style>${await inlineKatexCss()}</style>
<style>${readerCss(exportPalette(theme))}</style>
</head>
<body>
<div class="ms-page">
<header class="ms-titlepage">
  <h1 class="ms-title">${texHtml(m.title)}</h1>
  ${bylineHtml(content)}
  <div class="ms-label">Abstract</div><p class="ms-front-text">${texHtml(m.abstract.content)}</p>
  ${significance}
  ${highlights}
  ${keywords}
</header>
<div class="ms-rule"></div>
<main class="ms-body">
${sectionsHtml}
${readerBackMatterHtml(content, resolvers)}
${readerTablesHtml(content, resolveImage)}
${readerReferencesHtml(content)}
</main>
</div>
<script>${readerScript()}</script>
</body></html>`
}

export interface ExportHtmlRequest {
  dir: string
  profileId: string
  outputName: string
  figurePngPaths: Readonly<Record<string, string>>
  /** Accepted for a uniform export surface; print-only options do not apply to a web page. */
  options: ExportOptions
  /** 'manuscript' (default) or the Supplementary Information document. */
  target?: 'manuscript' | 'supplement'
}

export interface ExportHtmlResult {
  path: string
}

/**
 * 'export:html': write ONE self-contained .html to <dir>/output/. The
 * manuscript target is the SUNA-reading-view page (buildReaderHtml); the
 * supplement target reuses the supplement page with KaTeX inlined so it too
 * stands alone. Never touches any source file.
 */
/**
 * The self-contained page itself, with no opinion about where it goes: the
 * export writes it to output/, the live preview renders the same string in
 * an iframe. One builder, so a preview cannot drift from the written file.
 */
export async function buildStandaloneHtml(
  content: ExportContent,
  supplement: boolean,
  theme?: string
): Promise<string> {
  return supplement
    ? await withInlineKatex(
        await buildSupplementHtml(content, { doubleSpacing: false, lineNumbers: false, theme })
      )
    : await buildReaderHtml(content, theme)
}

export async function exportHtml(req: ExportHtmlRequest): Promise<ExportHtmlResult> {
  const root = assertInsideAllowedRoot(req.dir)
  const supplement = req.target === 'supplement'
  const buildOpts = { dir: root, profileId: req.profileId, figurePngPaths: req.figurePngPaths }
  const content = supplement ? await buildSupplementContent(buildOpts) : await buildExportContent(buildOpts)
  const html = await buildStandaloneHtml(content, supplement, req.options.theme)
  const outputDir = await projectSubdir(root, 'output')
  const target = join(outputDir, `${req.outputName}.html`)
  await writeFileAtomic(target, html)
  return { path: target }
}
