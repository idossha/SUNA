/**
 * Shared zoom math for the PDF and image viewers (DECISIONS 2026-08-14): a
 * clamped multiplicative step for the +/- controls, plus the two "fit"
 * formulas each viewer's default view uses. Pure — no DOM, safe to unit test.
 */

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 8
const ZOOM_STEP_FACTOR = 1.2

/** Clamp a scale factor into the viewers' supported zoom range. */
export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/** One ⌘+ / zoom-in step from `scale`. */
export function zoomIn(scale: number): number {
  return clampZoom(clampZoom(scale) * ZOOM_STEP_FACTOR)
}

/** One ⌘- / zoom-out step from `scale`. */
export function zoomOut(scale: number): number {
  return clampZoom(clampZoom(scale) / ZOOM_STEP_FACTOR)
}

/**
 * Scale that fits `contentWidth` exactly into `containerWidth` (the PDF
 * viewer's default "fit width" mode). Falls back to 1 when either dimension
 * is not yet known (nothing measured on screen yet).
 */
export function fitWidthScale(containerWidth: number, contentWidth: number): number {
  if (!(containerWidth > 0) || !(contentWidth > 0)) return 1
  return clampZoom(containerWidth / contentWidth)
}

/**
 * Scale that fits content fully inside a container on both axes (the image
 * viewer's default "fit" mode).
 */
export function fitContainScale(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number
): number {
  if (
    !(containerWidth > 0) ||
    !(containerHeight > 0) ||
    !(contentWidth > 0) ||
    !(contentHeight > 0)
  ) {
    return 1
  }
  return clampZoom(Math.min(containerWidth / contentWidth, containerHeight / contentHeight))
}
