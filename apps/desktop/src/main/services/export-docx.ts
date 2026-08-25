import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  convertMillimetersToTwip,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  LineNumberRestartFormat,
  LineRuleType,
  // Aliased: an unaliased `Math` import would shadow the global Math object
  // this module calls Math.round/Math.max on.
  Math as DocxMath,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  type ILevelsOptions,
  type ISectionPropertiesOptions
} from 'docx'
import type { ExportOptions, HeadingLevel as ManuscriptHeadingLevel } from '@suna/core'
import { renderCluster, type Run as BibRun } from '@suna/bib'
import { parseSciMark, type CrossRefKind, type SciMarkRoot } from '@suna/markdown'
import {
  authorMarkers,
  backMatterSections,
  blockImagesOf,
  collectBlockImages,
  exportOutputPath,
  prepareManuscriptExport,
  resolveExportImagePath,
  collectTableEmbeds,
  collectTables,
  formatReferenceRow,
  isNumericCitationMode,
  pngDimensions,
  slugifyHeading,
  splitTexSpans,
  type ExportContent,
  type ExportFigureContent,
  type ExportTableContent,
  type ImageNode,
  type ListItemNode,
  type ListNode,
  type RootChild,
  type TableNode
} from './export-content'
import { writeFileAtomic } from './atomic'
import { assertInsideAllowedRoot } from './roots'
import { texToMath } from './tex-omml'
import {
  exportPalette,
  halfPoints,
  lineSpacingTwips,
  mmToTwips,
  ptToTwips,
  resolveDocumentStyle,
  type ExportPalette,
  type ResolvedDocumentStyle
} from './export-style'

/**
 * DOCX export (feature-plan-6 §3), built entirely with the bundled 'docx'
 * library — no external binary required. Walks the SAME parsed SciMark AST
 * (`ExportContent.sections[i].root`) the HTML/PDF path renders with
 * (export-html.ts) into `docx` Paragraphs/Tables, so citations, cross-refs
 * and the reference list are pixel-identical in *content* across both
 * outputs even though the renderers are independent.
 *
 * Typography is the ALWAYS-ON SUNA house style resolved through
 * export-style.ts's `resolveDocumentStyle`, with journal profiles carrying
 * only the small convention deltas their guidelines actually state
 * (figureLabel, figurePlacement, tablePlacement, referencesStartNewPage).
 * Markdown lists are real Word lists (registered numbering definitions),
 * figure/table cross-references are internal hyperlinks to bookmarks on
 * their targets, and manuscript.json's back matter and keywords render in
 * docx-tools' order.
 *
 * Two documents come out of this module: `buildDocxDocument` (the main
 * manuscript) and `buildSupplementDocx` (the Supplementary Information
 * document rendered from manuscript/supplementary.md via
 * export-content.ts's buildSupplementContent — S-numbered figures/tables,
 * independent reference numbering, a linked Contents list; see its doc for
 * the ground-truth shape). `exportDocx` routes between them on `target`.
 *
 * Known, deliberately scoped-down paths (all reported, none silent):
 * - Inline/display math ($...$/$$...$$) is typeset as real OMML
 *   (`<m:oMath>`) via tex-omml.ts's strict LaTeX subset — fractions,
 *   scripts, radicals, greek, \sum/\int limits, \text/\mathrm. An equation
 *   using ANYTHING outside that subset falls back — whole, never partially —
 *   to the pre-existing italic-literal rendering. Title/abstract/caption
 *   `$…$` spans (texRuns) stay italic literals: they run through
 *   splitTexSpans, not the SciMark math pipeline.
 * - Citation runs are plain text, not hyperlinks to their reference-list
 *   entry (matching docx-tools, which links cross-references but not
 *   citations); DOI/URL links inside a reference itself ARE real hyperlinks.
 * - manuscript.json's `tables` carry only a caption + footnotes (no cell
 *   grid — the schema has no row data), so they render as a numbered,
 *   captioned block, not a data table. A markdown table physically written
 *   into a section's prose (GFM syntax) renders as a real docx Table.
 */

type DocxInline = TextRun | ExternalHyperlink | InternalHyperlink | Bookmark | DocxMath

interface RunStyle {
  bold?: boolean
  italics?: boolean
  superScript?: boolean
  subScript?: boolean
  strike?: boolean
  color?: string
  size?: number
}

interface FigureAsset {
  buffer: Buffer
  width: number
  height: number
}

interface DocxCtx {
  content: ExportContent
  doubleSpacing: boolean
  figureAssets: ReadonlyMap<string, FigureAsset>
  /** Loaded bytes for the markdown block images, keyed by their AST node. */
  imageAssets: ReadonlyMap<RootChild, FigureAsset>
  /** Typography for this export — see export-style.ts. */
  style: ResolvedDocumentStyle
  /**
   * Theme palette when `options.theme` names a known editor theme
   * (export-style.ts) — colors the page background, body ink, title and
   * section headings (accent) and hyperlink runs (link). Undefined = the
   * classic black-and-white print look, byte-identical to before.
   */
  palette?: ExportPalette
  /** Mutable registry the list walk fills so the Document can register real Word numbering. */
  lists: {
    /** Ordered-list start values other than 1 that need their own numbering reference. */
    orderedStarts: Set<number>
    /** Next concrete-numbering instance, so each ordered list restarts at its own start. */
    nextInstance: number
  }
  /**
   * Supplement mode (buildSupplementDocx): GFM tables get an S-numbered
   * "Table S<n>." caption written above them, and embedded figures render at
   * the ground-truth supplement width instead of the profile preset.
   */
  supplement?: {
    /** Next "Table S<n>" number, advanced in document order by the block walk. */
    nextTableNumber: number
  }
}

/** Ground truth (sleepTI_supplement.docx): supplement figures embed inline at 165 mm. */
const SUPPLEMENT_FIGURE_WIDTH_MM = 165

/** The cross-reference link color docx-tools writes (Word's theme hyperlink blue-gray). */
const CROSSREF_COLOR = '2B579A'

