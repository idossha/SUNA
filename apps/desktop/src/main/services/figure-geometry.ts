/**
 * Pure geometry for figure export: the artboard's aspect ratio comes from the
 * SVG itself (viewBox first, then width/height attributes), the physical width
 * comes from the caller (a journal width preset in mm), and the pixel size is
 * whatever that width at the requested dpi implies.
 */

export interface SvgAspect {
  widthUser: number
  heightUser: number
}

export interface ExportPixelSize {
  widthPx: number
  heightPx: number
  heightMm: number
}

const UNIT_TO_PX: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96
}

function parseLength(value: string | undefined): number | null {
  if (value === undefined) return null
  const match = /^\s*([0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)\s*([a-z%]*)\s*$/i.exec(value)
  if (match === null) return null
  const magnitude = Number.parseFloat(match[1] ?? '')
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null
  const factor = UNIT_TO_PX[(match[2] ?? '').toLowerCase()]
  return factor === undefined ? null : magnitude * factor
}

function attribute(openTag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`).exec(openTag)
  if (match === null) return undefined
  return match[1] ?? match[2]
}

/** Aspect of the artboard, or null when the SVG declares no usable size. */
export function parseSvgAspect(svg: string): SvgAspect | null {
  const openTag = /<svg\b[^>]*>/i.exec(svg)?.[0]
  if (openTag === undefined) return null

  const viewBox = attribute(openTag, 'viewBox')
  if (viewBox !== undefined) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
    const width = parts[2]
    const height = parts[3]
    if (
      parts.length === 4 &&
      width !== undefined &&
      height !== undefined &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return { widthUser: width, heightUser: height }
    }
  }

  const width = parseLength(attribute(openTag, 'width'))
  const height = parseLength(attribute(openTag, 'height'))
  if (width !== null && height !== null) return { widthUser: width, heightUser: height }
  return null
}

/**
 * Pixel dimensions for `widthMm` at `dpi`, preserving the artboard aspect.
 * 180 mm at 300 dpi → 2126 px wide, matching the readout in the export panel.
 */
export function exportPixelSize(aspect: SvgAspect, widthMm: number, dpi: number): ExportPixelSize {
  const heightMm = (widthMm * aspect.heightUser) / aspect.widthUser
  return {
    widthPx: Math.max(1, Math.round((widthMm / 25.4) * dpi)),
    heightPx: Math.max(1, Math.round((heightMm / 25.4) * dpi)),
    heightMm
  }
}
