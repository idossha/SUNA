import {
  contiguousRuns,
  makeAnchor,
  offsetsForRun,
  type PageText
} from '@suna/core'

/**
 * Turning a drag across a PDF page into anchors (ADR-008 M1).
 *
 * Split along the seam this repo already uses: everything above
 * `readPdfSelection` is pure and unit-tested from fixtures; the DOM walk below
 * it needs a live text layer and is covered by
 * `scripts/e2e/probes/pdf-quote.mjs` instead.
 *
 * The shape that matters is `runs`. A selection is NOT one span of text: in
 * real publisher PDFs the content order and the visual order disagree, so two
 * lines that look adjacent can have an unrelated item between them (measured
 * over six specimens: 0.5%-4.7% of adjacent body-line pairs). Storing the
 * selection as a single `[from, to)` would silently swallow that item, quote
 * text nobody selected, and — because the quote stays self-consistent —
 * re-anchor perfectly forever without anyone noticing. One anchor per
 * contiguous run of item indices is the fix.
 */

/** One contiguous piece of a selection, on one page. */
export interface SelectionRun {
  /** 1-based page number, as `data-page` carries it. */
  page: number
  /** First and last item index this run covers, inclusive. */
  itemStart: number
  itemEnd: number
  /** Offsets into that page's `PageText.text`. */
  from: number
  to: number
}

/** What one page contributes to a selection. */
export interface PageSelectionInput {
  page: number
  pageText: PageText
  /** Item indices the selection touches on this page; order and duplicates are fine. */
  itemIndices: readonly number[]
  /** Item the selection starts in; defaults to the lowest touched index. */
  startItem?: number
  /** Characters into `startItem`, when the selection STARTS on this page. */
  startWithin?: number
  /** Item the selection ends in; defaults to the highest touched index. */
  endItem?: number
  /** Characters into `endItem`, when the selection ENDS on this page. */
  endWithin?: number
}

/** A stored anchor: page hint plus the W3C quote/prefix/suffix triple. */
export interface PdfRunAnchor {
  page: number
  quote: string
  prefix: string
  suffix: string
}

/**
 * Contiguous runs for one page, with the two endpoints trimmed to where the
 * drag actually started and stopped. Everything between is covered whole.
 *
 * Empty items are skipped: pdf.js keeps them in `textDivs` but never puts them
 * in the DOM, so they can never be selected — yet including them would bridge
 * a real gap and merge two runs that must stay apart.
 */
export function runsForPage(input: PageSelectionInput): SelectionRun[] {
  const { page, pageText, itemIndices } = input
  const usable = itemIndices.filter((index) => {
    const start = pageText.itemStarts[index]
    const end = pageText.itemEnds[index]
    return start !== undefined && end !== undefined && end > start
  })
  if (usable.length === 0) return []

  const runs = contiguousRuns(usable)
  const firstIndex = input.startItem ?? Math.min(...usable)
  const lastIndex = input.endItem ?? Math.max(...usable)

  /** Offset `within` characters into item `index`, clamped to that item. */
  const insideItem = (index: number, within: number): number | null => {
    const start = pageText.itemStarts[index]
    const end = pageText.itemEnds[index]
    if (start === undefined || end === undefined) return null
    return Math.min(Math.max(start + within, start), end)
  }

  const out: SelectionRun[] = []
  for (const run of runs) {
    const span = offsetsForRun(pageText, run)
    if (span === null) continue
    let { from, to } = span

    // Trim the run that CONTAINS the boundary item, not the one that happens
    // to begin at it: the two coincide for any selection the DOM layer builds,
    // but keying on containment means contradictory input degrades to a
    // sensible span instead of an untrimmed one.
    if (input.startWithin !== undefined && run.start <= firstIndex && firstIndex <= run.end) {
      const at = insideItem(firstIndex, input.startWithin)
      if (at !== null) from = Math.max(from, at)
    }
    if (input.endWithin !== undefined && run.start <= lastIndex && lastIndex <= run.end) {
      const at = insideItem(lastIndex, input.endWithin)
      if (at !== null) to = Math.min(to, at)
    }

    if (to > from) out.push({ page, itemStart: run.start, itemEnd: run.end, from, to })
  }
  return out
}

/**
 * The quote a selection produces, runs joined by a single space.
 *
 * A join is a seam the reader can see: the runs came from places the PDF's
 * content stream separated, so gluing them tight would invent a word.
 */