/** '#rrggbb' -> 'RRGGBB', the form the docx library wants. */
function docxHex(color: string): string {
  return color.replace(/^#/, '').toUpperCase()
}

/** The link color for this export: the theme's link, or docx-tools' blue-gray. */
function linkColor(ctx: DocxCtx): string {
  return ctx.palette !== undefined ? docxHex(ctx.palette.link) : CROSSREF_COLOR
}

/** Heading/title ink: the theme's accent, or classic black. */
function headingColor(ctx: DocxCtx): string {
  return ctx.palette !== undefined ? docxHex(ctx.palette.accent) : '000000'
}

/** twips-per-96dpi-pixel conversion docx's ImageRun transformation expects (EMU math handled internally by the lib at 9525 EMU/px). */
function px96(mm: number): number {
  return Math.max(1, Math.round((mm / 25.4) * 96))
}

/**
 * Paragraph spacing for body-level content.
 *
 * Double spacing (a journal submission rule) always wins when the user asked
 * for it. Otherwise the style's own line spacing applies — 1.15 for SUNA
 * style, which is the value Word's default template carries and therefore the
 * one docx-tools inherits for every paragraph it writes.
 */
function bodySpacing(ctx: DocxCtx, extra?: { before?: number; after?: number }) {
  const line = ctx.doubleSpacing ? 480 : lineSpacingTwips(ctx.style.lineSpacing)
  return {
    ...extra,
    ...(line !== 240 ? { line, lineRule: LineRuleType.AUTO } : {})
  }
}

/** A run at one of the style's point sizes. */
function sizeOf(ctx: DocxCtx, role: keyof ResolvedDocumentStyle['sizesPt']): number {
  return halfPoints(ctx.style.sizesPt[role])
}

function textRun(text: string, style: RunStyle = {}): TextRun {
  return new TextRun({ text, ...style })
}

function texRuns(text: string, style: RunStyle = {}): TextRun[] {
  return splitTexSpans(text).map((seg) =>
    seg.kind === 'math' ? textRun(seg.value, { ...style, italics: true }) : textRun(seg.value, style)
  )
}

function bibRunsToDocx(runs: readonly BibRun[], style: RunStyle = {}, hyperlinkColor?: string): DocxInline[] {
  return runs.map((r) => {
    const runStyle: RunStyle = {
      ...style,
      bold: style.bold || r.style === 'bold',
      italics: style.italics || r.style === 'italic'
    }
    if (r.link !== undefined && 'url' in r.link) {
      // A themed export paints its hyperlinks in the palette's link color;
      // the classic export leaves them as plain runs (docx-tools' shape).
      const linked = hyperlinkColor !== undefined ? { ...runStyle, color: hyperlinkColor } : runStyle
      return new ExternalHyperlink({ children: [textRun(r.text, linked)], link: r.link.url })
    }
    return textRun(r.text, runStyle)
  })
}

function crossRefText(kind: CrossRefKind, id: string, suffix: string | undefined, content: ExportContent): string {
  const map =
    kind === 'fig'
      ? content.labels.figures
      : kind === 'tbl'
        ? content.labels.tables
        : kind === 'eq'
          ? content.labels.equations
          : content.labels.sections
  const label = map.get(id)
  if (label === undefined) return `${kind}:${id}`
  return suffix !== undefined ? `${label}${suffix}` : label
}

/**
 * The bookmark a figure/table cross-reference can jump to, or null for a
 * cross-ref kind that has no rendered anchor (equations, sections) or an id
 * the manuscript does not carry. Anchors are `_fig_N`/`_tbl_N` by derived
 * number — matching docx-tools — and are written by figureCaptionParagraph /
 * tableCaptionParagraph on whichever page the caption ends up on.
 */
function crossRefAnchor(kind: CrossRefKind, id: string, content: ExportContent): string | null {
  if (kind === 'fig') {
    const index = content.figures.findIndex((f) => f.figure.id === id)
    return index >= 0 ? `_fig_${index + 1}` : null
  }
  if (kind === 'tbl') {
    const index = content.tables.findIndex((t) => t.table.id === id)
    return index >= 0 ? `_tbl_${index + 1}` : null
  }
  return null
}

function citationInline(keys: string[], narrative: boolean, ctx: DocxCtx, style: RunStyle): DocxInline[] {
  const rendering = renderCluster({ keys, narrative }, ctx.content.numbers, ctx.content.citeStyle, ctx.content.entryMap)
  const runStyle: RunStyle = { ...style, superScript: rendering.form === 'superscript' }
  return bibRunsToDocx(rendering.inline, runStyle)
}

/** mdast phrasing content -> docx run list, threading bold/italic down through nested strong/emphasis. */
function inlineChildren(nodes: readonly RootChild[], ctx: DocxCtx, style: RunStyle = {}): DocxInline[] {
  const out: DocxInline[] = []
  for (const node of nodes as readonly (RootChild & { children?: RootChild[] })[]) {
    switch (node.type) {
      case 'text':
        out.push(textRun((node as { value: string }).value, style))
        break
      case 'strong':
        out.push(...inlineChildren(node.children ?? [], ctx, { ...style, bold: true }))
        break
      case 'emphasis':
        out.push(...inlineChildren(node.children ?? [], ctx, { ...style, italics: true }))
        break
      case 'delete':
        out.push(...inlineChildren(node.children ?? [], ctx, { ...style, strike: true }))
        break
      case 'inlineCode':
        out.push(textRun((node as { value: string }).value, { ...style }))
        break
      case 'break':
        out.push(new TextRun({ text: '', break: 1 }))
        break
      case 'link': {
        const url = (node as unknown as { url: string }).url
        out.push(new ExternalHyperlink({ children: inlineChildren(node.children ?? [], ctx, style), link: url }))
        break
      }
      case 'inlineMath': {
        // Typeset OMML when the strict subset covers the whole expression;
        // otherwise the italic-literal fallback, never a half-render.
        const value = (node as unknown as { value: string }).value
        const math = texToMath(value)
        if (math !== null) out.push(new DocxMath({ children: math }))
        else out.push(textRun(value, { ...style, italics: true }))
        break
      }
      case 'citation': {
        const c = node as unknown as { keys: string[]; narrative: boolean }
        out.push(...citationInline(c.keys, c.narrative, ctx, style))
        break
      }
      case 'crossRef': {
        const c = node as unknown as { kind: CrossRefKind; id: string; suffix?: string }
        const text = crossRefText(c.kind, c.id, c.suffix, ctx.content)
        const anchor = crossRefAnchor(c.kind, c.id, ctx.content)
        if (anchor === null) {
          out.push(textRun(text, style))
        } else {
          // A real in-document jump to the figure/table caption, styled the
          // way docx-tools styles its cross-reference links.
          out.push(
            new InternalHyperlink({
              anchor,
              children: [new TextRun({ text, ...style, color: linkColor(ctx), underline: {} })]
            })
          )
        }
        break
      }
      case 'footnoteReference':
        out.push(textRun(`[${(node as unknown as { identifier: string }).identifier}]`, { ...style, superScript: true }))
        break
      case 'image':
      case 'imageReference':
        // Rare inside prose (figures arrive via the ![[fig:id]] block form); fall back to alt text.
        out.push(textRun((node as unknown as { alt?: string }).alt ?? '', style))
        break
      default:
        break
    }
  }
  return out
}

/** Body runs carry the style's body size explicitly, matching the document default. */
function bodyRunStyle(ctx: DocxCtx): RunStyle {
  return { size: sizeOf(ctx, 'body') }
}

/** Flatten phrasing content to plain text — headings carry no inline styling of their own. */
function plainText(nodes: readonly RootChild[]): string {
  let out = ''
  for (const node of nodes as readonly (RootChild & { children?: RootChild[]; value?: string })[]) {
    if (typeof node.value === 'string') out += node.value
    else if (node.children !== undefined) out += plainText(node.children)
  }
  return out
}

/** Parse a plain string (a figure/table caption) and pull just its inline runs — captions are one paragraph of prose, never headings/lists/tables. */
function inlineFromText(text: string, ctx: DocxCtx, style: RunStyle = {}): DocxInline[] {
  if (text.trim() === '') return []
  const root = parseSciMark(text)
  const out: DocxInline[] = []
  for (const node of root.children) {
    if (node.type === 'paragraph') out.push(...inlineChildren(node.children, ctx, style))
  }
  return out
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const
const RULE = { style: BorderStyle.SINGLE, size: 8, color: '000000' } as const

type ColumnAlign = NonNullable<TableNode['align']>[number]

/**
 * A column's alignment. A GFM delimiter row (`:---`, `:---:`, `---:`) is the
 * author stating it outright and wins everywhere — it is what reading mode and
 * the PDF already honour. Only an UNSPECIFIED column falls back to the house
 * APA convention: header and non-first columns centred, first column left.
 */
function cellAlignment(align: ColumnAlign | undefined, isHeader: boolean, colIndex: number) {
  if (align === 'left') return AlignmentType.LEFT
  if (align === 'center') return AlignmentType.CENTER
  if (align === 'right') return AlignmentType.RIGHT
  return isHeader || colIndex > 0 ? AlignmentType.CENTER : AlignmentType.LEFT
}

/**
 * A markdown table, in docx-tools' APA treatment: every border cleared, then
 * exactly three horizontal rules — above and below the header row, and under
 * the last row. Header cells are bold and centred, the first column is
 * left-aligned and the rest centred. That is the single change that makes an
 * exported table read as a scientific table rather than a spreadsheet grid,
 * which is what Word's default full-border table looks like.
 *
 * Keeping the table whole across a page boundary (feature-plan-13 §A3) takes
 * two different properties, because OOXML has no table-level "keep together":
 *
 *  - `cantSplit` on every row stops a SINGLE ROW being torn in half — the
 *    worst version of the defect, and the only one Word will inflict even on
 *    a short table.
 *  - `keepNext` on the paragraphs inside every row but the last is the only
 *    mechanism Word offers for holding the whole table on one page. It reads
 *    as a strange place to put it; it is nonetheless the standard idiom.
 *
 * The last row is deliberately left without `keepNext` unless `keepWithNext`
 * says something must follow it (the italic "Note." line under a SUNA table),
 * because a blanket `keepNext` there would drag the next body paragraph onto
 * the table's page for no reason.
 *
 * When the constraint is unsatisfiable — a table taller than the printable
 * page — Word ignores `keepNext` and breaks anyway, which is the correct
 * fallback: `tableHeader` on row 0 repeats the header on the continuation,
 * and measureOversizedBlocks (export-pdf.ts) tells the author it happened.
 */
function tableFromMdast(node: TableNode, ctx: DocxCtx, opts: { keepWithNext?: boolean } = {}): Table {
  const cellSize = sizeOf(ctx, 'tableCell')
  const lastIndex = node.children.length - 1

  const rows = node.children.map((row, rowIndex) => {
    const isHeader = rowIndex === 0
    const isLast = rowIndex === lastIndex
    const keepNext = !isLast || opts.keepWithNext === true
    return new TableRow({
      cantSplit: true,
      ...(isHeader ? { tableHeader: true } : {}),
      children: row.children.map((cell, colIndex) => {
        const runStyle: RunStyle = { size: cellSize, bold: isHeader }
        const alignment = cellAlignment(node.align?.[colIndex], isHeader, colIndex)
        return new TableCell({
          children: [
            new Paragraph({
              alignment,
              keepNext,
              spacing: { before: 0, after: 0 },
              children: inlineChildren(cell.children, ctx, runStyle)
            })
          ],
          margins: { top: isHeader ? 40 : 20, bottom: isHeader ? 40 : 20, left: 60, right: 60 },
          borders: {
            top: isHeader ? RULE : NO_BORDER,
            bottom: isHeader || isLast ? RULE : NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER
          }
        })
      })
    })
  })
  // Shrink to fit and centre, matching reading mode and the PDF stylesheet —
  // a full-width table is a spreadsheet grid, not a scientific table.
  return new Table({ rows, alignment: AlignmentType.CENTER, width: { size: 0, type: 'auto' } })
}

/**
 * The block images of a paragraph, but only when EVERY one of them has bytes
 * loaded. All-or-nothing on purpose: a paragraph that renders half its images
 * and drops the rest loses content silently, so a partial load falls back to
 * the alt-text paragraph, which still names all of them.
 */
function loadedBlockImages(node: RootChild, ctx: DocxCtx): ImageNode[] {
  const images = blockImagesOf(node)
  return images.length > 0 && images.every((image) => ctx.imageAssets.has(image)) ? images : []
}

/* ------------------------------------------------------------------ */
/* Real Word lists                                                      */
/* ------------------------------------------------------------------ */

const BULLET_REFERENCE = 'suna-bullet'
const ORDERED_REFERENCE = 'suna-decimal'
const LIST_LEVELS = 9
const BULLET_GLYPHS = ['•', '◦', '▪'] as const

/** Level geometry matching the writer's old literal-prefix indent: text at 5 mm per depth, marker hung 5 mm before it. */
function listLevelIndent(level: number): { left: number; hanging: number } {
  return {
    left: convertMillimetersToTwip(5 * (level + 1)),
    hanging: convertMillimetersToTwip(5)
  }
}

function bulletLevels(): ILevelsOptions[] {
  return Array.from({ length: LIST_LEVELS }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: BULLET_GLYPHS[level % BULLET_GLYPHS.length] as string,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: listLevelIndent(level) } }
  }))
}

