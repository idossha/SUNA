/**
 * Pure layout math for PdfTab's continuous vertical scroll (DECISIONS 2026-08-14).
 * The component measures each page at the current zoom and hands the
 * heights here; everything about *where* a page sits and *which* pages are
 * near the viewport is computed without touching the DOM, so it is fully
 * unit-testable and reused for three real jobs:
 *   - sizing the placeholder box for a not-yet-rendered page (stable scroll
 *     height even though most pages never mount a canvas),
 *   - the lazy-render window (rendered pages = visible ± `margin`), backing
 *     up the IntersectionObserver the component uses at runtime,
 *   - the "page N of M" readout and the page-jump input's scroll target.
 */

export interface PageBox {
  /** Distance in px from the top of the scroll content to this page's top edge. */
  top: number
  height: number
}

/**
 * Stacks `heights` top to bottom with `gap` px between consecutive pages,
 * returning each page's offset. `heights` are already at the render scale
 * the caller wants laid out (e.g. natural height × zoom).
 */
export function layoutPages(heights: readonly number[], gap = 12): PageBox[] {
  const boxes: PageBox[] = []
  let top = 0
  for (const height of heights) {
    const h = Number.isFinite(height) && height > 0 ? height : 0
    boxes.push({ top, height: h })
    top += h + gap
  }
  return boxes
}

/**
 * 0-based index of the page containing `scrollTop` (the page whose box the
 * viewport's top edge is currently inside), clamped to the last page. Empty
 * layout returns 0.
 */
export function currentPageIndex(scrollTop: number, pages: readonly PageBox[]): number {
  if (pages.length === 0) return 0
  if (scrollTop <= 0) return 0
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]
    if (page && scrollTop < page.top + page.height) return i
  }
  return pages.length - 1
}

/**
 * 0-based indices of pages intersecting the viewport window
 * `[scrollTop, scrollTop + viewportHeight]`, expanded by `margin` pages on
 * each side and clamped to the layout — the lazy-render set. Empty when
 * nothing is measured yet or the viewport has no extent.
 */
export function visiblePageIndices(
  scrollTop: number,
  viewportHeight: number,
  pages: readonly PageBox[],
  margin = 1
): number[] {
  if (pages.length === 0 || !(viewportHeight > 0)) return []
  const top = Math.max(0, scrollTop)
  const bottom = top + viewportHeight

  let first = -1
  let last = -1
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]
    if (!page) continue
    const pageBottom = page.top + page.height
    if (pageBottom >= top && page.top <= bottom) {
      if (first === -1) first = i
      last = i
    }
  }
  if (first === -1) return []

  const start = Math.max(0, first - margin)
  const end = Math.min(pages.length - 1, last + margin)
  const result: number[] = []
  for (let i = start; i <= end; i += 1) result.push(i)
  return result
}
