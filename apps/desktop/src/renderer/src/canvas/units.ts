/**
 * Pure mm↔px math for figure export (canvas parity spec §6). Mirrors the
 * main process's figure-geometry.ts so the properties-rail readout always
 * matches what 'figure:export' actually produces — 180 mm @ 300 dpi → 2126
 * px wide, per the frozen contract.
 */

export interface ExportPixelSize {
  widthPx: number
  heightPx: number
  heightMm: number
}

/**
 * Pixel size for `widthMm` at `dpi`, preserving the artboard's own aspect
 * ratio (artboardWidthMm × artboardHeightMm, both physical mm from
 * `CanvasDocument.artboard`).
 */
export function exportPixelSize(
  artboardWidthMm: number,
  artboardHeightMm: number,
  widthMm: number,
  dpi: number
): ExportPixelSize {
  const heightMm =
    artboardWidthMm > 0 ? (widthMm * artboardHeightMm) / artboardWidthMm : widthMm
  return {
    widthPx: Math.max(1, Math.round((widthMm / 25.4) * dpi)),
    heightPx: Math.max(1, Math.round((heightMm / 25.4) * dpi)),
    heightMm
  }
}

/** Matches figure-export.ts's rejection message for 'png'/'tiff' formats. */
const RASTER_ERROR_RE = /draw the SVG at (\d+)×(\d+) px[\s\S]*\(([^)]+)\)\s*$/

export interface ParsedRasterExportError {
  path: string
  widthPx: number
  heightPx: number
}

/**
 * 'figure:export' throws by design for 'png'/'tiff' (main has no canvas to
 * rasterize with) — but the thrown message carries the exact output path
 * and target pixel size, so the renderer can rasterize and hand the bytes
 * to 'figure:write-binary' without re-deriving the output path itself
 * (which would require duplicating suna.json's directory-override logic).
 * Returns null if the message doesn't match that documented shape.
 */
export function parseRasterExportError(message: string): ParsedRasterExportError | null {
  const m = RASTER_ERROR_RE.exec(message)
  if (!m) return null
  const widthPx = Number(m[1])
  const heightPx = Number(m[2])
  const path = m[3]
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || !path) return null
  return { path, widthPx, heightPx }
}