function orderedLevels(start: number): ILevelsOptions[] {
  const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN] as const
  return Array.from({ length: LIST_LEVELS }, (_, level) => ({
    level,
    format: formats[level % formats.length] as (typeof formats)[number],
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    start: level === 0 ? start : 1,
    style: { paragraph: { indent: listLevelIndent(level) } }
  }))
}

/**
 * The numbering definitions the walked document actually needs: one bullet
 * reference, the standard decimal reference, and one extra reference per
 * distinct non-1 ordered-list start the prose used (docx's per-instance
 * startOverride restarts each concrete list at its reference's level-0
 * start, which is how "3." lists keep their author-stated origin).
 */
function numberingConfig(ctx: DocxCtx): { reference: string; levels: ILevelsOptions[] }[] {
  return [
    { reference: BULLET_REFERENCE, levels: bulletLevels() },
    { reference: ORDERED_REFERENCE, levels: orderedLevels(1) },
    ...[...ctx.lists.orderedStarts].map((start) => ({
      reference: `${ORDERED_REFERENCE}-start-${start}`,
      levels: orderedLevels(start)
    }))
  ]
}

interface ListNumberingRef {
  reference: string
  instance: number
}

function allocOrderedNumbering(ctx: DocxCtx, start: number): ListNumberingRef {
  let reference = ORDERED_REFERENCE
  if (start !== 1) {
    ctx.lists.orderedStarts.add(start)
    reference = `${ORDERED_REFERENCE}-start-${start}`
  }
  return { reference, instance: ctx.lists.nextInstance++ }
}

/**
 * A markdown list as a REAL Word list: every item paragraph references a
 * registered numbering definition, so Word renumbers on edit and nesting is
 * native multilevel numbering — not a literal "1. "/"• " text prefix. Each
 * top-level ordered list gets its own concrete instance so numbering restarts
 * per list; a nested ordered list inside an ordered parent continues the same
 * instance at the deeper level, which is Word's own multilevel behaviour.
 */
function listParagraphs(
  node: ListNode,
  ctx: DocxCtx,
  level = 0,
  inherited?: ListNumberingRef
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const ordered = node.ordered === true
  const own: ListNumberingRef = ordered
    ? (inherited ?? allocOrderedNumbering(ctx, node.start ?? 1))
    : { reference: BULLET_REFERENCE, instance: 0 }
  const numbering = { reference: own.reference, level, instance: own.instance }

  node.children.forEach((item: ListItemNode) => {
    const runs: DocxInline[] = []
    // Only the item's first flushed paragraph carries the marker; any later
    // paragraph of the same (loose) item continues at the text indent.
    let numberedYet = false
    const flush = (): void => {
      if (runs.length === 0) return
      out.push(
        new Paragraph({
          ...(numberedYet ? { indent: { left: convertMillimetersToTwip(5 * (level + 1)) } } : { numbering }),
          spacing: bodySpacing(ctx, { after: 40 }),
          children: runs.splice(0, runs.length)
        })
      )
      numberedYet = true
    }
    for (const child of item.children) {
      if (child.type === 'paragraph' && loadedBlockImages(child, ctx).length > 0) {
        // A list item whose paragraph IS an image goes through blockNode like
        // any other block image; routing it through inlineChildren wrote the
        // alt text and dropped the picture.
        flush()
        out.push(...blockNode(child, ctx))
      } else if (child.type === 'paragraph') {
        runs.push(...inlineChildren(child.children, ctx))
      } else if (child.type === 'list') {
        flush()
        out.push(...listParagraphs(child, ctx, level + 1, ordered && child.ordered === true ? own : undefined))
      } else {
        flush()
        out.push(...blockNode(child, ctx))
      }
    }
    flush()
  })
  return out
}

