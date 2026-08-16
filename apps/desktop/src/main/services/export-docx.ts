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
import type { DocumentStyle, ExportOptions, HeadingLevel as ManuscriptHeadingLevel } from '@suna/core'
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
import {
  documentStyleFor,
  halfPoints,
  isHouseStyle,
  lineSpacingTwips,
  mmToTwips,
  ptToTwips
} from './export-style'

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
  /** Typography for this export — see export-style.ts. */
  style: DocumentStyle
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
function sizeOf(ctx: DocxCtx, role: keyof DocumentStyle['sizesPt']): number {
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

/** Body runs carry the style's size under a house style; journal exports keep the document default. */
function bodyRunStyle(ctx: DocxCtx): RunStyle {
  return isHouseStyle(ctx.content.profile) ? { size: sizeOf(ctx, 'body') } : {}
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

/**
 * A markdown table.
 *
 * Under a house style this follows docx-tools' APA treatment: every border
 * cleared, then exactly three horizontal rules — above and below the header
 * row, and under the last row. Header cells are bold and centred, the first
 * column is left-aligned and the rest centred. That is the single change that
 * makes an exported table read as a scientific table rather than a spreadsheet
 * grid, which is what Word's default full-border table looks like.
 */
function tableFromMdast(node: TableNode, ctx: DocxCtx): Table {
  const house = isHouseStyle(ctx.content.profile)
  const cellSize = sizeOf(ctx, 'tableCell')
  const lastIndex = node.children.length - 1

  const rows = node.children.map((row, rowIndex) => {
    const isHeader = rowIndex === 0
    const isLast = rowIndex === lastIndex
    return new TableRow({
      ...(isHeader ? { tableHeader: true } : {}),
      children: row.children.map((cell, colIndex) => {
        const runStyle: RunStyle = house ? { size: cellSize, bold: isHeader } : {}
        const alignment = !house
          ? undefined
          : isHeader || colIndex > 0
            ? AlignmentType.CENTER
            : AlignmentType.LEFT
        return new TableCell({
          children: [
            new Paragraph({
              ...(alignment !== undefined ? { alignment } : {}),
              ...(house ? { spacing: { before: 0, after: 0 } } : {}),
              children: inlineChildren(cell.children, ctx, runStyle)
            })
          ],
          margins: house
            ? { top: isHeader ? 40 : 20, bottom: isHeader ? 40 : 20, left: 60, right: 60 }
            : { top: 60, bottom: 60, left: 100, right: 100 },
          ...(house
            ? {
                borders: {
                  top: isHeader ? RULE : NO_BORDER,
                  bottom: isHeader || isLast ? RULE : NO_BORDER,
                  left: NO_BORDER,
                  right: NO_BORDER
                }
              }
            : {})
        })
      })
    })
  })
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
  const house = isHouseStyle(ctx.content.profile)
  // A journal preset wins when the profile states one; otherwise the style's
  // own default width (5 in under SUNA style, matching docx-tools).
  const presetMm = widthMmForPreset(fig.figure.widthPreset, ctx.content.profile)
  const widthMm = house && fig.figure.widthPreset === null ? ctx.style.figureWidthMm : presetMm
  const heightMm = widthMm * (asset.height / asset.width)

  const image = new Paragraph({
    alignment: AlignmentType.CENTER,
    keepNext: true,
    spacing: house ? { before: ptToTwips(6), after: 0 } : { before: 200, after: 80 },
    children: [
      new ImageRun({
        type: 'png',
        data: asset.buffer,
        transformation: { width: px96(widthMm), height: px96(heightMm) }
      })
    ]
  })

  // "Figure N." bold, then the caption body in italic — docx-tools' shape.
  const capSize = sizeOf(ctx, 'caption')
  const captionRuns: DocxInline[] = [
    textRun(`${fig.label}. `, house ? { bold: true, size: capSize } : { bold: true })
  ]
  const bodyStyle: RunStyle = house ? { italics: true, size: capSize } : {}
  captionRuns.push(...inlineFromText(fig.figure.caption.title, ctx, bodyStyle))
  if (fig.figure.caption.body.trim() !== '') {
    captionRuns.push(textRun(' ', bodyStyle))
    captionRuns.push(...inlineFromText(fig.figure.caption.body, ctx, bodyStyle))
  }
  const caption = new Paragraph({
    ...(house ? { alignment: AlignmentType.CENTER } : {}),
    spacing: house ? { before: ptToTwips(4), after: ptToTwips(12) } : { after: 240 },
    children: captionRuns
  })

  return ctx.style.figureCaptionPosition === 'above' ? [caption, image] : [image, caption]
}

function blockNode(node: RootChild, ctx: DocxCtx): (Paragraph | Table)[] {
  switch (node.type) {
    case 'paragraph':
      return [
        new Paragraph({
          spacing: bodySpacing(ctx, {
            after: isHouseStyle(ctx.content.profile) ? ptToTwips(ctx.style.bodySpaceAfterPt) : 120
          }),
          children: inlineChildren(node.children, ctx, bodyRunStyle(ctx))
        })
      ]
    case 'heading': {
      if (isHouseStyle(ctx.content.profile)) {
        // Prose headings nest under the section heading they sit in, so a
        // markdown "##" inside a section is an H2, not another H1.
        return [headingParagraph(ctx, node.depth <= 1 ? 'A' : 'B', plainText(node.children))]
      }
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

/**
 * A section heading.
 *
 * Under a house style these are still Word's built-in Heading styles (so the
 * navigation pane, TOC and outline all work), but with the size and colour
 * stated explicitly — Word's default Heading 1 is 16 pt BLUE, which is the
 * single biggest reason an untouched Word export does not look like a
 * manuscript. docx-tools forces pure black at 13 pt for H1 and 11 pt below;
 * SUNA style does the same, and keeps `keepNext` so a heading never sits alone
 * at the foot of a page.
 */
function headingParagraph(
  ctx: DocxCtx,
  level: ManuscriptHeadingLevel,
  text: string,
  // Must be passed in rather than applied by the caller: `Paragraph` is a
  // class, so spreading one into a new Paragraph({...}) yields its internal
  // fields, not its options, and silently produces an EMPTY paragraph.
  opts: { pageBreakBefore?: boolean } = {}
): Paragraph {
  const house = isHouseStyle(ctx.content.profile)
  const breakBefore = opts.pageBreakBefore === true
  if (!house) {
    switch (level) {
      case 'A':
        return new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: breakBefore,
          children: [textRun(text)]
        })
      case 'B':
        return new Paragraph({
          heading: HeadingLevel.HEADING_2,
          pageBreakBefore: breakBefore,
          children: [textRun(text)]
        })
      case 'C-runin':
        // Run-in headings are page-typesetting (ADR-002 out of scope) —
        // rendered as their own bold+italic line rather than inline with the
        // following paragraph.
        return new Paragraph({
          pageBreakBefore: breakBefore,
          spacing: { before: 160, after: 40 },
          children: [textRun(text, { bold: true, italics: true })]
        })
    }
  }

  const isTop = level === 'A'
  const size = isTop ? sizeOf(ctx, 'heading1') : sizeOf(ctx, 'heading2')
  if (level === 'C-runin') {
    return new Paragraph({
      keepNext: true,
      pageBreakBefore: breakBefore,
      spacing: { before: ptToTwips(8), after: ptToTwips(4) },
      children: [textRun(text, { bold: true, italics: true, size, color: '000000' })]
    })
  }
  return new Paragraph({
    heading: isTop ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    keepNext: true,
    pageBreakBefore: breakBefore,
    spacing: { before: ptToTwips(isTop ? 12 : 8), after: ptToTwips(4) },
    children: [textRun(text, { bold: true, size, color: '000000' })]
  })
}

/**
 * Front matter, in docx-tools' order and shape (see resources/profiles/
 * suna.json's notes for what that is and where each value comes from):
 * title, authors, affiliations, corresponding line, highlights, then the
 * abstract — with the abstract LAST because docx-tools treats highlights as
 * front matter and the abstract as the first ordinary heading+body.
 *
 * Point sizes and spacing all come from the style, so a journal profile keeps
 * the older generic look and SUNA style gets the docx-tools one.
 */
function titlePageParagraphs(ctx: DocxCtx): Paragraph[] {
  const content = ctx.content
  const m = content.manuscript
  const style = ctx.style
  const house = isHouseStyle(content.profile)
  const out: Paragraph[] = []

  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: house ? ptToTwips(4) : 240 },
      children: texRuns(m.title, { bold: true, size: sizeOf(ctx, 'title') })
    })
  )

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
      spacing: { after: house ? ptToTwips(6) : 160 },
      children: authorRuns
    })
  )

  const affSize = sizeOf(ctx, 'affiliation')
  content.affiliations.ordered.forEach((a, i) => {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: house ? { before: 0, after: ptToTwips(1) } : { after: 20 },
        children: [textRun(String(i + 1), { superScript: true, size: affSize }), textRun(` ${a.text}`, { size: affSize })]
      })
    )
  })

  const corresponding = content.authors.authors
    .filter((a) => a.corresponding && a.email !== null)
    .map((a) => a.email)
    .filter((e): e is string => e !== null)
  if (corresponding.length > 0) {
    // docx-tools writes "* Corresponding author: <email>"; the legacy look
    // used "*e-mail: …". Both are the same information, so the style picks.
    const text = house
      ? `* Corresponding author: ${corresponding.join(', ')}`
      : `*e-mail: ${corresponding.join(', ')}`
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: house ? { after: ptToTwips(14) } : { before: 120, after: 200 },
        children: [textRun(text, { italics: true, size: affSize })]
      })
    )
  }

  if (m.highlights != null && m.highlights.length > 0) {
    out.push(
      new Paragraph({
        spacing: house ? { before: ptToTwips(10), after: ptToTwips(4) } : {},
        children: [textRun('Highlights', { bold: true, size: sizeOf(ctx, 'body') })]
      })
    )
    for (const h of m.highlights) {
      out.push(
        house
          ? // docx-tools sets its own bullet glyph with a hanging indent rather
            // than using a Word list, so the exported file has no numbering
            // definitions to renumber or inherit.
            new Paragraph({
              indent: { left: mmToTwips(6.35), hanging: mmToTwips(3.81) },
              spacing: { before: 0, after: ptToTwips(2) },
              children: [textRun('•  ', { size: sizeOf(ctx, 'caption') }), ...texRuns(h, { size: sizeOf(ctx, 'caption') })]
            })
          : new Paragraph({ bullet: { level: 0 }, children: texRuns(h) })
      )
    }
    if (house) out.push(new Paragraph({ spacing: { after: ptToTwips(6) }, children: [] }))
  }

  if (m.significance != null) {
    out.push(headingParagraph(ctx, 'A', 'Significance'))
    out.push(
      new Paragraph({
        spacing: bodySpacing(ctx, { after: house ? ptToTwips(style.bodySpaceAfterPt) : 200 }),
        children: texRuns(m.significance, { size: sizeOf(ctx, 'body') })
      })
    )
  }

  out.push(headingParagraph(ctx, 'A', 'Abstract'))
  out.push(
    new Paragraph({
      spacing: bodySpacing(ctx, { after: house ? ptToTwips(style.bodySpaceAfterPt) : 200 }),
      children: texRuns(m.abstract.content, { size: sizeOf(ctx, 'body') })
    })
  )

  return out
}

