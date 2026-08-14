import { describe, expect, it } from 'vitest'
import { exportPixelSize, parseRasterExportError } from './units'

describe('exportPixelSize', () => {
  it('matches the documented 180mm @ 300dpi example (2126 px wide)', () => {
    const size = exportPixelSize(180, 80, 180, 300)
    expect(size.widthPx).toBe(2126)
  })

  it('preserves the artboard aspect ratio when scaling to a different width', () => {
    const size = exportPixelSize(180, 90, 90, 300)
    expect(size.heightMm).toBeCloseTo(45, 6)
    expect(size.widthPx).toBe(Math.round((90 / 25.4) * 300))
    expect(size.heightPx).toBe(Math.round((45 / 25.4) * 300))
  })

  it('never rounds a dimension down to zero', () => {
    const size = exportPixelSize(1000, 1000, 0.01, 72)
    expect(size.widthPx).toBeGreaterThanOrEqual(1)
    expect(size.heightPx).toBeGreaterThanOrEqual(1)
  })
})

describe('parseRasterExportError', () => {
  it('extracts path and pixel size from the main-process rejection message', () => {
    const msg =
      "PNG is rasterized in the renderer: draw the SVG at 2126×826 px and send the bytes to 'figure:write-binary' (/proj/output/fig1.png)"
    expect(parseRasterExportError(msg)).toEqual({
      path: '/proj/output/fig1.png',
      widthPx: 2126,
      heightPx: 826
    })
  })

  it('handles TIFF and paths containing parentheses-free spaces', () => {
    const msg =
      "TIFF is rasterized in the renderer: draw the SVG at 512×256 px and send the bytes to 'figure:write-binary' (/Users/a b/proj/output/fig two.tiff)"
    expect(parseRasterExportError(msg)).toEqual({
      path: '/Users/a b/proj/output/fig two.tiff',
      widthPx: 512,
      heightPx: 256
    })
  })

  it('returns null for unrelated messages', () => {
    expect(parseRasterExportError('some other error')).toBeNull()
    expect(parseRasterExportError('')).toBeNull()
  })
})