/* ------------------------------------------------------------------ */
/* Figures                                                              */
/* ------------------------------------------------------------------ */

/**
 * "Figure N." bold (bookmarked as the `_fig_N` cross-reference target), then
 * the caption body in italic — docx-tools' shape. Centred under an inline
 * image; left-aligned inside a "Figure Captions" list.
 */
function figureCaptionParagraph(
  fig: ExportFigureContent,
  number: number,
  ctx: DocxCtx,
  opts: { centred: boolean }
): Paragraph {
  const capSize = sizeOf(ctx, 'caption')
  const bodyStyle: RunStyle = { italics: true, size: capSize }
  const captionRuns: DocxInline[] = [
    new Bookmark({
      id: `_fig_${number}`,
      children: [textRun(`${fig.label}. `, { bold: true, size: capSize })]
    })
  ]
  captionRuns.push(...inlineFromText(fig.figure.caption.title, ctx, bodyStyle))
  if (fig.figure.caption.body.trim() !== '') {
    captionRuns.push(textRun(' ', bodyStyle))
    captionRuns.push(...inlineFromText(fig.figure.caption.body, ctx, bodyStyle))
  }
  return new Paragraph({
    ...(opts.centred ? { alignment: AlignmentType.CENTER } : {}),
    spacing: { before: ptToTwips(4), after: ptToTwips(12) },
    children: captionRuns
  })
}

function figureBlock(figureId: string, ctx: DocxCtx): Paragraph[] {
  const index = ctx.content.figures.findIndex((f) => f.figure.id === figureId)
  const fig = ctx.content.figures[index]
  const asset = ctx.figureAssets.get(figureId)
  if (fig === undefined || asset === undefined) return []
  // A journal preset wins when the profile states one; otherwise the style's
  // own default width (5 in under SUNA style, matching docx-tools). The
  // supplement's ground truth fixes 165 mm regardless of preset.
  const presetMm = ctx.content.profile.figures.widthPresetsMm[fig.figure.widthPreset]
  const widthMm = ctx.supplement !== undefined ? SUPPLEMENT_FIGURE_WIDTH_MM : (presetMm ?? ctx.style.figureWidthMm)
  const heightMm = widthMm * (asset.height / asset.width)

  const image = new Paragraph({
    alignment: AlignmentType.CENTER,
    keepNext: true,
    spacing: { before: ptToTwips(6), after: 0 },
    children: [
      new ImageRun({
        type: 'png',
        data: asset.buffer,
        transformation: { width: px96(widthMm), height: px96(heightMm) }
      })
    ]
  })

  const caption = figureCaptionParagraph(fig, index + 1, ctx, { centred: true })
  return ctx.style.figureCaptionPosition === 'above' ? [caption, image] : [image, caption]
}

/**
 * A `{width=…}` attribute block in millimetres, or null when the image carries
 * none. `%` is against the printable width, a bare number or `px` is a CSS
 * pixel at 96 dpi — the same reading `@suna/markdown` gives it for HTML.
 */
export function requestedWidthMm(width: string | undefined, textWidthMm: number): number | null {
  if (width === undefined) return null
  const match = /^(\d+(?:\.\d+)?)(%|px)?$/.exec(width.trim())
  const digits = match?.[1]
  if (digits === undefined) return null
  const value = Number(digits)
  if (!Number.isFinite(value) || value <= 0) return null
  return match?.[2] === '%' ? (value / 100) * textWidthMm : (value / 96) * 25.4
}

/**
 * A markdown block image — `![alt](../figures/x.png)` on its own line, the
 * loose form that is NOT a managed `![[fig:id]]` figure, so it carries no
 * caption and takes no figure number.
 *
 * Sized to its natural pixel size at 96 dpi, narrowed by a `{width=…}`
 * attribute block, then shrunk to fit the printable box. The attribute is a
 * CEILING in every renderer (see @suna/markdown's ImageData.width), so this
 * takes the minimum rather than the requested value — that is what makes Word,
 * the PDF and reading mode agree. Both axes are derived from the same scale
 * factor: fixing one and clamping the other is what distorts an image.
 */
function markdownImageBlock(node: ImageNode, ctx: DocxCtx): Paragraph[] {
  const asset = ctx.imageAssets.get(node)
  if (asset === undefined) return []
  const page = ctx.style.page
  const textWidthMm = page.widthMm - 2 * page.marginMm
  const textHeightMm = page.heightMm - 2 * page.marginMm
  const requested = requestedWidthMm(node.data?.width, textWidthMm)
  const naturalMm = (asset.width / 96) * 25.4
  let widthMm = Math.min(naturalMm, requested ?? naturalMm, textWidthMm)
  let heightMm = widthMm * (asset.height / asset.width)
  if (heightMm > textHeightMm) {
    heightMm = textHeightMm
    widthMm = heightMm * (asset.width / asset.height)
  }
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: bodySpacing(ctx, { before: ptToTwips(6), after: ptToTwips(6) }),
      children: [
        new ImageRun({
          type: 'png',
          data: asset.buffer,
          transformation: { width: px96(widthMm), height: px96(heightMm) }
        })
      ]
    })
  ]
}