function tablesParagraphs(content: ExportContent, ctx: DocxCtx): Paragraph[] {
  if (content.tables.length === 0) return []
  const out: Paragraph[] = [headingParagraph(ctx, 'A', 'Tables')]
  for (const t of content.tables) out.push(tableCaptionParagraph(t, ctx))
  return out
}

/**
 * A table's caption. Same shape as a figure's under a house style — a bold
 * "Table N." followed by an italic body — but left-aligned and, per
 * `tableCaptionPosition`, written ABOVE the table it describes.
 */
function tableCaptionParagraph(t: ExportTableContent, ctx: DocxCtx): Paragraph {
  const house = isHouseStyle(ctx.content.profile)
  const capSize = sizeOf(ctx, 'caption')
  const bodyStyle: RunStyle = house ? { italics: true, size: capSize } : {}
  const runs: DocxInline[] = [
    textRun(`${t.label}. `, house ? { bold: true, size: capSize } : { bold: true }),
    ...inlineFromText(t.table.caption.title, ctx, bodyStyle)
  ]
  if (t.table.caption.body !== undefined && t.table.caption.body.trim() !== '') {
    runs.push(textRun(' ', bodyStyle))
    runs.push(...inlineFromText(t.table.caption.body, ctx, bodyStyle))
  }
  for (const note of t.table.footnotes) {
    runs.push(textRun(` [${note.mark}] ${note.text}`, { italics: true, size: house ? capSize : 18 }))
  }
  return new Paragraph({
    ...(house ? { keepNext: true } : {}),
    spacing: house ? { before: ptToTwips(4), after: ptToTwips(4) } : { after: 200 },
    children: runs
  })
}

