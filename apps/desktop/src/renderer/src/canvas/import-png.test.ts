import { describe, expect, it } from 'vitest'
import { mmToUserUnits, pngImageSnippet, pngSizeMm, pngSizeUserUnits } from './import-png'

describe('pngSizeMm', () => {
  it('converts pixels at 300 dpi to mm (25.4mm/in)', () => {
    // 1200x600 px @ 300dpi -> 4in x 2in -> 101.6mm x 50.8mm
    expect(pngSizeMm({ widthPx: 1200, heightPx: 600 })).toEqual({
      widthMm: 101.6,
      heightMm: 50.8
    })
  })

  it('honors a non-default dpi', () => {
    expect(pngSizeMm({ widthPx: 600, heightPx: 300 }, 150)).toEqual({
      widthMm: 101.6,
      heightMm: 50.8
    })
  })
})

describe('mmToUserUnits', () => {
  it('divides by mmPerUser', () => {
    expect(mmToUserUnits(180, 0.3528)).toBeCloseTo(180 / 0.3528, 6)
  })

  it('falls back to mm when mmPerUser is not positive (underivable artboard)', () => {
    expect(mmToUserUnits(50, 0)).toBe(50)
    expect(mmToUserUnits(50, -1)).toBe(50)
  })
})

describe('pngSizeUserUnits', () => {
  it('chains pixel->mm->user-unit conversion', () => {
    // matplotlib-style pt-unit artboards: mmPerUser = 0.3528 (1 user unit = 1pt)
    const size = pngSizeUserUnits({ widthPx: 1200, heightPx: 600 }, 0.3528)
    const expectedWidthUser = 101.6 / 0.3528
    const expectedHeightUser = 50.8 / 0.3528
    expect(size.widthUser).toBeCloseTo(expectedWidthUser, 6)
    expect(size.heightUser).toBeCloseTo(expectedHeightUser, 6)
  })
})

describe('pngImageSnippet', () => {
  it('renders a single self-closing <image> root with the requested id/size/position', () => {
    const snippet = pngImageSnippet(
      'imported-1',
      'data:image/png;base64,AAAA',
      { widthUser: 288, heightUser: 144 },
      { x: 24, y: 24 }
    )
    expect(snippet).toBe(
      '<image id="imported-1" x="24" y="24" width="288" height="144" href="data:image/png;base64,AAAA"/>'
    )
  })

  it('rounds sizes to a compact decimal form', () => {
    const snippet = pngImageSnippet(
      'imported-2',
      'data:image/png;base64,AAAA',
      { widthUser: 100 / 3, heightUser: 50 / 3 },
      { x: 0, y: 0 }
    )
    expect(snippet).toContain('width="33.333"')
    expect(snippet).toContain('height="16.667"')
  })
})