function blockNode(node: RootChild, ctx: DocxCtx): (Paragraph | Table)[] {
  switch (node.type) {
    case 'paragraph': {
      // A paragraph that is nothing but images is the block image form — one
      // centred paragraph each, which is how the HTML renderer's `<br/>`
      // between two soft-broken images reads on a page. It only applies when
      // EVERY image's bytes loaded; otherwise the paragraph falls through and
      // writes its alt text, rather than losing half of itself.
      const images = loadedBlockImages(node, ctx)
      if (images.length > 0) return images.flatMap((image) => markdownImageBlock(image, ctx))
      return [
        new Paragraph({
          spacing: bodySpacing(ctx, { after: ptToTwips(ctx.style.bodySpaceAfterPt) }),
          children: inlineChildren(node.children, ctx, bodyRunStyle(ctx))
        })
      ]
    }
    case 'image':
      return markdownImageBlock(node, ctx)
    case 'heading':
      // Prose headings nest under the section heading they sit in, so a
      // markdown "##" inside a section is an H2, not another H1.
      return [headingParagraph(ctx, node.depth <= 1 ? 'A' : 'B', plainText(node.children))]
    case 'list':
      return listParagraphs(node, ctx)
    case 'table': {
      // Under `tablePlacement: 'end'` the body keeps nothing here — the same
      // tables are gathered by endTablesParagraphs after the references.
      if (ctx.style.tablePlacement === 'end') return []
      if (ctx.supplement !== undefined) {
        // Supplement ground truth: every prose table carries a bold
        // "Table S<n>." caption above it, bookmarked like a main-text table.
        const number = ctx.supplement.nextTableNumber++
        const caption = new Paragraph({
          keepNext: true,
          spacing: { before: ptToTwips(4), after: ptToTwips(4) },
          children: [
            new Bookmark({
              id: `_tbl_${number}`,
              children: [textRun(`Table S${number}.`, { bold: true, size: sizeOf(ctx, 'caption') })]
            })
          ]
        })
        return [caption, tableFromMdast(node, ctx)]
      }
      return [tableFromMdast(node, ctx)]
    }
    case 'blockquote':
      return node.children.flatMap((c) => blockNode(c, ctx))
    case 'code':
      return [
        new Paragraph({
          spacing: bodySpacing(ctx, { after: 120 }),
          children: [new TextRun({ text: node.value, font: ctx.style.fonts.mono, size: 20 })]
        })
      ]
    case 'thematicBreak':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }
        })
      ]
    case 'math': {
      // Typeset OMML (tex-omml.ts) when the strict subset covers the whole
      // equation; otherwise the italic-literal fallback, never a half-render.
      const math = texToMath(node.value)
      if (math !== null) {
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: bodySpacing(ctx, { before: ptToTwips(6), after: ptToTwips(6) }),
            children: [new DocxMath({ children: math })]
          })
        ]
      }
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: bodySpacing(ctx, { before: 120, after: 120 }),
          children: [textRun(`$$${node.value}$$`, { italics: true })]
        })
      ]
    }
    case 'figureEmbed':
      // Under `figurePlacement: 'captions-list'` no image is embedded in the
      // body at all; the captions render after the references instead.
      return ctx.style.figurePlacement === 'captions-list' ? [] : figureBlock(node.figureId, ctx)
    case 'rawLatex':
    case 'html':
    case 'yaml':
    case 'definition':
    case 'footnoteDefinition':
      return []
    default:
      return []
  }
}

function blocksFromRoot(root: SciMarkRoot, ctx: DocxCtx): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const children = root.children
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i] as RootChild
    // A `![[tbl:id]]` embed binds the table directly under it to its
    // manuscript.json caption: caption paragraph above, table, italic "Note."
    // below — the SUNA table standard. Under `tablePlacement: 'end'` (or in a
    // supplement, which S-numbers its tables positionally) the embed emits
    // nothing here; the trailing Tables section carries caption and table.
    if (node.type === 'tableEmbed' && ctx.style.tablePlacement !== 'end' && ctx.supplement === undefined) {
      const t = ctx.content.tables.find((x) => x.table.id === node.tableId)
      if (t !== undefined) out.push(tableCaptionParagraph(t, ctx, { titleOnly: true }))
      // The note is part of the table block, so the last row must keep with
      // it — otherwise a "Note." line strands alone at the top of the next
      // page, which is the same defect as a split table wearing a disguise.
      const note = t === undefined ? null : tableNoteParagraph(t, ctx)
      const next = children[i + 1]
      if (next !== undefined && next.type === 'table') {
        out.push(tableFromMdast(next, ctx, { keepWithNext: note !== null }))
        i += 1
      }
      if (note !== null) out.push(note)
      continue
    }
    out.push(...blockNode(node, ctx))
  }
  return out
}

/**
 * A section heading.
 *
 * These are still Word's built-in Heading styles (so the navigation pane, TOC
 * and outline all work), but with the size and colour stated explicitly —
 * Word's default Heading 1 is 16 pt BLUE, which is the single biggest reason
 * an untouched Word export does not look like a manuscript. docx-tools forces
 * pure black at 13 pt for H1 and 11 pt below; SUNA style does the same, and
 * keeps `keepNext` so a heading never sits alone at the foot of a page.
 */
function headingParagraph(
  ctx: DocxCtx,
  level: ManuscriptHeadingLevel,
  text: string,
  // Must be passed in rather than applied by the caller: `Paragraph` is a
  // class, so spreading one into a new Paragraph({...}) yields its internal
  // fields, not its options, and silently produces an EMPTY paragraph.
  // `bookmarkId` wraps the heading run in a Bookmark so an internal
  // hyperlink (the supplement's Contents list) can jump to it.
  opts: { pageBreakBefore?: boolean; bookmarkId?: string } = {}
): Paragraph {
  const breakBefore = opts.pageBreakBefore === true
  const isTop = level === 'A'
  const size = isTop ? sizeOf(ctx, 'heading1') : sizeOf(ctx, 'heading2')
  const wrap = (run: TextRun): DocxInline[] =>
    opts.bookmarkId !== undefined ? [new Bookmark({ id: opts.bookmarkId, children: [run] })] : [run]
  if (level === 'C-runin') {
    // Run-in headings are page-typesetting (ADR-002 out of scope) — rendered
    // as their own bold+italic line rather than inline with the paragraph.
    return new Paragraph({
      keepNext: true,
      pageBreakBefore: breakBefore,
      spacing: { before: ptToTwips(8), after: ptToTwips(4) },
      children: wrap(textRun(text, { bold: true, italics: true, size, color: headingColor(ctx) }))
    })
  }
  return new Paragraph({
    heading: isTop ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    keepNext: true,
    pageBreakBefore: breakBefore,
    spacing: { before: ptToTwips(isTop ? 12 : 8), after: ptToTwips(4) },
    children: wrap(textRun(text, { bold: true, size, color: headingColor(ctx) }))
  })
}

/**
 * Front matter, in docx-tools' order and shape (see resources/profiles/
 * suna.json's notes for what that is and where each value comes from):
 * title, authors, affiliations, corresponding line, highlights, then the
 * significance/abstract — with the abstract LAST because docx-tools treats
 * highlights as front matter and the abstract as the first ordinary
 * heading+body — and the keywords line directly after the abstract.
 */
/**
 * The byline — author line with affiliation markers, numbered affiliations,
 * corresponding line — shared verbatim by the manuscript title page and the
 * Supplementary Information cover (ground truth: the supplement repeats the
 * SAME author block as the manuscript).
 */
function bylineParagraphs(ctx: DocxCtx): Paragraph[] {
  const content = ctx.content
  const out: Paragraph[] = []

  const authorRuns: DocxInline[] = []
  const authorSize = sizeOf(ctx, 'author')
  content.authors.authors.forEach((author, i) => {
    if (i > 0) authorRuns.push(textRun(', ', { size: authorSize }))
    authorRuns.push(textRun(`${author.given} ${author.family}`, { size: authorSize }))
    const markers = authorMarkers(author, content.affiliations.numberOf)
    if (markers.length > 0) {
      authorRuns.push(textRun(markers.join(','), { superScript: true, size: authorSize }))
    }
  })
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: ptToTwips(6) },
      children: authorRuns
    })
  )

  const affSize = sizeOf(ctx, 'affiliation')
  content.affiliations.ordered.forEach((a, i) => {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: ptToTwips(1) },
        children: [textRun(String(i + 1), { superScript: true, size: affSize }), textRun(` ${a.text}`, { size: affSize })]
      })
    )
  })

  const corresponding = content.authors.authors
    .filter((a) => a.corresponding && a.email !== null)
    .map((a) => a.email)
    .filter((e): e is string => e !== null)
  if (corresponding.length > 0) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: ptToTwips(14) },
        children: [
          textRun(`* Corresponding author: ${corresponding.join(', ')}`, { italics: true, size: affSize })
        ]
      })
    )
  }
  return out
}

