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
  Facet,
  type Range,
  StateField
} from '@codemirror/state'
import {
  cachedAsset,
  figureSvgPath,
  loadAsset,
  resolveImageUrl,
  type FigureAsset
} from './figureAssets'

/**
 * Where the editor's images live. Carried in a facet rather than closed over
 * by `livePreview()` because the decoration state field is module-level and
 * shared — the facet is what lets one editor resolve figures against its own
 * project without every editor needing its own field instance.
 */
export interface LivePreviewConfig {
  /** Project root, for `figures/<id>/figure.svg`. Null outside a project. */
  rootDir: string | null
  /** Absolute path of the edited file, for resolving relative image urls. */
  filePath: string | null
}

const NO_PATHS: LivePreviewConfig = { rootDir: null, filePath: null }

export const livePreviewConfigFacet = Facet.define<LivePreviewConfig, LivePreviewConfig>({
  combine: (values) => values[0] ?? NO_PATHS
})

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

   The AST is also what makes backslash-escapes and code-fence contents safe
   for free: remark resolves `\*` to a literal `*` inside the enclosing text
   node's *value* without emitting an emphasis node, and it never descends
   into code/inlineCode content looking for nested markup — so those cases
   never produce a span to hide in the first place. Nothing hides them; the
   raw source renders through untouched.
   ------------------------------------------------------------------------- */

export type LiveSpan =
  | { kind: 'blockMath'; from: number; to: number; tex: string; label: string | undefined }
  | { kind: 'inlineMath'; from: number; to: number; tex: string }
  | { kind: 'figure'; from: number; to: number; figureId: string }
  /** A markdown image written in the prose: ![alt](url). */
  | { kind: 'image'; from: number; to: number; url: string; alt: string }
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
  /**
   * Zero-width syntax hide: [from,to) is the literal source run that
   * disappears (a `##␣` prefix, a pair of `**`/`*`/`~~`/backtick delimiters,
   * a link's brackets+parens+URL, a blockquote's `>` run). [revealFrom,
   * revealTo) is the *separate*, usually larger, range the selection has to
   * intersect for the hide to lift — the enclosing formatting node's full
   * span for inline marks (so a cursor anywhere in "**bold**" shows both
   * `**` runs at once), or the whole physical line for headings/list
   * markers/blockquotes.
   */
  | { kind: 'hide'; from: number; to: number; revealFrom: number; revealTo: number }
  /** A bullet list marker ('-'/'*'/'+' + following space), replaced by a glyph widget. */
  | { kind: 'bullet'; from: number; to: number; revealFrom: number; revealTo: number }

export interface MarkSpan {
  from: number
  to: number
  cls: string
}

export interface LineMark {
  /** Offset somewhere on the marked line (mapped to line start at build time). */
  at: number
  cls: string
}

export interface SpanIndex {
  /** blockMath | figure | table — rendered as block replace decorations (state field). */
  blocks: LiveSpan[]
  /**
   * inlineMath | cite | xref | hide | bullet — rendered as inline replace
   * decorations (view plugin). Each entry is reveal-gated: skipped for the
   * render whenever the selection intersects its reveal range (its own
   * [from,to) for math/cite/xref, a separate wider range for hide/bullet).
   */
  inline: LiveSpan[]
  /**
   * Non-hiding style marks over *visible* text: bold/italic/strikethrough
   * weight, inline-code and link styling. Never reveal-gated — nothing here
   * hides source, so there is nothing to reveal.
   */
  marks: MarkSpan[]
  /** Line classes (heading size/weight, blockquote bar). Never reveal-gated. */
  lines: LineMark[]
}

