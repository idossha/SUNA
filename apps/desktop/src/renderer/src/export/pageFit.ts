/**
 * How large a page is drawn before the user touches the zoom
 * (feature-plan-13 §B2).
 *
 * Pulled out of PagedDocument as a pure function because the difference
 * between the two fits is the difference between the export preview and the
 * Pages view being useful:
 *
 *  - 'width' fills the column. Right for a preview you are READING — the text
 *    is as large as the panel allows and you scroll through it.
 *  - 'page' fits the whole sheet, height included. Right for a page VIEW,
 *    whose entire purpose is showing where the page ends; a view that cannot
 *    show a page end is not showing pagination at all.
 *
 * Both are capped: without a ceiling a wide panel turns one page into a
 * billboard, which is neither readable nor recognizable as paper.
 */

/** 1 PDF point at 96 dpi — the factor between pdf.js's scale and a reader's "100%". */
export const CSS_PX_PER_PT = 96 / 72
/** Gap between page tiles, and the breathing room a fit leaves around them. */
export const PAGE_GAP = 16
/** How far a fit may enlarge a page in a very large panel. */
export const MAX_FIT_SCALE = CSS_PX_PER_PT * 1.5

export type PageFit = 'width' | 'page'

export function fitScaleFor(opts: {
  fit: PageFit
  containerWidth: number
  containerHeight: number
  pageWidth: number
  pageHeight: number
}): number {
  const { fit, containerWidth, containerHeight, pageWidth, pageHeight } = opts
  // Nothing measured yet (or a degenerate page): 1 keeps the first paint sane
  // and the ResizeObserver corrects it a frame later.
  if (pageWidth <= 0) return 1
  const byWidth = Math.max(0, containerWidth - PAGE_GAP * 2) / pageWidth
  if (fit === 'width' || pageHeight <= 0 || containerHeight <= 0) {
    return Math.min(MAX_FIT_SCALE, byWidth)
  }
  const byHeight = Math.max(0, containerHeight - PAGE_GAP * 2) / pageHeight
  return Math.min(MAX_FIT_SCALE, byWidth, byHeight)
}

/** The percentage a reader expects to see, given pdf.js's points-based scale. */
export function zoomPercentOf(scale: number): number {
  return Math.round((scale / CSS_PX_PER_PT) * 100)
}