function titlePageParagraphs(ctx: DocxCtx): Paragraph[] {
  const content = ctx.content
  const m = content.manuscript
  const style = ctx.style
  const out: Paragraph[] = []

  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: ptToTwips(4) },
      children: texRuns(m.title, { bold: true, size: sizeOf(ctx, 'title'), color: headingColor(ctx) })
    })
  )

  out.push(...bylineParagraphs(ctx))

  if (m.highlights != null && m.highlights.length > 0) {
    out.push(
      new Paragraph({
        spacing: { before: ptToTwips(10), after: ptToTwips(4) },
        children: [textRun('Highlights', { bold: true, size: sizeOf(ctx, 'body') })]
      })
    )
    for (const h of m.highlights) {
      // docx-tools sets its own bullet glyph with a hanging indent rather
      // than using a Word list — kept for the highlights block specifically
      // so the front matter is byte-shaped like docx-tools' (markdown lists
      // in the BODY are real Word lists; see listParagraphs).
      out.push(
        new Paragraph({
          indent: { left: mmToTwips(6.35), hanging: mmToTwips(3.81) },
          spacing: { before: 0, after: ptToTwips(2) },
          children: [textRun('•  ', { size: sizeOf(ctx, 'caption') }), ...texRuns(h, { size: sizeOf(ctx, 'caption') })]
        })
      )
    }
    out.push(new Paragraph({ spacing: { after: ptToTwips(6) }, children: [] }))
  }

  if (m.significance != null) {
    out.push(headingParagraph(ctx, 'A', 'Significance'))
    out.push(
      new Paragraph({
        spacing: bodySpacing(ctx, { after: ptToTwips(style.bodySpaceAfterPt) }),
        children: texRuns(m.significance, { size: sizeOf(ctx, 'body') })
      })
    )
  }

  out.push(headingParagraph(ctx, 'A', 'Abstract'))
  out.push(
    new Paragraph({
      spacing: bodySpacing(ctx, { after: ptToTwips(style.bodySpaceAfterPt) }),
      children: texRuns(m.abstract.content, { size: sizeOf(ctx, 'body') })
    })
  )

  if (m.keywords !== undefined && m.keywords.length > 0) {
    out.push(
      new Paragraph({
        spacing: bodySpacing(ctx, { after: ptToTwips(style.bodySpaceAfterPt) }),
        children: [
          textRun('Keywords: ', { bold: true, size: sizeOf(ctx, 'body') }),
          textRun(m.keywords.join('; '), { italics: true, size: sizeOf(ctx, 'body') })
        ]
      })
    )
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Back matter                                                          */
/* ------------------------------------------------------------------ */

/**
 * Back matter, rendered as H1 sections in the ground-truth order:
 * Acknowledgments → Funding → Competing Interests → Data/Code Availability →
 * Author Contributions. Only sections with content render; funding entries
 * join into one paragraph, "Funder (grant)" style.
 */
function backMatterParagraphs(ctx: DocxCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const section of backMatterSections(ctx.content)) {
    out.push(headingParagraph(ctx, 'A', section.title))
    for (const text of section.paragraphs) {
      out.push(
        new Paragraph({
          spacing: bodySpacing(ctx, { after: ptToTwips(ctx.style.bodySpaceAfterPt) }),
          children: inlineFromText(text, ctx, bodyRunStyle(ctx))
        })
      )
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Tables and trailing sections                                         */
/* ------------------------------------------------------------------ */

function tablesParagraphs(content: ExportContent, ctx: DocxCtx): Paragraph[] {
  // Tables the prose embeds via `![[tbl:id]]` render in place (caption above,
  // note below) — the trailing section carries only the rest.
  const embedded = new Set(content.sections.flatMap((s) => (s.root === null ? [] : collectTableEmbeds(s.root))))
  const rest = content.tables.filter((t) => !embedded.has(t.table.id))
  if (rest.length === 0) return []
  const out: Paragraph[] = [headingParagraph(ctx, 'A', 'Tables')]
  for (const t of rest) out.push(tableCaptionParagraph(t, ctx))
  return out
}

/**
 * A table's caption. Same shape as a figure's — a bold "Table N."
 * (bookmarked as the `_tbl_N` cross-reference target) followed by an italic
 * body — but left-aligned and, per `tableCaptionPosition`, written ABOVE the
 * table it describes.
 */
function tableCaptionParagraph(
  t: ExportTableContent,
  ctx: DocxCtx,
  /** titleOnly: the caption line above an in-body table — its body/footnotes render below the table as a "Note." paragraph instead. */
  opts: { titleOnly?: boolean } = {}
): Paragraph {
  const number = ctx.content.tables.indexOf(t) + 1
  const capSize = sizeOf(ctx, 'caption')
  const bodyStyle: RunStyle = { italics: true, size: capSize }
  const runs: DocxInline[] = [
    new Bookmark({
      id: `_tbl_${number}`,
      children: [textRun(`${t.label}. `, { bold: true, size: capSize })]
    }),
    ...inlineFromText(t.table.caption.title, ctx, bodyStyle)
  ]
  if (opts.titleOnly !== true) {
    if (t.table.caption.body !== undefined && t.table.caption.body.trim() !== '') {
      runs.push(textRun(' ', bodyStyle))
      runs.push(...inlineFromText(t.table.caption.body, ctx, bodyStyle))
    }
    for (const note of t.table.footnotes) {
      runs.push(textRun(` [${note.mark}] ${note.text}`, { italics: true, size: capSize }))
    }
  }
  return new Paragraph({
    keepNext: true,
    spacing: { before: ptToTwips(4), after: ptToTwips(4) },
    children: runs
  })
}

/**
 * The italic "Note." paragraph under an in-body captioned table: caption body
 * first, then the footnotes. Null when the table has neither.
 */
function tableNoteParagraph(t: ExportTableContent, ctx: DocxCtx): Paragraph | null {
  const capSize = sizeOf(ctx, 'caption')
  const noteStyle: RunStyle = { italics: true, size: capSize }
  const runs: DocxInline[] = []
  if (t.table.caption.body !== undefined && t.table.caption.body.trim() !== '') {
    runs.push(...inlineFromText(t.table.caption.body, ctx, noteStyle))
  }
  for (const note of t.table.footnotes) {
    if (runs.length > 0) runs.push(textRun(' ', noteStyle))
    runs.push(textRun(note.mark, { ...noteStyle, superScript: true }))
    runs.push(textRun(` ${note.text}`, noteStyle))
  }
  if (runs.length === 0) return null
  return new Paragraph({
    spacing: { before: ptToTwips(2), after: ptToTwips(8) },
    children: [textRun('Note. ', noteStyle), ...runs]
  })
}

/** The `figurePlacement: 'captions-list'` section: every figure's caption, after the references. */
function figureCaptionsParagraphs(ctx: DocxCtx): Paragraph[] {
  const figures = ctx.content.figures
  if (figures.length === 0) return []
  const out: Paragraph[] = [headingParagraph(ctx, 'A', 'Figure Captions')]
  figures.forEach((fig, i) => out.push(figureCaptionParagraph(fig, i + 1, ctx, { centred: false })))
  return out
}

/**
 * The `tablePlacement: 'end'` section: manuscript.json table captions plus
 * every markdown table the body suppressed, in document order, after the
 * captions list.
 */
function endTablesParagraphs(ctx: DocxCtx): (Paragraph | Table)[] {
  const captioned = ctx.content.tables
  const mdTables = ctx.content.sections.flatMap((s) => (s.root === null ? [] : collectTables(s.root.children)))
  if (captioned.length === 0 && mdTables.length === 0) return []
  const out: (Paragraph | Table)[] = [headingParagraph(ctx, 'A', 'Tables')]
  for (const t of captioned) out.push(tableCaptionParagraph(t, ctx))
  mdTables.forEach((t, i) => {
    out.push(tableFromMdast(t, ctx))
    if (i < mdTables.length - 1) {
      out.push(new Paragraph({ spacing: { before: 0, after: ptToTwips(8) }, children: [] }))
    }
  })
  return out
}

function referencesParagraphs(ctx: DocxCtx, title = 'References'): Paragraph[] {
  const content = ctx.content
  const numeric = isNumericCitationMode(content.profile)
  const refSize = sizeOf(ctx, 'reference')
  const out: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      // The SUNA default starts the reference list on a fresh page; a profile
      // may state otherwise through its documentStyle delta.
      pageBreakBefore: ctx.style.referencesStartNewPage,
      keepNext: true,
      spacing: { before: ptToTwips(12), after: ptToTwips(4) },
      children: [textRun(title, { bold: true, size: sizeOf(ctx, 'heading1'), color: headingColor(ctx) })]
    })
  ]
  const hanging = mmToTwips(ctx.style.referenceHangingMm)
  for (const row of content.referenceRows) {
    const runs = formatReferenceRow(row, content.profile)
    const style: RunStyle = { size: refSize }
    const children: DocxInline[] = numeric ? [textRun(`${row.number}. `, { ...style, bold: true })] : []
    if (runs === null) {
      children.push(
        textRun(`@${row.key} — cited but not found in ${content.manuscript.bibliography}`, {
          ...style,
          color: 'AA0000'
        })
      )
    } else {
      children.push(...bibRunsToDocx(runs, style, ctx.palette !== undefined ? linkColor(ctx) : undefined))
    }
    out.push(
      new Paragraph({
        indent: { left: hanging, hanging },
        spacing: { after: ptToTwips(4) },
        children
      })
    )
  }
  return out
}

