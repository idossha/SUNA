import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AlignmentType,
  BorderStyle,
  convertMillimetersToTwip,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  LineNumberRestartFormat,
  LineRuleType,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  type ISectionPropertiesOptions
} from 'docx'
import type { ExportOptions, HeadingLevel as ManuscriptHeadingLevel } from '@suna/core'
import { renderCluster, type Run as BibRun } from '@suna/bib'
import { parseSciMark, type CrossRefKind, type SciMarkRoot } from '@suna/markdown'
import {
  authorMarkers,
  buildExportContent,
  formatReferenceRow,
  isNumericCitationMode,
  pngDimensions,
  splitTexSpans,
  widthMmForPreset,
  type ExportContent,
  type ExportTableContent,
  type ListItemNode,
  type ListNode,
  type RootChild,
  type TableNode
} from './export-content'
import { writeFileAtomic } from './atomic'
import { projectSubdir } from './paths'
import { assertInsideAllowedRoot } from './roots'
import { buildViaDocxTools, docxToolsAvailable } from './docx-tools-accelerator'

/**
 * DOCX export (feature-plan-6 §3), built entirely with the bundled 'docx'
 * library — no external binary required. Walks the SAME parsed SciMark AST
 * (`ExportContent.sections[i].root`) the HTML/PDF path renders with
 * (export-html.ts) into `docx` Paragraphs/Tables, so citations, cross-refs
 * and the reference list are pixel-identical in *content* across both
 * outputs even though the renderers are independent.
 *
 * Known, deliberately scoped-down paths (all reported, none silent):
 * - Inline/display math ($...$/$$...$$) has no OMML conversion: it renders
 *   as literal italic LaTeX source, not typeset. Converting LaTeX to OOXML
 *   math markup is a real project of its own (docx *can* carry OMML, but
 *   nothing in this codebase can produce it from our TeX source) — out of
 *   scope for this milestone rather than invented on the fly.
 * - Ordered lists render as literally-numbered paragraphs ("1. text"), not
 *   a native restartable Word numbered-list (which needs a registered
 *   AbstractNumbering definition per list). They print correctly; they are
 *   not "renumber automatically if I delete item 2" Word lists.
 * - Citation/cross-reference runs are not hyperlinked to their reference-list
 *   entry (unlike DOI/URL links inside a reference itself, which ARE real
 *   hyperlinks) — no bookmark-based in-document jump target is built.
 * - manuscript.json's `tables` carry only a caption + footnotes (no cell
 *   grid — the schema has no row data), so they render as a numbered,
 *   captioned block, not a data table. A markdown table physically written
 *   into a section's prose (GFM syntax) renders as a real docx Table.
 */

type DocxInline = TextRun | ExternalHyperlink

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
}

/** twips-per-96dpi-pixel conversion docx's ImageRun transformation expects (EMU math handled internally by the lib at 9525 EMU/px). */
function px96(mm: number): number {
  return Math.max(1, Math.round((mm / 25.4) * 96))
}

function bodySpacing(ctx: DocxCtx, extra?: { before?: number; after?: number }) {
  return {
    ...extra,
    ...(ctx.doubleSpacing ? { line: 480, lineRule: LineRuleType.AUTO } : {})
  }
}

function textRun(text: string, style: RunStyle = {}): TextRun {
  return new TextRun({ text, ...style })
}

function texRuns(text: string, style: RunStyle = {}): TextRun[] {
  return splitTexSpans(text).map((seg) =>
    seg.kind === 'math' ? textRun(seg.value, { ...style, italics: true }) : textRun(seg.value, style)
  )
}

