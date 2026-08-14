import katex from 'katex'
import { parseSciMark, renderHtml } from '@suna/markdown'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'
import {
  type EditorSelection,
  type EditorState,
  type Extension,
  type Range,
  StateField
} from '@codemirror/state'

/* ---------------------------------------------------------------------------
   Span extraction.

   Block-level spans (display math, figure embeds) and AST-positioned inline
   spans (inline math, emphasis, headings) come from parseSciMark — remark
   gives those nodes exact source offsets, and using the parser keeps math
   inside code fences from rendering. Citations/crossrefs are re-scanned with
   the same regex grammar as @suna/markdown's parser because the parser copies
   the *whole surrounding text node's* position onto those nodes (their AST
   positions are not offset-exact); a raw-source scan with code/math ranges
   excluded is the robust choice for them.
   ------------------------------------------------------------------------- */

export type LiveSpan =
  | { kind: 'blockMath'; from: number; to: number; tex: string; label: string | undefined }
  | { kind: 'inlineMath'; from: number; to: number; tex: string }
  | { kind: 'figure'; from: number; to: number; figureId: string }
  /** GFM table block; `md` is the raw source, re-rendered by the widget. */
  | { kind: 'table'; from: number; to: number; md: string }
  | { kind: 'cite'; from: number; to: number; keys: string[] }
  | {
      kind: 'xref'
      from: number
      to: number
      refKind: string
      id: string
      suffix: string | undefined
    }

export interface MarkSpan {
  from: number
  to: number
  cls: string
}

export interface LineMark {
  /** Offset somewhere on the heading's first line (mapped to line start at build time). */
  at: number
  cls: string
}

export interface SpanIndex {
  /** blockMath | figure — rendered as block replace decorations (state field). */
  blocks: LiveSpan[]
  /** inlineMath | cite | xref — rendered as inline replace decorations (view plugin). */
  inline: LiveSpan[]
  /** Cheap mark decorations: strong/emphasis styling + dimmed syntax characters. */
  marks: MarkSpan[]
  /** Heading line classes (font-size/weight via CSS). */
  lines: LineMark[]
}

interface MdNode {
  type: string
  children?: MdNode[]
  value?: string
  meta?: string | null
  depth?: number
  figureId?: string
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } }
}

interface OffsetRange {
  from: number
  to: number
}

function spanOf(node: MdNode): OffsetRange | undefined {
  const from = node.position?.start.offset
  const to = node.position?.end.offset
  if (typeof from !== 'number' || typeof to !== 'number' || to <= from) return undefined
  return { from, to }
}

const EQ_LABEL = /^\{#(eq:[A-Za-z][\w:.-]*)\}$/

// Mirrors packages/markdown/src/parse.ts exactly so live chips match reading.
const SCAN = /\[@[^\]]*\]|@[A-Za-z][\w:.-]+(\{[^}]*\})?/g
const BRACKET_ITEM = /^@([A-Za-z][\w:.-]*)$/
const BARE = /^@([A-Za-z][\w:.-]+)(\{([^}]*)\})?/
const CROSSREF_KINDS = new Set(['fig', 'tbl', 'eq', 'sec'])
/**
 * Characters that may immediately precede a bare `@key`/`@kind:id{suffix}`
 * token for it to count as a citation/cross-reference start, beyond
 * start-of-string. Whitespace covers the common case; the opening brackets
 * let a parenthetical crossref — "(@fig:fig-spectrum{a})", the form the demo
 * manuscript's Results section uses throughout — be recognised even though
 * the character before the `@` is not whitespace. Mirrors PRECEDING_OK in
 * packages/markdown/src/parse.ts; the two scanners must stay in lockstep or
 * live chips and rendered output disagree.
 */