async function buildFigureAssets(content: ExportContent): Promise<Map<string, FigureAsset>> {
  const map = new Map<string, FigureAsset>()
  for (const fig of content.figures) {
    const buffer = await readFile(fig.pngPath)
    const { width, height } = pngDimensions(buffer)
    map.set(fig.figure.id, { buffer, width, height })
  }
  return map
}

/**
 * Bytes for the markdown block images, keyed by their AST node.
 *
 * PNG only: `pngDimensions` is this codebase's one natural-size reader, and an
 * `ImageRun` needs the source pixel aspect to size its transformation. An
 * `.svg` url in particular cannot be embedded through this path at all (docx
 * carries SVG only alongside a raster fallback nothing here can rasterize —
 * `rasterizeFigures.ts` is renderer-side and only knows MANAGED figures). Those
 * keep their alt text, reported here rather than silently dropped.
 */
async function buildMarkdownImageAssets(content: ExportContent): Promise<Map<RootChild, FigureAsset>> {
  const map = new Map<RootChild, FigureAsset>()
  for (const section of content.sections) {
    if (section.root === null) continue
    for (const node of collectBlockImages(section.root.children)) {
      const path = resolveExportImagePath(node.url, content)
      if (path === null || extname(path).toLowerCase() !== '.png') {
        console.warn(`export:docx — "${node.url}" is not an embeddable PNG; writing its alt text instead`)
        continue
      }
      try {
        const buffer = await readFile(assertInsideAllowedRoot(path))
        const { width, height } = pngDimensions(buffer)
        map.set(node, { buffer, width, height })
      } catch (error) {
        console.warn(`export:docx — "${node.url}" left as its alt text:`, error)
      }
    }
  }
  return map
}

export async function buildDocxDocument(content: ExportContent, options: ExportOptions): Promise<Document> {
  const figureAssets = await buildFigureAssets(content)
  const imageAssets = await buildMarkdownImageAssets(content)
  const style = resolveDocumentStyle(content.profile)
  const palette = exportPalette(options.theme)
  const ctx: DocxCtx = {
    content,
    doubleSpacing: options.doubleSpacing,
    figureAssets,
    imageAssets,
    style,
    palette,
    lists: { orderedStarts: new Set(), nextInstance: 1 }
  }

  // Walk everything BEFORE constructing the Document: the list walk registers
  // the numbering definitions the Document has to carry.
  const frontMatter = titlePageParagraphs(ctx)
  const bodyChildren: (Paragraph | Table)[] = []
  content.sections.forEach((section, index) => {
    // The body starts on its own page when the style says so — docx-tools
    // breaks after the front matter, so the Introduction opens page 2.
    const breakHere = style.pageBreakAfterFrontMatter && index === 0
    if (section.heading !== null) {
      bodyChildren.push(headingParagraph(ctx, section.level, section.heading, { pageBreakBefore: breakHere }))
    } else if (breakHere) {
      bodyChildren.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }))
    }
    if (section.root !== null) bodyChildren.push(...blocksFromRoot(section.root, ctx))
  })
  bodyChildren.push(...backMatterParagraphs(ctx))
  if (style.tablePlacement === 'inline') bodyChildren.push(...tablesParagraphs(content, ctx))
  bodyChildren.push(...referencesParagraphs(ctx))
  if (style.figurePlacement === 'captions-list') bodyChildren.push(...figureCaptionsParagraphs(ctx))
  if (style.tablePlacement === 'end') bodyChildren.push(...endTablesParagraphs(ctx))

  const sectionProperties: ISectionPropertiesOptions = {
    page: {
      size: {
        width: convertMillimetersToTwip(style.page.widthMm),
        height: convertMillimetersToTwip(style.page.heightMm)
      },
      margin: {
        top: convertMillimetersToTwip(style.page.marginMm),
        bottom: convertMillimetersToTwip(style.page.marginMm),
        left: convertMillimetersToTwip(style.page.marginMm),
        right: convertMillimetersToTwip(style.page.marginMm)
      }
    },
    ...(options.lineNumbers ? { lineNumbers: { countBy: 1, restart: LineNumberRestartFormat.CONTINUOUS } } : {})
  }

  const footers = options.pageNumbers
    ? {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  children: [PageNumber.CURRENT],
                  size: sizeOf(ctx, 'footer'),
                  font: style.fonts.body
                })
              ]
            })
          ]
        })
      }
    : undefined

  return new Document({
    title: content.manuscript.title,
    // Neutral document metadata: the authoring tool's name, never a library's.
    creator: 'SUNA',
    lastModifiedBy: 'SUNA',
    description: '',
    // A theme colors the whole page: docx's Document background paints the
    // page, and the default run color sets the body ink — runs that state no
    // color (nearly all of them) inherit it, so no per-run change is needed.
    ...(palette !== undefined ? { background: { color: docxHex(palette.bg) } } : {}),
    numbering: { config: numberingConfig(ctx) },
    styles: {
      default: {
        document: {
          run: {
            font: style.fonts.body,
            size: halfPoints(style.sizesPt.body),
            ...(palette !== undefined ? { color: docxHex(palette.ink) } : {})
          }
        }
      }
    },
    sections: [
      {
        properties: sectionProperties,
        footers,
        children: [...frontMatter, ...bodyChildren]
      }
    ]
  })
}

/* ------------------------------------------------------------------ */
/* Supplementary Information                                            */
/* ------------------------------------------------------------------ */

interface SupplementAnchor {
  heading: string
  level: ManuscriptHeadingLevel
  /** The `_supp_<slug>` bookmark on the heading, or null for a heading-less leading section. */
  anchor: string | null
}

