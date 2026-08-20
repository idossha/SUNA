import { describe, expect, it } from 'vitest'
import { CSS_PX_PER_PT, MAX_FIT_SCALE, fitScaleFor, zoomPercentOf } from './pageFit'

/** US Letter as pdf.js reports it at scale 1: points, not pixels. */
const LETTER = { pageWidth: 612, pageHeight: 792 }

describe('fitScaleFor', () => {
  it('fills the column under fit: width, ignoring how short the panel is', () => {
    const tall = fitScaleFor({ fit: 'width', containerWidth: 644, containerHeight: 2000, ...LETTER })
    const short = fitScaleFor({ fit: 'width', containerWidth: 644, containerHeight: 100, ...LETTER })
    expect(tall).toBeCloseTo(1, 5)
    expect(short).toBe(tall)
  })

  it('fits the whole sheet under fit: page, so a page END is always on screen', () => {
    // A panel wide enough for 1.0x but only tall enough for 0.5x must pick 0.5x.
    const scale = fitScaleFor({ fit: 'page', containerWidth: 644, containerHeight: 428, ...LETTER })
    expect(scale).toBeCloseTo(0.5, 5)
    expect(scale * LETTER.pageHeight).toBeLessThanOrEqual(428)
  })

  it('still respects the width when the panel is tall and narrow', () => {
    const scale = fitScaleFor({ fit: 'page', containerWidth: 338, containerHeight: 4000, ...LETTER })
    expect(scale).toBeCloseTo(0.5, 5)
  })

  it('caps both fits, so a huge panel shows a page rather than a billboard', () => {
    for (const fit of ['width', 'page'] as const) {
      const scale = fitScaleFor({ fit, containerWidth: 9000, containerHeight: 9000, ...LETTER })
      expect(scale).toBe(MAX_FIT_SCALE)
    }
  })

  it('never returns a negative scale for a panel smaller than the gap', () => {
    const scale = fitScaleFor({ fit: 'page', containerWidth: 4, containerHeight: 4, ...LETTER })
    expect(scale).toBeGreaterThanOrEqual(0)
  })

  it('falls back to 1 before anything has been measured', () => {
    expect(
      fitScaleFor({ fit: 'page', containerWidth: 0, containerHeight: 0, pageWidth: 0, pageHeight: 0 })
    ).toBe(1)
  })
})

describe('zoomPercentOf', () => {
  it('calls 96 dpi "100%", which is what every PDF reader calls it', () => {
    expect(zoomPercentOf(CSS_PX_PER_PT)).toBe(100)
  })

  it('reports a points-scale of 1 as the 75% it actually is', () => {
    expect(zoomPercentOf(1)).toBe(75)
  })
})
