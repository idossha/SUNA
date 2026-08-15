/**
 * PNG import sizing (feature-plan-3 §4): a dropped/opened raster is embedded
 * at its natural pixel size, read at 300 dpi and converted to the artboard's
 * user units — pure math, unit-tested without touching an <img>/Image().
 */

const MM_PER_INCH = 25.4

export interface PixelSize {
  widthPx: number
  heightPx: number
}

export interface MmSize {
  widthMm: number
  heightMm: number
}

/** Physical size (mm) of a raster at `dpi` (default 300, the spec's fixed rate). */
export function pngSizeMm(pixels: PixelSize, dpi = 300): MmSize {
  return {
    widthMm: (pixels.widthPx / dpi) * MM_PER_INCH,
    heightMm: (pixels.heightPx / dpi) * MM_PER_INCH
  }
}

/** mm -> artboard user units (Artboard.mmPerUser is "physical mm per one user unit"). */
export function mmToUserUnits(mm: number, mmPerUser: number): number {
  return mmPerUser > 0 ? mm / mmPerUser : mm
}

export interface UserSize {
  widthUser: number
  heightUser: number
}

/** Pixels @ dpi -> artboard user units, in one step. */
export function pngSizeUserUnits(pixels: PixelSize, mmPerUser: number, dpi = 300): UserSize {
  const mm = pngSizeMm(pixels, dpi)
  return {
    widthUser: mmToUserUnits(mm.widthMm, mmPerUser),
    heightUser: mmToUserUnits(mm.heightMm, mmPerUser)
  }
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/**
 * `<image>` snippet embedding a PNG as a data URI, sized to `size` (user
 * units) and placed at `(x, y)` — the engine's `insert` command accepts it
 * as a single root element, so one import is one undoable command. `id`
 * uses the same `imported-N` scheme as SVG import (import-svg.ts).
 */
export function pngImageSnippet(
  id: string,
  dataUri: string,
  size: UserSize,
  at: { x: number; y: number }
): string {
  return (
    `<image id="${id}" x="${fmt(at.x)}" y="${fmt(at.y)}" width="${fmt(size.widthUser)}" ` +
    `height="${fmt(size.heightUser)}" href="${dataUri}"/>`
  )
}