export function quoteFromRuns(
  runs: readonly SelectionRun[],
  pageTexts: ReadonlyMap<number, PageText>
): string {
  const parts: string[] = []
  for (const run of runs) {
    const pageText = pageTexts.get(run.page)
    if (pageText === undefined) continue
    const slice = pageText.text.slice(run.from, run.to).trim()
    if (slice !== '') parts.push(slice)
  }
  return parts.join(' ')
}

/**
 * One W3C quote/prefix/suffix anchor per run, built by the SAME `makeAnchor`
 * the manuscript comments use — so an anchor made here and one made over a
 * markdown file resolve through identical code.
 */
export function anchorsFromRuns(
  runs: readonly SelectionRun[],
  pageTexts: ReadonlyMap<number, PageText>
): PdfRunAnchor[] {
  const out: PdfRunAnchor[] = []
  for (const run of runs) {
    const pageText = pageTexts.get(run.page)
    if (pageText === undefined) continue
    const anchor = makeAnchor(pageText.text, run.from, run.to)
    if (anchor.quote === '') continue
    out.push({ page: run.page, ...anchor })
  }
  return out
}

/**
 * The page label to cite. A declared label wins (`getPageLabels()` returns real
 * labels for Nature and Frontiers); otherwise the index plus a per-document
 * correction the user sets once, because that same call returns **null** for
 * arXiv and CVPR — exactly the preprints researchers read most.
 */
export function citedPageLabel(
  page: number,
  labels: readonly string[] | null,
  offset = 0
): string {
  const declared = labels?.[page - 1]
  if (declared !== undefined && declared.trim() !== '') return declared.trim()
  return String(page + offset)
}

/**
 * The passage with its citation, as plain prose someone would have typed.
 *
 * Not a blockquote and not a markdown block: the user's instruction was
 * "simply text as if we typed it. eg: xxx [@cite]." So the citation goes
 * inline, and sentence-final punctuation moves to AFTER the bracket, which is
 * where every style guide puts it and where a writer's own hand would leave
 * it. Paste it mid-paragraph and it reads as written rather than as pasted.
 *
 * A Pandoc-style locator (`[@key, p. 3]`) carries the page, which is what
 * SciMark already parses and what a reader needs to check the claim.
 */
export function quoteWithCitation(
  quote: string,
  citekey: string | null,
  pageLabel: string | null
): string {
  // Newlines inside a PDF quote are an artifact of the page, not the prose.
  const text = quote.replace(/\s*\n\s*/g, ' ').trim()
  if (citekey === null) return text

  const locator = pageLabel === null ? '' : `, p. ${pageLabel}`
  const citation = `[@${citekey}${locator}]`

  const trailing = /[.,;:!?]+$/.exec(text)
  if (trailing !== null) {
    return `${text.slice(0, trailing.index)} ${citation}${trailing[0]}`
  }
  return `${text} ${citation}`
}

// ---------------------------------------------------------------------------
// DOM side — needs a live text layer; exercised by probes/pdf-quote.mjs.
// ---------------------------------------------------------------------------

/** What `PdfTab` knows about one rendered page. */
export interface RenderedPage {
  page: number
  pageText: PageText
  /** `TextLayer.textDivs` — index-aligned with the items `pageText` was built from. */
  textDivs: readonly HTMLElement[]
  /**
   * The viewport this page was rendered at. Carried so a CSS-pixel rectangle
   * can be converted back to PDF user space for a native annotation —
   * `convertToPdfPoint` handles page rotation, which hand-rolled
   * `y = height - y` arithmetic silently gets wrong on a `/Rotate 90` figure
   * page.
   */
  viewport: PdfViewportLike
}

/** The part of pdf.js's `PageViewport` this module needs. */
export interface PdfViewportLike {
  width: number
  height: number
  scale: number
  rotation: number
  convertToPdfPoint: (x: number, y: number) => number[]
}

export interface PdfSelectionResult {
  runs: SelectionRun[]
  quote: string
  anchors: PdfRunAnchor[]
  /** Viewport rect of the selection, for placing the popover. */
  rect: DOMRect
}

function closestTextDiv(node: Node | null, index: Map<Element, RenderedPage>): Element | null {
  let current: Node | null = node
  while (current !== null) {
    if (current.nodeType === Node.ELEMENT_NODE && index.has(current as Element)) {
      return current as Element
    }
    current = current.parentNode
  }
  return null
}