interface MdNode {
  type: string
  children?: MdNode[]
  value?: string
  meta?: string | null
  depth?: number
  figureId?: string
  url?: string
  alt?: string | null
  ordered?: boolean | null
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

/** The physical source line containing `offset` — scans outward to the nearest '\n' on each side. */
function lineBoundsAt(source: string, offset: number): OffsetRange {
  let start = offset
  while (start > 0 && source.charCodeAt(start - 1) !== 10) start -= 1
  let end = offset
  while (end < source.length && source.charCodeAt(end) !== 10) end += 1
  return { from: start, to: end }
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

/** Leading blockquote marker run for one physical line: up to 3 spaces of
 *  indentation, then one or more `>` (each optionally followed by a single
 *  space), consumed greedily — so a doubly-nested "> > text" hides both
 *  `>` levels in one shot. Anchored to the start of the sliced line. */
const QUOTE_MARKER = /^(?: {0,3}>[ \t]?)+/

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
  /** De-dupes blockquote marker-hiding by line start: nested blockquote
   *  nodes share physical lines with their ancestor, and the ancestor is
   *  visited first (pre-order), consuming the *whole* nested `>` run for
   *  that line via QUOTE_MARKER's `+`. Without this, the descendant would
   *  try to hide the same characters again. */
  const seenQuoteLines = new Set<number>()

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
      case 'image': {
        // Rendered as a block: an image sitting inside a line of prose is
        // rare in a manuscript, and a block widget is what lets it size to
        // the measure instead of the line height.
        if (range && node.url !== undefined) {
          blocks.push({
            kind: 'image',
            from: range.from,
            to: range.to,
            url: node.url,
            alt: node.alt ?? ''
          })
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
      case 'rawLatex': {
        if (range) exclude.push(range)
        return
      }
      case 'inlineCode': {
        // Keep the code styling, hide only the backtick fence. Fence length
        // is read straight off the source (1+ backticks) rather than
        // assumed, since CommonMark lets a fence widen to `` `` etc. when
        // the content itself contains a backtick.
        if (range) {
          exclude.push(range)
          let openLen = 0
          while (source.charAt(range.from + openLen) === '`') openLen += 1
          const closeStart = range.to - openLen
          if (openLen > 0 && closeStart > range.from + openLen) {
            marks.push({ from: range.from + openLen, to: closeStart, cls: 'cm-lp-code' })
            inline.push({
              kind: 'hide',
              from: range.from,
              to: range.from + openLen,
              revealFrom: range.from,
              revealTo: range.to
            })
            inline.push({
              kind: 'hide',
              from: closeStart,
              to: range.to,
              revealFrom: range.from,
              revealTo: range.to
            })
          }
        }
        return
      }
      case 'heading': {
        if (range && typeof node.depth === 'number') {
          lines.push({ at: range.from, cls: `cm-lp-h${Math.min(node.depth, 4)}` })
          const hashEnd = range.from + node.depth
          const dimTo = source.charAt(hashEnd) === ' ' ? hashEnd + 1 : hashEnd
          const line = lineBoundsAt(source, range.from)
          inline.push({
            kind: 'hide',
            from: range.from,
            to: dimTo,
            revealFrom: line.from,
            revealTo: line.to
          })
        }
        break
      }
      case 'strong': {
        if (range && range.to - range.from > 4) {
          marks.push({ from: range.from, to: range.to, cls: 'cm-lp-strong' })
          inline.push({
            kind: 'hide',
            from: range.from,
            to: range.from + 2,
            revealFrom: range.from,
            revealTo: range.to
          })
          inline.push({
            kind: 'hide',
            from: range.to - 2,
            to: range.to,
            revealFrom: range.from,
            revealTo: range.to
          })
        }
        break
      }
      case 'emphasis': {
        if (range && range.to - range.from > 2) {
          marks.push({ from: range.from, to: range.to, cls: 'cm-lp-em' })
          inline.push({
            kind: 'hide',
            from: range.from,
            to: range.from + 1,
            revealFrom: range.from,
            revealTo: range.to
          })
          inline.push({
            kind: 'hide',
            from: range.to - 1,
            to: range.to,
            revealFrom: range.from,
            revealTo: range.to
          })
        }
        break
      }
      case 'delete': {
        // GFM strikethrough (~~text~~), always a 2-char delimiter each side.
        if (range && range.to - range.from > 4) {
          marks.push({ from: range.from, to: range.to, cls: 'cm-lp-strike' })
          inline.push({
            kind: 'hide',
            from: range.from,
            to: range.from + 2,
            revealFrom: range.from,
            revealTo: range.to
          })
          inline.push({
            kind: 'hide',
            from: range.to - 2,
            to: range.to,
            revealFrom: range.from,
            revealTo: range.to
          })
        }
        break
      }
      case 'link': {
        // Only "[text](url)" inline links transform. Autolinks ("<url>")
        // are also mdast 'link' nodes but start with '<', not '[' — spec
        // says bare autolinks stay as-is, so those fall through untouched.
        if (range && source.charAt(range.from) === '[') {
          // Excluded from citation scanning unconditionally (not just when
          // the hide/mark below fires): a literal "[@key]" immediately
          // followed by "(url)" parses as a link, and the raw-source
          // citation scanner would otherwise also match its bracket form,
          // producing an overlapping decoration.
          exclude.push(range)
          const children = node.children
          const first = children?.[0]
          const last = children !== undefined && children.length > 0 ? children[children.length - 1] : undefined
          const firstRange = first ? spanOf(first) : undefined
          const lastRange = last ? spanOf(last) : undefined
          if (
            firstRange &&
            lastRange &&
            firstRange.from > range.from &&
            lastRange.to < range.to &&
            lastRange.to > firstRange.from
          ) {
            marks.push({ from: firstRange.from, to: lastRange.to, cls: 'cm-lp-link' })
            inline.push({
              kind: 'hide',
              from: range.from,
              to: firstRange.from,
              revealFrom: range.from,
              revealTo: range.to
            })
            inline.push({
              kind: 'hide',
              from: lastRange.to,
              to: range.to,
              revealFrom: range.from,
              revealTo: range.to
            })
          }
        }
        break
      }
      case 'list': {
        // Ordered-list numbers stay literal — only unordered markers get a
        // bullet widget. Marker width comes from the gap between the item's
        // own start and its first child's start, which remark already
        // computed exactly (indentation, marker char, following space all
        // accounted for) — no need to re-derive it with a regex.
        if (range && node.ordered !== true && node.children !== undefined) {
          for (const item of node.children) {
            const itemRange = spanOf(item)
            const firstChild = item.children?.[0]
            const contentRange = firstChild ? spanOf(firstChild) : undefined
            if (itemRange && contentRange && contentRange.from > itemRange.from) {
              const line = lineBoundsAt(source, itemRange.from)
              inline.push({
                kind: 'bullet',
                from: itemRange.from,
                to: contentRange.from,
                revealFrom: line.from,
                revealTo: line.to
              })
            }
          }
        }
        break
      }
      case 'blockquote': {
        if (range) {
          let cursor = lineBoundsAt(source, range.from).from
          while (cursor < range.to) {
            const bounds = lineBoundsAt(source, cursor)
            if (!seenQuoteLines.has(bounds.from)) {
              seenQuoteLines.add(bounds.from)
              const markerMatch = QUOTE_MARKER.exec(source.slice(bounds.from, bounds.to))
              if (markerMatch !== null && markerMatch[0].length > 0) {
                inline.push({
                  kind: 'hide',
                  from: bounds.from,
                  to: bounds.from + markerMatch[0].length,
                  revealFrom: bounds.from,
                  revealTo: bounds.to
                })
              }
              lines.push({ at: bounds.from, cls: 'cm-lp-quote' })
            }
            if (bounds.to >= range.to) break
            cursor = bounds.to + 1
          }
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

/**
 * Paint a loaded asset into `host`, or an explanatory placeholder when it
 * could not be read. Shared by the figure-embed and markdown-image widgets so
 * both fail the same, visible way instead of one of them going blank.
 */
function paintAsset(host: HTMLElement, asset: FigureAsset, fallbackLabel: string): void {
  host.replaceChildren()
  if (asset.kind === 'svg') {
    // The figure IS an SVG document (the canvas edits its DOM directly), so
    // inlining keeps it crisp at any zoom instead of rasterizing it.
    const holder = document.createElement('div')
    holder.className = 'cm-lp-figure__svg'
    holder.innerHTML = asset.svg
    // A figure authored at mm scale carries width/height in mm; drop them so
    // it scales to the measure, keeping viewBox to preserve aspect ratio.
    const svg = holder.querySelector('svg')
    if (svg !== null) {
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    }
    host.appendChild(holder)
    return
  }
  if (asset.kind === 'raster') {
    const img = document.createElement('img')
    img.className = 'cm-lp-figure__img'
    img.src = asset.dataUri
    img.alt = fallbackLabel
    host.appendChild(img)
    return
  }
  const missing = document.createElement('div')
  missing.className = 'cm-lp-figure__missing'
  missing.textContent = `${fallbackLabel} — ${asset.reason}`
  host.appendChild(missing)
}

/**
 * `![[fig:id]]` — renders the figure's own SVG from
 * `<rootDir>/figures/<id>/figure.svg`, with its id beneath as a caption line.
 *
 * The asset is loaded asynchronously (see figureAssets.ts) and painted into
 * the element this returns, because CodeMirror builds widgets synchronously.
 * Without a rootDir — a loose markdown file opened outside a project — it
 * falls back to naming the figure, which is what this widget used to do for
 * every case.
 */
class FigureWidget extends WidgetType {
  constructor(
    readonly figureId: string,
    readonly rootDir: string | null
  ) {
    super()
  }
  override eq(other: FigureWidget): boolean {
    return other.figureId === this.figureId && other.rootDir === this.rootDir
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('figure')
    el.className = 'cm-lp-figure'
    el.dataset['sunaFigureId'] = this.figureId

    const body = document.createElement('div')
    body.className = 'cm-lp-figure__body'
    el.appendChild(body)

    const caption = document.createElement('figcaption')
    caption.className = 'cm-lp-figure__caption'
    caption.textContent = `fig:${this.figureId}`
    el.appendChild(caption)

    if (this.rootDir === null) {
      body.textContent = `fig:${this.figureId}`
      return el
    }

    const path = figureSvgPath(this.rootDir, this.figureId)
    const cached = cachedAsset(path)
    if (cached !== undefined) {
      paintAsset(body, cached, `fig:${this.figureId}`)
    } else {
      body.className = 'cm-lp-figure__body cm-lp-figure__body--loading'
      body.textContent = `fig:${this.figureId}`
      void loadAsset(path).then((asset) => {
        // The widget may have been replaced while the read was in flight.
        if (!body.isConnected) return
        body.className = 'cm-lp-figure__body'
        paintAsset(body, asset, `fig:${this.figureId}`)
      })
    }
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

/**
 * A markdown image — `![alt](path)` — written directly in the prose, as
 * opposed to a managed figure. Resolved relative to the file that contains
 * it. Remote urls are named rather than fetched: the renderer's CSP blocks
 * external hosts, so a silent broken image would be the alternative.
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly filePath: string | null
  ) {
    super()
  }
  override eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt && other.filePath === this.filePath
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('figure')
    el.className = 'cm-lp-figure cm-lp-image'
    const body = document.createElement('div')
    body.className = 'cm-lp-figure__body'
    el.appendChild(body)
    if (this.alt !== '') {
      const caption = document.createElement('figcaption')
      caption.className = 'cm-lp-figure__caption'
      caption.textContent = this.alt
      el.appendChild(caption)
    }

    const label = this.alt !== '' ? this.alt : this.url
    const resolved = this.filePath === null ? null : resolveImageUrl(this.url, this.filePath)
    if (resolved === null) {
      paintAsset(body, { kind: 'missing', reason: `cannot resolve ${this.url}` }, label)
      return el
    }
    const cached = cachedAsset(resolved)
    if (cached !== undefined) {
      paintAsset(body, cached, label)
    } else {
      body.textContent = label
      void loadAsset(resolved).then((asset) => {
        if (!body.isConnected) return
        paintAsset(body, asset, label)
      })
    }
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

/** Fixed-width glyph standing in for a hidden '-'/'*'/'+' + following space.
 *  Stateless (no eq() fields to compare beyond the class default identity
 *  match), so a single shared instance covers every bullet in the doc. */
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-lp-bullet'
    el.textContent = '•'
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

const bulletWidget = new BulletWidget()
/** Shared zero-width replace — safe to reuse across ranges (CodeMirror decorations are position-independent specs). */
const hideDecoration = Decoration.replace({})
const bulletDecoration = Decoration.replace({ widget: bulletWidget })

function decorationFor(span: LiveSpan, config: LivePreviewConfig): Decoration {
  switch (span.kind) {
    case 'blockMath':
      return Decoration.replace({ widget: new BlockMathWidget(span.tex, span.label), block: true })
    case 'figure':
      return Decoration.replace({
        widget: new FigureWidget(span.figureId, config.rootDir),
        block: true
      })
    case 'image':
      return Decoration.replace({
        widget: new ImageWidget(span.url, span.alt, config.filePath),
        block: true
      })
    case 'table':
      return Decoration.replace({ widget: new TableWidget(span.md), block: true })
    case 'inlineMath':
      return Decoration.replace({ widget: new InlineMathWidget(span.tex) })
    case 'cite':
      return Decoration.replace({ widget: new CiteWidget(span.keys) })
    case 'xref':
      return Decoration.replace({ widget: new XrefWidget(span.refKind, span.id, span.suffix) })
    case 'hide':
      return hideDecoration
    case 'bullet':
      return bulletDecoration
  }
}

/** The selection range that must be avoided for a span's hide to apply —
 *  its own bounds for math/cite/xref, the wider carried reveal range for
 *  hide/bullet spans (see the LiveSpan doc comment). */
function revealRangeFor(span: LiveSpan): OffsetRange {
  if (span.kind === 'hide' || span.kind === 'bullet') {
    return { from: span.revealFrom, to: span.revealTo }
  }
  return { from: span.from, to: span.to }
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
    ranges.push(decorationFor(span, state.facet(livePreviewConfigFacet)).range(span.from, span.to))
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

/**
 * Pure decoration builder — the "plugin's decoration builder" tests drive
 * directly against a headless EditorState (this repo has no DOM test
 * environment; see editor/keymap.test.ts). Takes visibleRanges explicitly
 * rather than an EditorView so a test can pass `[{ from: 0, to: doc.length }]`
 * without constructing a real view.
 */
export function buildInlineDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[]
): DecorationSet {
  const { index } = state.field(liveField)
  const selection = state.selection
  const doc = state.doc
  const ranges: Range<Decoration>[] = []
  const seen = new Set<object>()

  for (const { from, to } of visibleRanges) {
    for (const span of index.inline) {
      if (span.to < from || span.from > to || span.to > doc.length) continue
      if (seen.has(span)) continue
      seen.add(span)
      const reveal = revealRangeFor(span)
      if (selectionTouches(selection, reveal.from, reveal.to)) continue
      ranges.push(decorationFor(span, state.facet(livePreviewConfigFacet)).range(span.from, span.to))
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
      this.decorations = buildInlineDecorations(view.state, view.visibleRanges)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildInlineDecorations(update.view.state, update.view.visibleRanges)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

/** Obsidian-style live preview: editable document with rendered decorations. */
export function livePreview(config: LivePreviewConfig = NO_PATHS): Extension {
  return [livePreviewConfigFacet.of(config), liveField, inlinePlugin]
}