function bibRunsToDocx(runs: readonly BibRun[], style: RunStyle = {}): DocxInline[] {
  return runs.map((r) => {
    const runStyle: RunStyle = {
      ...style,
      bold: style.bold || r.style === 'bold',
      italics: style.italics || r.style === 'italic'
    }
    if (r.link !== undefined && 'url' in r.link) {
      return new ExternalHyperlink({ children: [textRun(r.text, runStyle)], link: r.link.url })
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
      case 'inlineMath':
        out.push(textRun((node as unknown as { value: string }).value, { ...style, italics: true }))
        break
      case 'citation': {
        const c = node as unknown as { keys: string[]; narrative: boolean }
        out.push(...citationInline(c.keys, c.narrative, ctx, style))
        break
      }
      case 'crossRef': {
        const c = node as unknown as { kind: CrossRefKind; id: string; suffix?: string }
        out.push(textRun(crossRefText(c.kind, c.id, c.suffix, ctx.content), style))
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

function tableFromMdast(node: TableNode, ctx: DocxCtx): Table {
  const rows = node.children.map(
    (row) =>
      new TableRow({
        children: row.children.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: inlineChildren(cell.children, ctx) })],
              margins: { top: 60, bottom: 60, left: 100, right: 100 }
            })
        )
      })
  )
  return new Table({ rows, width: { size: 100, type: 'pct' } })
}

function listParagraphs(node: ListNode, ctx: DocxCtx, level = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const indent = { left: convertMillimetersToTwip(5 * (level + 1)) }
  node.children.forEach((item: ListItemNode, i) => {
    const prefix = node.ordered === true ? `${(node.start ?? 1) + i}. ` : undefined
    const runs: DocxInline[] = prefix !== undefined ? [textRun(prefix)] : []
    for (const child of item.children) {
      if (child.type === 'paragraph') {
        runs.push(...inlineChildren(child.children, ctx))
      } else if (child.type === 'list') {
        // flush what we have as one paragraph, then recurse for the nested list
        out.push(
          new Paragraph({
            indent,
            bullet: node.ordered === true ? undefined : { level },
            spacing: bodySpacing(ctx, { after: 40 }),
            children: runs.splice(0, runs.length)
          })
        )
        out.push(...listParagraphs(child, ctx, level + 1))
      } else {
        out.push(...blockNode(child, ctx))
      }
    }
    if (runs.length > 0) {
      out.push(
        new Paragraph({
          indent,
          bullet: node.ordered === true ? undefined : { level },
          spacing: bodySpacing(ctx, { after: 40 }),
          children: runs
        })
      )
    }
  })
  return out
}

function figureBlock(figureId: string, ctx: DocxCtx): Paragraph[] {
  const fig = ctx.content.figures.find((f) => f.figure.id === figureId)
  const asset = ctx.figureAssets.get(figureId)
  if (fig === undefined || asset === undefined) return []
  const widthMm = widthMmForPreset(fig.figure.widthPreset, ctx.content.profile)
  const heightMm = widthMm * (asset.height / asset.width)
  const image = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 80 },
    children: [
      new ImageRun({
        type: 'png',
        data: asset.buffer,
        transformation: { width: px96(widthMm), height: px96(heightMm) }
      })
    ]
  })
  const captionRuns: DocxInline[] = [textRun(`${fig.label}. `, { bold: true })]
  captionRuns.push(...inlineFromText(fig.figure.caption.title, ctx))
  if (fig.figure.caption.body.trim() !== '') {
    captionRuns.push(textRun(' '))
    captionRuns.push(...inlineFromText(fig.figure.caption.body, ctx))
  }
  const caption = new Paragraph({ spacing: { after: 240 }, children: captionRuns })
  return [image, caption]
}