/**
 * Characters into `span` that a Range boundary sits at.
 *
 * A Range boundary is NOT always a character offset: when the container is an
 * element — which is what `selectNodeContents`, a double-click, a triple-click
 * and Select All all produce — `offset` indexes CHILD NODES instead. Reading
 * it as a character count turned a whole selected line into the single
 * character "D", stored that as the quote, and anchored it forever.
 */
function withinSpan(
  span: Element,
  container: Node,
  offset: number,
  edge: 'start' | 'end'
): number {
  const full = span.textContent?.length ?? 0

  if (container.nodeType === Node.TEXT_NODE && span.contains(container)) {
    // Usually the span's only child, but sum any preceding text so a split
    // text node cannot silently shift the boundary.
    let seen = 0
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node === container) return Math.min(seen + offset, full)
      seen += node.textContent?.length ?? 0
    }
    return Math.min(offset, full)
  }

  if (container === span) return offset <= 0 ? 0 : full
  // An ancestor: the boundary is outside this span, so it covers it whole.
  return edge === 'start' ? 0 : full
}

/**
 * Read the live selection as runs and anchors, or null when nothing usable is
 * selected.
 *
 * The walk is bounded by the selection rather than by the page: a research
 * paper's text layer runs to thousands of spans, and testing every one against
 * the range on each mouseup would be visible. Only elements the caller
 * registered as text divs are accepted, which also excludes pdf.js's
 * `.markedContent` wrappers (`display: contents` spans that would otherwise
 * look exactly like content).
 */
export function readPdfSelection(
  selection: Selection | null,
  rendered: readonly RenderedPage[]
): PdfSelectionResult | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)

  const index = new Map<Element, RenderedPage>()
  const itemIndexOf = new Map<Element, number>()
  for (const entry of rendered) {
    entry.textDivs.forEach((div, i) => {
      index.set(div, entry)
      itemIndexOf.set(div, i)
    })
  }
  if (index.size === 0) return null

  const startDiv = closestTextDiv(range.startContainer, index)
  const endDiv = closestTextDiv(range.endContainer, index)
  if (startDiv === null && endDiv === null) return null

  const touched: Element[] = []
  if (startDiv !== null && startDiv === endDiv) {
    touched.push(startDiv)
  } else {
    const root = range.commonAncestorContainer
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    if (startDiv !== null) {
      walker.currentNode = startDiv
      touched.push(startDiv)
    }
    while (walker.nextNode()) {
      const element = walker.currentNode as Element
      if (index.has(element) && range.intersectsNode(element)) touched.push(element)
      if (element === endDiv) break
    }
  }
  if (touched.length === 0) return null

  // Group by page, preserving which endpoints are partial.
  const byPage = new Map<number, { entry: RenderedPage; indices: number[] }>()
  for (const div of touched) {
    const entry = index.get(div)
    const itemIndex = itemIndexOf.get(div)
    if (entry === undefined || itemIndex === undefined) continue
    const bucket = byPage.get(entry.page) ?? { entry, indices: [] }
    bucket.indices.push(itemIndex)
    byPage.set(entry.page, bucket)
  }

  const startPage = startDiv === null ? null : (index.get(startDiv)?.page ?? null)
  const endPage = endDiv === null ? null : (index.get(endDiv)?.page ?? null)

  const runs: SelectionRun[] = []
  const pageTexts = new Map<number, PageText>()
  for (const [page, bucket] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    pageTexts.set(page, bucket.entry.pageText)
    const startsHere = page === startPage && startDiv !== null
    const endsHere = page === endPage && endDiv !== null
    runs.push(
      ...runsForPage({
        page,
        pageText: bucket.entry.pageText,
        itemIndices: bucket.indices,
        startItem: startsHere ? itemIndexOf.get(startDiv) : undefined,
        startWithin: startsHere
          ? withinSpan(startDiv, range.startContainer, range.startOffset, 'start')
          : undefined,
        endItem: endsHere ? itemIndexOf.get(endDiv) : undefined,
        endWithin: endsHere
          ? withinSpan(endDiv, range.endContainer, range.endOffset, 'end')
          : undefined
      })
    )
  }
  if (runs.length === 0) return null

  const quote = quoteFromRuns(runs, pageTexts)
  if (quote === '') return null

  return { runs, quote, anchors: anchorsFromRuns(runs, pageTexts), rect: range.getBoundingClientRect() }
}