function referencesParagraphs(ctx: DocxCtx): Paragraph[] {
  const content = ctx.content
  const house = isHouseStyle(content.profile)
  const numeric = isNumericCitationMode(content.profile)
  const refSize = sizeOf(ctx, 'reference')
  // References always start a fresh page, in both styles.
  const out: Paragraph[] = [
    house
      ? new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: true,
          keepNext: true,
          spacing: { before: ptToTwips(12), after: ptToTwips(4) },
          children: [textRun('References', { bold: true, size: sizeOf(ctx, 'heading1'), color: '000000' })]
        })
      : new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: true,
          children: [textRun('References')]
        })
  ]
  const hanging = mmToTwips(ctx.style.referenceHangingMm)
  for (const row of content.referenceRows) {
    const runs = formatReferenceRow(row, content.profile)
    const style: RunStyle = house ? { size: refSize } : {}
    const children: DocxInline[] = numeric ? [textRun(`${row.number}. `, { ...style, bold: true })] : []
    if (runs === null) {
      children.push(
        textRun(`@${row.key} — cited but not found in ${content.manuscript.bibliography}`, {
          ...style,
          color: 'AA0000'
        })
      )
    } else {
      children.push(...bibRunsToDocx(runs, style))
    }
    out.push(
      new Paragraph({
        indent: { left: hanging, hanging },
        spacing: house ? { after: ptToTwips(4) } : { after: 120 },
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

export async function buildDocxDocument(content: ExportContent, options: ExportOptions): Promise<Document> {
  const figureAssets = await buildFigureAssets(content)
  const style = documentStyleFor(content.profile)
  const ctx: DocxCtx = { content, doubleSpacing: options.doubleSpacing, figureAssets, style }
  const house = isHouseStyle(content.profile)

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
  bodyChildren.push(...tablesParagraphs(content, ctx))
  bodyChildren.push(...referencesParagraphs(ctx))

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
                  ...(house ? { size: sizeOf(ctx, 'footer'), font: style.fonts.body } : {})
                })
              ]
            })
          ]
        })
      }
    : undefined

  return new Document({
    title: content.manuscript.title,
    creator: '',
    description: '',
    // Font and size come from the style: journal profiles state no page setup
    // (ADR-002) and keep the generic 12 pt default, while a house style like
    // SUNA states all of it.
    styles: {
      default: {
        document: { run: { font: style.fonts.body, size: halfPoints(style.sizesPt.body) } }
      }
    },
    sections: [
      {
        properties: sectionProperties,
        footers,
        children: [...titlePageParagraphs(ctx), ...bodyChildren]
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