/**
 * One `_supp_<slug>` bookmark id per headed section, deduplicated the way
 * buildLabelMap deduplicates section slugs (first heading wins; a repeat gets
 * a numeric suffix so the Contents links stay one-to-one with the headings).
 * Aligned by index with `content.sections` so the body walk and the Contents
 * list agree on every anchor.
 */
function supplementAnchors(content: ExportContent): SupplementAnchor[] {
  const used = new Set<string>()
  return content.sections.map((section) => {
    if (section.heading === null) return { heading: '', level: section.level, anchor: null }
    let slug = slugifyHeading(section.heading)
    if (slug === '') slug = 'section'
    let unique = slug
    for (let i = 2; used.has(unique); i++) unique = `${slug}-${i}`
    used.add(unique)
    return { heading: section.heading, level: section.level, anchor: `_supp_${unique}` }
  })
}

/**
 * The "Contents" mini-TOC (ground truth: bold 12 pt label, then one line per
 * heading as an internal hyperlink — cross-reference blue, underlined, body
 * size — H1 entries indented 0.2 in, deeper ones 0.45 in, 3 pt after each).
 */
function supplementContentsParagraphs(ctx: DocxCtx, anchors: readonly SupplementAnchor[]): Paragraph[] {
  const entries = anchors.filter((a) => a.anchor !== null)
  if (entries.length === 0) return []
  const out: Paragraph[] = [
    new Paragraph({
      spacing: { before: ptToTwips(10), after: ptToTwips(6) },
      children: [textRun('Contents', { bold: true, size: halfPoints(12) })]
    })
  ]
  for (const entry of entries) {
    const indentIn = entry.level === 'A' ? 0.2 : 0.45
    out.push(
      new Paragraph({
        indent: { left: mmToTwips(indentIn * 25.4) },
        spacing: { after: ptToTwips(3) },
        children: [
          new InternalHyperlink({
            anchor: entry.anchor as string,
            children: [
              new TextRun({
                text: entry.heading,
                size: sizeOf(ctx, 'body'),
                color: linkColor(ctx),
                underline: {}
              })
            ]
          })
        ]
      })
    )
  }
  return out
}

/**
 * The Supplementary Information document, shaped after the user's real
 * published supplement (sleepTI_supplement.docx):
 * - cover title `Supplementary Information: <main title>` in the style's
 *   title role, then the SAME byline block as the manuscript;
 * - a `Contents` mini-TOC of internal hyperlinks to bookmarked headings;
 * - the body with figures embedded inline at 165 mm ("Figure S1." captions,
 *   bold label + italic body) and GFM tables under "Table S1." captions at
 *   9 pt cells;
 * - independently numbered references under "Supplementary References";
 * - a page-number footer that is ALWAYS on (9 pt, right-aligned);
 * - no highlights/abstract/keywords/back matter.
 *
 * Lives beside buildDocxDocument rather than in a sibling module because it
 * is the same walk over the same ctx machinery (inline runs, lists, tables,
 * figures, references) with a different frame around it.
 */
export async function buildSupplementDocx(content: ExportContent, options: ExportOptions): Promise<Document> {
  const figureAssets = await buildFigureAssets(content)
  const imageAssets = await buildMarkdownImageAssets(content)
  const base = resolveDocumentStyle(content.profile)
  // The supplement's ground-truth shape wins over the profile's MAIN-document
  // conventions: figures always embed inline, tables stay in the flow, and
  // table cells drop to 9 pt.
  const style: ResolvedDocumentStyle = {
    ...base,
    sizesPt: { ...base.sizesPt, tableCell: 9 },
    figurePlacement: 'inline',
    tablePlacement: 'inline'
  }
  const palette = exportPalette(options.theme)
  const ctx: DocxCtx = {
    content,
    doubleSpacing: options.doubleSpacing,
    figureAssets,
    imageAssets,
    style,
    palette,
    lists: { orderedStarts: new Set(), nextInstance: 1 },
    supplement: { nextTableNumber: 1 }
  }

  const title = `Supplementary Information: ${content.manuscript.title}`
  const cover: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: ptToTwips(4) },
      children: texRuns(title, { bold: true, size: sizeOf(ctx, 'title'), color: headingColor(ctx) })
    }),
    ...bylineParagraphs(ctx)
  ]

  const anchors = supplementAnchors(content)
  const contents = supplementContentsParagraphs(ctx, anchors)

  const body: (Paragraph | Table)[] = []
  content.sections.forEach((section, index) => {
    const anchor = anchors[index]?.anchor ?? null
    if (section.heading !== null) {
      body.push(
        headingParagraph(ctx, section.level, section.heading, anchor !== null ? { bookmarkId: anchor } : {})
      )
    }
    if (section.root !== null) body.push(...blocksFromRoot(section.root, ctx))
  })
  if (content.referenceRows.length > 0) {
    body.push(...referencesParagraphs(ctx, 'Supplementary References'))
  }

  const sectionProperties: ISectionPropertiesOptions = {
    page: {
      size: {
        width: convertMillimetersToTwip(style.page.widthMm),
        height: convertMillimetersToTwip(style.page.heightMm)
      },
      margin: {
        top: convertMillimetersToTwip(style.page.marginMm),
        bottom: convertMillimetersToTwip(style.page.marginMm),
        left: convertMillimetersToTwip(style.page.marginMm),
        right: convertMillimetersToTwip(style.page.marginMm)
      }
    },
    ...(options.lineNumbers ? { lineNumbers: { countBy: 1, restart: LineNumberRestartFormat.CONTINUOUS } } : {})
  }

  // The page-number footer is ALWAYS on for a supplement (ground truth),
  // whatever options.pageNumbers says: right-aligned, footer size, body font.
  const footers = {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({
              children: [PageNumber.CURRENT],
              size: sizeOf(ctx, 'footer'),
              font: style.fonts.body
            })
          ]
        })
      ]
    })
  }

  return new Document({
    title,
    creator: 'SUNA',
    lastModifiedBy: 'SUNA',
    description: '',
    ...(palette !== undefined ? { background: { color: docxHex(palette.bg) } } : {}),
    numbering: { config: numberingConfig(ctx) },
    styles: {
      default: {
        document: {
          run: {
            font: style.fonts.body,
            size: halfPoints(style.sizesPt.body),
            ...(palette !== undefined ? { color: docxHex(palette.ink) } : {})
          }
        }
      }
    },
    sections: [
      {
        properties: sectionProperties,
        footers,
        children: [...cover, ...contents, ...body]
      }
    ]
  })
}

export interface ExportDocxRequest {
  dir: string
  profileId: string
  outputName: string
  figurePngPaths: Readonly<Record<string, string>>
  options: ExportOptions
  /** Export this LOGGED version instead of the working copy. */
  versionId?: string
  /** 'manuscript' (default) or the Supplementary Information document. */
  target?: 'manuscript' | 'supplement'
}

export interface ExportDocxResult {
  path: string
}

export async function exportDocx(req: ExportDocxRequest): Promise<ExportDocxResult> {
  const { root, supplement, content } = await prepareManuscriptExport(req)
  const target = await exportOutputPath(root, req.outputName, 'docx')

  const doc = supplement
    ? await buildSupplementDocx(content, req.options)
    : await buildDocxDocument(content, req.options)
  const buffer = await Packer.toBuffer(doc)
  await writeFileAtomic(target, buffer)
  return { path: target }
}