const PRECEDING_OK = /[\s([{]/

function trimTrailingPunctuation(key: string): string {
  let end = key.length
  while (end > 0 && /[.:-]/.test(key.charAt(end - 1))) end -= 1
  return key.slice(0, end)
}

function splitCrossRef(key: string): { kind: string; id: string } | undefined {
  const colon = key.indexOf(':')
  if (colon <= 0) return undefined
  const kind = key.slice(0, colon)
  const id = key.slice(colon + 1)
  if (!CROSSREF_KINDS.has(kind) || id.length === 0) return undefined
  return { kind, id }
}

function parseBracketedKeys(token: string): string[] | undefined {
  const items = token.slice(1, -1).split(';')
  const keys: string[] = []
  for (const item of items) {
    const match = BRACKET_ITEM.exec(item.trim())
    const key = match?.[1]
    if (key === undefined) return undefined
    keys.push(key)
  }
  return keys.length > 0 ? keys : undefined
}

function overlapsAny(ranges: readonly OffsetRange[], from: number, to: number): boolean {
  return ranges.some((range) => range.from < to && range.to > from)
}

function scanCitations(
  source: string,
  exclude: readonly OffsetRange[],
  out: LiveSpan[]
): void {
  SCAN.lastIndex = 0
  let match = SCAN.exec(source)
  while (match !== null) {
    const token = match[0]
    const start = match.index

    if (token.startsWith('[@')) {
      if (!overlapsAny(exclude, start, start + token.length)) {
        const keys = parseBracketedKeys(token)
        if (keys !== undefined) {
          out.push({ kind: 'cite', from: start, to: start + token.length, keys })
        }
      }
    } else if (start === 0 || PRECEDING_OK.test(source.charAt(start - 1))) {
      const bare = BARE.exec(token)
      const keyRaw = bare?.[1]
      const suffixGroup = bare?.[2]
      const suffixInner = bare?.[3]
      if (bare !== null && keyRaw !== undefined) {
        let produced: LiveSpan | undefined
        if (suffixGroup !== undefined && suffixInner !== undefined && suffixInner.length > 0) {
          const crossRef = splitCrossRef(keyRaw)
          if (crossRef !== undefined) {
            const consumed = 1 + keyRaw.length + suffixGroup.length
            produced = {
              kind: 'xref',
              from: start,
              to: start + consumed,
              refKind: crossRef.kind,
              id: crossRef.id,
              suffix: suffixInner
            }
          }
        }
        if (produced === undefined) {
          const key = trimTrailingPunctuation(keyRaw)
          if (key.length >= 2) {
            const consumed = 1 + key.length
            const crossRef = splitCrossRef(key)
            produced = crossRef
              ? {
                  kind: 'xref',
                  from: start,
                  to: start + consumed,
                  refKind: crossRef.kind,
                  id: crossRef.id,
                  suffix: undefined
                }
              : { kind: 'cite', from: start, to: start + consumed, keys: [key] }
          }
        }
        if (produced !== undefined && !overlapsAny(exclude, produced.from, produced.to)) {
          out.push(produced)
          SCAN.lastIndex = produced.to
        }
      }
    }
    match = SCAN.exec(source)
  }
}

/** Pure span extraction — exported for tests. */
export function extractSpans(source: string): SpanIndex {
  const blocks: LiveSpan[] = []
  const inline: LiveSpan[] = []
  const marks: MarkSpan[] = []
  const lines: LineMark[] = []
  const exclude: OffsetRange[] = []

  const visitNode = (node: MdNode): void => {
    const range = spanOf(node)
    switch (node.type) {
      case 'math': {
        if (range && node.value !== undefined) {
          const label = EQ_LABEL.exec(node.meta?.trim() ?? '')?.[1]
          blocks.push({ kind: 'blockMath', from: range.from, to: range.to, tex: node.value, label })
          exclude.push(range)
        }
        return
      }
      case 'inlineMath': {
        if (range && node.value !== undefined) {
          inline.push({ kind: 'inlineMath', from: range.from, to: range.to, tex: node.value })
          exclude.push(range)
        }
        return
      }
      case 'figureEmbed': {
        if (range && node.figureId !== undefined) {
          blocks.push({ kind: 'figure', from: range.from, to: range.to, figureId: node.figureId })
          exclude.push(range)
        }
        return
      }
      case 'table': {
        // Don't descend: cell content is re-rendered inside the widget, so
        // top-level spans for it would overlap this block replacement.
        if (range) {
          blocks.push({
            kind: 'table',
            from: range.from,
            to: range.to,
            md: source.slice(range.from, range.to)
          })
          exclude.push(range)
        }
        return
      }
      case 'code':
      case 'rawLatex':
      case 'inlineCode': {
        if (range) exclude.push(range)
        return
      }
      case 'heading': {
        if (range && typeof node.depth === 'number') {
          lines.push({ at: range.from, cls: `cm-lp-h${Math.min(node.depth, 4)}` })
          const hashEnd = range.from + node.depth
          const dimTo = source.charAt(hashEnd) === ' ' ? hashEnd + 1 : hashEnd
          marks.push({ from: range.from, to: dimTo, cls: 'cm-lp-syntax' })
        }
        break
      }
      case 'strong': {
        if (range && range.to - range.from > 4) {
          marks.push({ from: range.from, to: range.to, cls: 'cm-lp-strong' })
          marks.push({ from: range.from, to: range.from + 2, cls: 'cm-lp-syntax' })
          marks.push({ from: range.to - 2, to: range.to, cls: 'cm-lp-syntax' })
        }
        break
      }
      case 'emphasis': {
        if (range && range.to - range.from > 2) {
          marks.push({ from: range.from, to: range.to, cls: 'cm-lp-em' })
          marks.push({ from: range.from, to: range.from + 1, cls: 'cm-lp-syntax' })
          marks.push({ from: range.to - 1, to: range.to, cls: 'cm-lp-syntax' })
        }
        break
      }
      default:
        break
    }
    if (node.children !== undefined) {
      for (const child of node.children) visitNode(child)
    }
  }

  visitNode(parseSciMark(source) as unknown as MdNode)
  scanCitations(source, exclude, inline)

  const byFrom = (a: { from: number }, b: { from: number }): number => a.from - b.from
  blocks.sort(byFrom)
  inline.sort(byFrom)
  marks.sort(byFrom)
  lines.sort((a, b) => a.at - b.at)
  return { blocks, inline, marks, lines }
}

/* ---------------------------------------------------------------------------
   Widgets. KaTeX output is cached by source string and widgets implement eq()
   so CodeMirror reuses their DOM across rebuilds — no flicker while typing.
   ------------------------------------------------------------------------- */

const katexCache = new Map<string, string>()

function renderTex(tex: string, displayMode: boolean): string {
  const key = (displayMode ? 'D:' : 'I:') + tex
  const cached = katexCache.get(key)
  if (cached !== undefined) return cached
  const html = katex.renderToString(tex, { displayMode, throwOnError: false })
  if (katexCache.size > 400) katexCache.clear()
  katexCache.set(key, html)
  return html
}

class BlockMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly label: string | undefined
  ) {
    super()
  }
  override eq(other: BlockMathWidget): boolean {
    return other.tex === this.tex && other.label === this.label
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-lp-math-block'
    el.innerHTML = renderTex(this.tex, true)
    if (this.label !== undefined) {
      const chip = document.createElement('span')
      chip.className = 'cm-lp-eq-label'
      chip.textContent = `(${this.label})`
      el.appendChild(chip)
    }
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super()
  }
  override eq(other: InlineMathWidget): boolean {
    return other.tex === this.tex
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-lp-math-inline'
    el.innerHTML = renderTex(this.tex, false)
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

class CiteWidget extends WidgetType {
  readonly label: string
  constructor(keys: readonly string[]) {
    super()
    this.label = `[${keys.join('; ')}]`
  }
  override eq(other: CiteWidget): boolean {
    return other.label === this.label
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('sup')
    el.className = 'cm-lp-cite'
    el.textContent = this.label
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

class XrefWidget extends WidgetType {
  constructor(
    readonly refKind: string,
    readonly id: string,
    readonly suffix: string | undefined
  ) {
    super()
  }
  override eq(other: XrefWidget): boolean {
    return other.refKind === this.refKind && other.id === this.id && other.suffix === this.suffix
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-lp-xref'
    el.textContent = `${this.refKind}:${this.id}`
    if (this.suffix !== undefined) el.title = `panel ${this.suffix}`
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

/**
 * Tables go through the shared @suna/markdown pipeline rather than a local
 * HTML builder so citations, crossrefs and math inside cells render exactly
 * as they do in the reading view. Cached by source like the KaTeX output.
 */
const tableHtmlCache = new Map<string, string>()

export function renderTableHtml(md: string): string {
  const cached = tableHtmlCache.get(md)
  if (cached !== undefined) return cached
  const html = renderHtml(parseSciMark(md))
  if (tableHtmlCache.size > 200) tableHtmlCache.clear()
  tableHtmlCache.set(md, html)
  return html
}

class TableWidget extends WidgetType {
  constructor(readonly md: string) {
    super()
  }
  override eq(other: TableWidget): boolean {
    return other.md === this.md
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-lp-table'
    el.innerHTML = renderTableHtml(this.md)
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

class FigureWidget extends WidgetType {
  constructor(readonly figureId: string) {
    super()
  }
  override eq(other: FigureWidget): boolean {
    return other.figureId === this.figureId
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-lp-figure'
    el.textContent = `fig:${this.figureId}`
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

function decorationFor(span: LiveSpan): Decoration {
  switch (span.kind) {
    case 'blockMath':
      return Decoration.replace({ widget: new BlockMathWidget(span.tex, span.label), block: true })
    case 'figure':
      return Decoration.replace({ widget: new FigureWidget(span.figureId), block: true })
    case 'table':
      return Decoration.replace({ widget: new TableWidget(span.md), block: true })
    case 'inlineMath':
      return Decoration.replace({ widget: new InlineMathWidget(span.tex) })
    case 'cite':
      return Decoration.replace({ widget: new CiteWidget(span.keys) })
    case 'xref':
      return Decoration.replace({ widget: new XrefWidget(span.refKind, span.id, span.suffix) })
  }
}

/* ---------------------------------------------------------------------------
   Decoration plumbing. A rendered range whose raw source the selection/cursor
   touches is *not* decorated — it reveals its source — and re-renders once
   the selection leaves. Block decorations must come from a StateField (CM
   forbids block decorations from view plugins); inline decorations come from
   a ViewPlugin working over view.visibleRanges.
   ------------------------------------------------------------------------- */

function selectionTouches(selection: EditorSelection, from: number, to: number): boolean {
  return selection.ranges.some((range) => range.to >= from && range.from <= to)
}

interface LiveState {
  index: SpanIndex
  blockDeco: DecorationSet
}

function buildBlockDeco(index: SpanIndex, state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const span of index.blocks) {
    if (span.to > state.doc.length) continue
    if (selectionTouches(state.selection, span.from, span.to)) continue
    ranges.push(decorationFor(span).range(span.from, span.to))
  }
  return Decoration.set(ranges, true)
}

const liveField = StateField.define<LiveState>({
  create(state) {
    const index = extractSpans(state.doc.toString())
    return { index, blockDeco: buildBlockDeco(index, state) }
  },
  update(value, tr) {
    if (!tr.docChanged && tr.selection === undefined) return value
    const index = tr.docChanged ? extractSpans(tr.state.doc.toString()) : value.index
    return { index, blockDeco: buildBlockDeco(index, tr.state) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.blockDeco)
})

function buildInlineDeco(view: EditorView): DecorationSet {
  const { index } = view.state.field(liveField)
  const selection = view.state.selection
  const doc = view.state.doc
  const ranges: Range<Decoration>[] = []
  const seen = new Set<object>()

  for (const { from, to } of view.visibleRanges) {
    for (const span of index.inline) {
      if (span.to < from || span.from > to || span.to > doc.length) continue
      if (seen.has(span)) continue
      seen.add(span)
      if (selectionTouches(selection, span.from, span.to)) continue
      ranges.push(decorationFor(span).range(span.from, span.to))
    }
    for (const mark of index.marks) {
      if (mark.to < from || mark.from > to || mark.to > doc.length) continue
      if (seen.has(mark)) continue
      seen.add(mark)
      ranges.push(Decoration.mark({ class: mark.cls }).range(mark.from, mark.to))
    }
    for (const line of index.lines) {
      if (line.at < from || line.at > to || line.at > doc.length) continue
      if (seen.has(line)) continue
      seen.add(line)
      const lineStart = doc.lineAt(line.at).from
      ranges.push(Decoration.line({ class: line.cls }).range(lineStart))
    }
  }
  return Decoration.set(ranges, true)
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInlineDeco(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildInlineDeco(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

/** Obsidian-style live preview: editable document with rendered decorations. */
export function livePreview(): Extension {
  return [liveField, inlinePlugin]
}
