import { itemAtOffset, type PageText } from '@suna/core'
import type { RenderedPage } from './pdfSelection'

/**
 * Where a stored quote sits on a rendered page (ADR-008 M2).
 *
 * ## Deviation from ADR-008, deliberately and with a measurement
 *
 * The ADR specifies rectangles reconstructed in PDF user space from each
 * item's `transform`/`width`/`height`, because `Range.getClientRects()` was
 * expected to drift: the text layer's spans are fitted with
 * `scaleX(var(--scale-x))` and were an approximation of the glyph boxes.
 *
 * That drift was a symptom of the M0 bug, not of the DOM. With
 * `--total-scale-factor` tracking the render scale and pdf.js's own span
 * sizing in place, the probe measures the canvas and text layer agreeing to
 * **0 px** at fit-width and at zoom, and a Range over a span reporting exactly
 * the span's own width (916.25 px against 916.25 px). pdf.js computes
 * `--scale-x` precisely so the span covers the glyphs the canvas drew.
 *
 * So the DOM is the more accurate source here, not the less, and it is also
 * the only one that gets partial items, multi-line runs and right-to-left
 * text right without reimplementing text shaping. Reconstructing user space
 * would additionally need per-character boxes, which pdf.js does not expose —
 * partial items would have to interpolate, which the DOM does not.
 *
 * The cost is honest and small: rectangles exist only for pages whose text
 * layer has rendered. The ADR already accepts that highlights arrive a beat
 * after the page.
 */

/** A highlight rectangle in page-relative CSS pixels. */
export interface HighlightRect {
  left: number
  top: number
  width: number
  height: number
}

/** Merge rects that describe the same line, and drop degenerate ones. */
function tidy(rects: readonly HighlightRect[]): HighlightRect[] {
  return rects
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .sort((a, b) => a.top - b.top || a.left - b.left)
}

/**
 * Build a DOM Range covering `[from, to)` of a page's text.
 *
 * Endpoints are mapped back through the SAME `PageText` the anchor was built
 * against, so the range covers the characters the quote actually named rather
 * than a re-derived guess.
 *
 * Returns null when either endpoint falls in a seam between items — the space
 * a line break became belongs to no span and so has no geometry — or when the
 * page's text layer is not rendered.
 */
export function rangeForOffsets(
  entry: RenderedPage,
  from: number,
  to: number
): Range | null {
  const { pageText, textDivs } = entry
  const start = itemAtOffset(pageText, from)
  const end = itemAtOffset(pageText, Math.max(from, to))
  if (start === null || end === null) return null

  const startDiv = textDivs[start.index]
  const endDiv = textDivs[end.index]
  if (startDiv === undefined || endDiv === undefined) return null
  const startText = startDiv.firstChild
  const endText = endDiv.firstChild
  if (startText === null || endText === null) return null

  const range = document.createRange()
  try {
    range.setStart(startText, Math.min(start.within, startText.textContent?.length ?? 0))
    range.setEnd(endText, Math.min(end.within, endText.textContent?.length ?? 0))
  } catch {
    return null
  }
  return range.collapsed ? null : range
}

/**
 * Rectangles for `[from, to)` on a page, relative to that page's own box.
 *
 * Page-relative rather than viewport-relative on purpose: the highlight div is
 * absolutely positioned inside `.pdfview__page`, so these survive scrolling
 * without recomputation and only have to be rebuilt when the scale changes.
 */
export function rectsForOffsets(
  entry: RenderedPage,
  pageEl: HTMLElement,
  from: number,
  to: number
): HighlightRect[] {
  const range = rangeForOffsets(entry, from, to)
  if (range === null) return []
  const origin = pageEl.getBoundingClientRect()
  const out: HighlightRect[] = []
  for (const rect of range.getClientRects()) {
    out.push({
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      width: rect.width,
      height: rect.height
    })
  }
  return tidy(out)
}

/**
 * Locate a stored quote on a page and return where it sits.
 *
 * Resolution is the caller's job (it needs the ±2-page and whole-document
 * tiers); this answers only "given that the quote is on THIS page's text, at
 * this offset, where is it on screen".
 */
export function rectsForQuoteAt(
  entry: RenderedPage,
  pageEl: HTMLElement,
  offsets: { from: number; to: number }
): HighlightRect[] {
  return rectsForOffsets(entry, pageEl, offsets.from, offsets.to)
}

/**
 * The topmost note whose painted rectangle contains a point, in page-relative
 * CSS pixels. Later entries win, so a highlight drawn over an earlier one is
 * the one you get.
 *
 * Hit-testing exists because the highlights CANNOT receive the click
 * themselves. They are painted under the text layer on purpose — a highlighted
 * passage must still be selectable — and pdf.js's own span rules carry
 * `z-index: 1`, so every pointer event lands on a text span. Measured:
 * `elementFromPoint` at the centre of a highlight returns a SPAN, never the
 * rect. So the page hit-tests the point against the rectangles it already has,
 * rather than trying to win a stacking fight it should lose.
 */