function blockNode(node: RootChild, ctx: DocxCtx): (Paragraph | Table)[] {
  switch (node.type) {
    case 'paragraph':
      return [new Paragraph({ spacing: bodySpacing(ctx, { after: 120 }), children: inlineChildren(node.children, ctx) })]
    case 'heading': {
      const level =
        node.depth <= 1 ? HeadingLevel.HEADING_2 : node.depth === 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4
      return [new Paragraph({ heading: level, children: inlineChildren(node.children, ctx) })]
    }
    case 'list':
      return listParagraphs(node, ctx)
    case 'table':
      return [tableFromMdast(node, ctx)]
    case 'blockquote':
      return node.children.flatMap((c) => blockNode(c, ctx))
    case 'code':
      return [
        new Paragraph({
          spacing: bodySpacing(ctx, { after: 120 }),
          children: [new TextRun({ text: node.value, font: 'Courier New', size: 20 })]
        })
      ]
    case 'thematicBreak':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }
        })
      ]
    case 'math':
      // Literal LaTeX source, italicized — see module doc's math limitation.
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: bodySpacing(ctx, { before: 120, after: 120 }),
          children: [textRun(`$$${node.value}$$`, { italics: true })]
        })
      ]
    case 'figureEmbed':
      return figureBlock(node.figureId, ctx)
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
  return root.children.flatMap((node) => blockNode(node, ctx))
}

function headingParagraph(level: ManuscriptHeadingLevel, text: string): Paragraph {
  switch (level) {
    case 'A':
      return new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: false, children: [textRun(text)] })
    case 'B':
      return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [textRun(text)] })
    case 'C-runin':
      // Run-in headings are page-typesetting (ADR-002 out of scope) —
      // rendered as their own bold+italic line rather than inline with the
      // following paragraph.
      return new Paragraph({ spacing: { before: 160, after: 40 }, children: [textRun(text, { bold: true, italics: true })] })
  }
}

function titlePageParagraphs(content: ExportContent): Paragraph[] {
  const m = content.manuscript
  const out: Paragraph[] = []

  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: texRuns(m.title, { bold: true, size: 32 })
    })
  )

  const authorRuns: DocxInline[] = []
  content.authors.authors.forEach((author, i) => {
    if (i > 0) authorRuns.push(textRun(', '))
    authorRuns.push(textRun(`${author.given} ${author.family}`))
    const markers = authorMarkers(author, content.affiliations.numberOf)
    if (markers.length > 0) authorRuns.push(textRun(markers.join(','), { superScript: true }))
  })
  out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: authorRuns }))

  content.affiliations.ordered.forEach((a, i) => {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [textRun(String(i + 1), { superScript: true, size: 18 }), textRun(` ${a.text}`, { size: 18 })]
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
        spacing: { before: 120, after: 200 },
        children: [textRun(`*e-mail: ${corresponding.join(', ')}`, { italics: true, size: 18 })]
      })
    )
  }

  out.push(new Paragraph({ spacing: { before: 160 }, children: [textRun('Abstract', { bold: true })] }))
  out.push(new Paragraph({ spacing: { after: 200 }, children: texRuns(m.abstract.content) }))

  if (m.significance != null) {
    out.push(new Paragraph({ children: [textRun('Significance', { bold: true })] }))
    out.push(new Paragraph({ spacing: { after: 200 }, children: texRuns(m.significance) }))
  }
  if (m.highlights != null && m.highlights.length > 0) {
    out.push(new Paragraph({ children: [textRun('Highlights', { bold: true })] }))
    for (const h of m.highlights) out.push(new Paragraph({ bullet: { level: 0 }, children: texRuns(h) }))
  }

  return out
}

function tablesParagraphs(content: ExportContent, ctx: DocxCtx): Paragraph[] {
  if (content.tables.length === 0) return []
  const out: Paragraph[] = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [textRun('Tables')] })]
  for (const t of content.tables) out.push(tableCaptionParagraph(t, ctx))
  return out
}

function tableCaptionParagraph(t: ExportTableContent, ctx: DocxCtx): Paragraph {
  const runs: DocxInline[] = [textRun(`${t.label}. `, { bold: true }), ...inlineFromText(t.table.caption.title, ctx)]
  if (t.table.caption.body !== undefined && t.table.caption.body.trim() !== '') {
    runs.push(textRun(' '))
    runs.push(...inlineFromText(t.table.caption.body, ctx))
  }
  for (const note of t.table.footnotes) {
    runs.push(textRun(` [${note.mark}] ${note.text}`, { italics: true, size: 18 }))
  }
  return new Paragraph({ spacing: { after: 200 }, children: runs })
}

