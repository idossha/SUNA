import { describe, expect, it } from 'vitest'
import { clampZoom, fitContainScale, fitWidthScale, zoomIn, zoomOut, ZOOM_MAX, ZOOM_MIN } from './zoom'

describe('clampZoom', () => {
  it('passes through values already inside the range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(2.5)).toBe(2.5)
  })

  it('clamps to the min/max bounds', () => {
    expect(clampZoom(0.001)).toBe(ZOOM_MIN)
    expect(clampZoom(1000)).toBe(ZOOM_MAX)
  })

  it('falls back to 1 for non-finite or non-positive input', () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampZoom(0)).toBe(1)
    expect(clampZoom(-2)).toBe(1)
  })
})

describe('zoomIn / zoomOut', () => {
  it('steps up and back down to (approximately) the same value', () => {
    const stepped = zoomIn(1)
    expect(stepped).toBeGreaterThan(1)
    expect(zoomOut(stepped)).toBeCloseTo(1, 10)
  })

  it('never steps past the max going in, or the min going out', () => {
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX)
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN)
  })

  it('clamps a starting value that is itself out of range before stepping', () => {
    expect(zoomIn(-5)).toBeCloseTo(1.2, 10)
  })
})

describe('fitWidthScale', () => {
  it('scales content to exactly fill the container width', () => {
    expect(fitWidthScale(800, 400)).toBe(2)
    expect(fitWidthScale(400, 800)).toBe(0.5)
  })

  it('falls back to 1 when a dimension is unknown (zero or negative)', () => {
    expect(fitWidthScale(0, 400)).toBe(1)
    expect(fitWidthScale(800, 0)).toBe(1)
    expect(fitWidthScale(-10, 400)).toBe(1)
  })

  it('clamps the result into the supported zoom range', () => {
    expect(fitWidthScale(10, 10000)).toBe(ZOOM_MIN)
    expect(fitWidthScale(10000, 10)).toBe(ZOOM_MAX)
  })
})

describe('fitContainScale', () => {
  it('picks the smaller of the two axis ratios (letterboxing)', () => {
    // container 800x400, content 400x400 -> width ratio 2, height ratio 1 -> 1
    expect(fitContainScale(800, 400, 400, 400)).toBe(1)
    // container 400x800, content 400x400 -> width ratio 1, height ratio 2 -> 1
    expect(fitContainScale(400, 800, 400, 400)).toBe(1)
    // container 200x200, content 400x100 -> width ratio 0.5, height ratio 2 -> 0.5
    expect(fitContainScale(200, 200, 400, 100)).toBe(0.5)
  })

  it('falls back to 1 when any dimension is unknown', () => {
    expect(fitContainScale(0, 200, 400, 100)).toBe(1)
    expect(fitContainScale(200, 0, 400, 100)).toBe(1)
    expect(fitContainScale(200, 200, 0, 100)).toBe(1)
    expect(fitContainScale(200, 200, 400, 0)).toBe(1)
  })
})