export function noteAtPoint(
  rectsByNote: ReadonlyMap<string, ReadonlyMap<number, readonly HighlightRect[]>>,
  page: number,
  x: number,
  y: number
): { noteId: string; rect: HighlightRect } | null {
  let found: { noteId: string; rect: HighlightRect } | null = null
  for (const [noteId, byPage] of rectsByNote) {
    for (const rect of byPage.get(page) ?? []) {
      if (
        x >= rect.left &&
        x <= rect.left + rect.width &&
        y >= rect.top &&
        y <= rect.top + rect.height
      ) {
        found = { noteId, rect }
      }
    }
  }
  return found
}

/** Do two rectangles overlap enough to be the same highlight? */
export function overlaps(a: HighlightRect, b: HighlightRect, slack = 2): boolean {
  return (
    a.left < b.left + b.width + slack &&
    b.left < a.left + a.width + slack &&
    a.top < b.top + b.height + slack &&
    b.top < a.top + a.height + slack
  )
}

/**
 * Every occurrence of `quote` in a page's text, as `[from, to)` pairs.
 * Used by the re-anchor sweep to tell "found once" from "found four times",
 * which is the difference between anchoring and refusing to guess.
 */
export function occurrencesOf(pageText: PageText, quote: string): { from: number; to: number }[] {
  if (quote === '') return []
  const out: { from: number; to: number }[] = []
  let at = pageText.text.indexOf(quote)
  while (at !== -1) {
    out.push({ from: at, to: at + quote.length })
    at = pageText.text.indexOf(quote, at + quote.length)
  }
  return out
}

/** A highlight that is in the PDF file but not in SUNA's sidecar. */
export interface ForeignHighlight {
  /** Page-relative CSS-pixel rectangles, one per quad. */
  rects: HighlightRect[]
  /** `/C` as CSS, when the annotation declares one. */
  color: string | null
  /** `/Contents` — the note text Preview or Acrobat attached. */
  contents: string | null
  /** `/T` — who made it. */
  author: string | null
}

/** The parts of a pdf.js annotation this module reads. */
export interface PdfAnnotationLike {
  subtype?: string
  quadPoints?: ArrayLike<number> | null
  rect?: ArrayLike<number> | null
  color?: Uint8ClampedArray | number[] | null
  contentsObj?: { str?: string } | null
  titleObj?: { str?: string } | null
}

interface ViewportLike {
  convertToViewportPoint: (x: number, y: number) => number[]
}

/**
 * Turn the `/Highlight` annotations a PDF already carries into rectangles we
 * can paint.
 *
 * Needed because the canvas no longer draws them: rendering with
 * `annotationMode: DISABLE` stopped our own highlights being painted twice,
 * but it would also have made a paper highlighted in Preview or Zotero open
 * looking blank. Reading them here keeps them visible AND makes them
 * distinguishable from SUNA's own, which the canvas never could.
 *
 * `quadPoints` is a flat run of 8 numbers per quad in PDF user space; each is
 * mapped through the viewport so rotation and zoom are handled by pdf.js
 * rather than by arithmetic here.
 */
export function highlightRectsFromAnnotations(
  annotations: readonly PdfAnnotationLike[],
  viewport: ViewportLike
): ForeignHighlight[] {
  const out: ForeignHighlight[] = []

  for (const annotation of annotations) {
    if (annotation.subtype !== 'Highlight') continue
    const quads = annotation.quadPoints
    const rects: HighlightRect[] = []

    if (quads != null && quads.length >= 8) {
      for (let i = 0; i + 7 < quads.length; i += 8) {
        // Corners come as upper-left, upper-right, lower-left, lower-right;
        // take the extremes rather than assuming which is which, since not
        // every producer writes them in spec order.
        const xs: number[] = []
        const ys: number[] = []
        for (let c = 0; c < 8; c += 2) {
          const point = viewport.convertToViewportPoint(
            Number(quads[i + c]),
            Number(quads[i + c + 1])
          )
          xs.push(point[0] ?? 0)
          ys.push(point[1] ?? 0)
        }
        const left = Math.min(...xs)
        const top = Math.min(...ys)
        const width = Math.max(...xs) - left
        const height = Math.max(...ys) - top
        if (width > 0.5 && height > 0.5) rects.push({ left, top, width, height })
      }
    }
    if (rects.length === 0) continue

    const c = annotation.color
    out.push({
      rects,
      color:
        c != null && c.length >= 3 ? `rgb(${Number(c[0])}, ${Number(c[1])}, ${Number(c[2])})` : null,
      contents: annotation.contentsObj?.str?.trim() || null,
      author: annotation.titleObj?.str?.trim() || null
    })
  }

  return out
}

/**
 * Drop the annotations that are SUNA's own copies of notes it already paints.
 *
 * After an embed the file contains our highlights too, so reading them back
 * would paint everything twice — the very doubling `annotationMode: DISABLE`
 * was meant to end. Geometry is the honest discriminator: if a file annotation
 * covers a region the sidecar already accounts for, it IS that note.
 */
export function foreignOnly(
  found: readonly ForeignHighlight[],
  ours: readonly HighlightRect[]
): ForeignHighlight[] {
  if (ours.length === 0) return [...found]
  return found.filter(
    (highlight) => !highlight.rects.some((rect) => ours.some((mine) => overlaps(rect, mine)))
  )
}
