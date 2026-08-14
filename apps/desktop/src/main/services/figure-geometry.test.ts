import { describe, expect, it } from 'vitest'
import { exportPixelSize, parseSvgAspect } from './figure-geometry'

const MATPLOTLIB_HEADER =
  '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
  '<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="510.23622pt" height="164.409449pt" ' +
  'viewBox="0 0 510.23622 164.409449" xmlns="http://www.w3.org/2000/svg" version="1.1">\n</svg>'

describe('parseSvgAspect', () => {
  it('prefers the viewBox of a real matplotlib export', () => {
    expect(parseSvgAspect(MATPLOTLIB_HEADER)).toEqual({
      widthUser: 510.23622,
      heightUser: 164.409449
    })
  })

  it('falls back to width/height attributes with units', () => {
    expect(parseSvgAspect('<svg width="180mm" height="60mm"></svg>')).toEqual({
      widthUser: (180 * 96) / 25.4,
      heightUser: (60 * 96) / 25.4
    })
  })

  it('accepts comma-separated viewBox values and single quotes', () => {
    expect(parseSvgAspect("<svg viewBox='0,0,200,100'></svg>")).toEqual({
      widthUser: 200,
      heightUser: 100
    })
  })

  it('returns null when the SVG declares no usable size', () => {
    expect(parseSvgAspect('<svg></svg>')).toBeNull()
    expect(parseSvgAspect('<svg width="0" height="0"></svg>')).toBeNull()
    expect(parseSvgAspect('not an svg at all')).toBeNull()
  })
})

describe('exportPixelSize', () => {
  it('matches the export readout: 180 mm at 300 dpi', () => {
    const aspect = parseSvgAspect(MATPLOTLIB_HEADER)
    if (aspect === null) throw new Error('expected an aspect')
    const size = exportPixelSize(aspect, 180, 300)
    expect(size.widthPx).toBe(2126)
    expect(size.heightMm).toBeCloseTo(58, 4)
    expect(size.heightPx).toBe(685)
  })

  it('scales linearly with dpi', () => {
    const square = { widthUser: 100, heightUser: 100 }
    expect(exportPixelSize(square, 88, 300).widthPx).toBe(1039)
    expect(exportPixelSize(square, 88, 600).widthPx).toBe(2079)
    expect(exportPixelSize(square, 88, 600).heightPx).toBe(2079)
  })

  it('never rounds a tiny figure down to zero pixels', () => {
    const size = exportPixelSize({ widthUser: 1000, heightUser: 1 }, 10, 72)
    expect(size.heightPx).toBe(1)
  })
})
