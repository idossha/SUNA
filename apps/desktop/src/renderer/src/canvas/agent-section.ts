import type { Diagnostic } from '@suna/formatter'

/**
 * Pure math/formatting behind the canvas Agent section (ARCHITECTURE §10.4),
 * split from AgentSection.tsx so it stays unit-testable without dragging the
 * directed-action runner (and its window.suna calls) into a node test run.
 */

/** The subset of DOMRect the capture math reads — plain objects test fine. */
export interface ClientRectLike {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Union the mirror rects (or the artboard rect), pad, and offset client →
 * page coordinates for 'app:capture-rect'. Rects that measured 0×0 are
 * unrenderable (hidden panel, defs-only element) and are dropped; a
 * zero-EXTENT rect along one axis (a horizontal line) is real geometry and
 * survives because the padding gives the capture its area. Null means
 * nothing measurable — the send proceeds without a screenshot.
 */
export function captureRegionFor(
  rects: readonly ClientRectLike[],
  pad: number,
  offsetX = 0,
  offsetY = 0
): CaptureRegion | null {
  const real = rects.filter((r) => r.right - r.left > 0 || r.bottom - r.top > 0)
  const first = real[0]
  if (first === undefined) return null
  let left = first.left
  let top = first.top
  let right = first.right
  let bottom = first.bottom
  for (const r of real.slice(1)) {
    left = Math.min(left, r.left)
    top = Math.min(top, r.top)
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  return {
    x: left - pad + offsetX,
    y: top - pad + offsetY,
    width: right - left + pad * 2,
    height: bottom - top + pad * 2
  }
}

/** §4 target line: first selected id plus a count, or the whole figure. */
export function selectionReadout(ids: readonly string[]): string {
  const first = ids[0]
  if (first === undefined) return 'Whole figure'
  if (ids.length === 1) return `Selection: ${first}`
  return `Selection: ${first} (+${ids.length - 1} more)`
}

/** One human-readable line per issue, for figureEditPrompt's CONTEXT block. */
export function complianceLines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => `${d.severity} ${d.id}: ${d.message}`)
}