function referencesParagraphs(content: ExportContent): Paragraph[] {
  const numeric = isNumericCitationMode(content.profile)
  const out: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [textRun('References')] })
  ]
  for (const row of content.referenceRows) {
    const runs = formatReferenceRow(row, content.profile)
    const children: DocxInline[] = numeric ? [textRun(`${row.number}. `, { bold: true })] : []
    if (runs === null) {
      children.push(
        textRun(`@${row.key} — cited but not found in ${content.manuscript.bibliography}`, { color: 'AA0000' })
      )
    } else {
      children.push(...bibRunsToDocx(runs))
    }
    out.push(
      new Paragraph({
        indent: { left: convertMillimetersToTwip(8), hanging: convertMillimetersToTwip(8) },
        spacing: { after: 120 },
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

/** US-letter-adjacent, fixed generic manuscript geometry — see module doc: the profile schema has no page-geometry fields (ADR-002). */
const PAGE_WIDTH_MM = 210 // A4
const PAGE_HEIGHT_MM = 297
const MARGIN_MM = 25.4 // 1 inch

export async function buildDocxDocument(content: ExportContent, options: ExportOptions): Promise<Document> {
  const figureAssets = await buildFigureAssets(content)
  const ctx: DocxCtx = { content, doubleSpacing: options.doubleSpacing, figureAssets }

  const bodyChildren: (Paragraph | Table)[] = []
  for (const section of content.sections) {
    if (section.heading !== null) bodyChildren.push(headingParagraph(section.level, section.heading))
    if (section.root !== null) bodyChildren.push(...blocksFromRoot(section.root, ctx))
  }
  bodyChildren.push(...tablesParagraphs(content, ctx))
  bodyChildren.push(...referencesParagraphs(content))

  const sectionProperties: ISectionPropertiesOptions = {
    page: {
      size: { width: convertMillimetersToTwip(PAGE_WIDTH_MM), height: convertMillimetersToTwip(PAGE_HEIGHT_MM) },
      margin: {
        top: convertMillimetersToTwip(MARGIN_MM),
        bottom: convertMillimetersToTwip(MARGIN_MM),
        left: convertMillimetersToTwip(MARGIN_MM),
        right: convertMillimetersToTwip(MARGIN_MM)
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
              children: [new TextRun({ children: [PageNumber.CURRENT] })]
            })
          ]
        })
      }
    : undefined

  return new Document({
    title: content.manuscript.title,
    creator: '',
    description: '',
    // The profile schema has no manuscript body font/size field (ADR-002 —
    // see module doc); this is a fixed, generic submission-manuscript
    // default (12pt Times New Roman), matching export-html.ts's own PDF
    // default rather than a per-journal rule that doesn't exist in the data.
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [
      {
        properties: sectionProperties,
        footers,
        children: [...titlePageParagraphs(content), ...bodyChildren]
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
  useDocxTools: boolean
}

export interface ExportDocxResult {
  path: string
  usedDocxTools: boolean
}

export async function exportDocx(req: ExportDocxRequest): Promise<ExportDocxResult> {
  const root = assertInsideAllowedRoot(req.dir)
  const content = await buildExportContent({
    dir: root,
    profileId: req.profileId,
    figurePngPaths: req.figurePngPaths
  })
  const outputDir = await projectSubdir(root, 'output')
  const target = join(outputDir, `${req.outputName}.docx`)

  if (req.useDocxTools) {
    const available = await docxToolsAvailable()
    if (available) {
      try {
        await buildViaDocxTools(root, content, req.options, target)
        return { path: target, usedDocxTools: true }
      } catch (error) {
        // The accelerator is optional by design (feature-plan-6 §3) — a
        // failure there must never fail the export, only fall back to the
        // bundled-library path below.
        console.warn('docx-tools build failed, falling back to the bundled docx library:', error)
      }
    }
  }

  const doc = await buildDocxDocument(content, req.options)
  const buffer = await Packer.toBuffer(doc)
  await writeFileAtomic(target, buffer)
  return { path: target, usedDocxTools: false }
}
