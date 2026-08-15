import { describe, expect, it } from 'vitest'
import { currentPageIndex, layoutPages, visiblePageIndices, type PageBox } from './pdf-layout'

describe('layoutPages', () => {
  it('stacks pages top to bottom with a gap between each', () => {
    expect(layoutPages([100, 200, 50], 10)).toEqual([
      { top: 0, height: 100 },
      { top: 110, height: 200 },
      { top: 320, height: 50 }
    ])
  })

  it('defaults to a 12px gap', () => {
    const boxes = layoutPages([100, 100])
    expect(boxes[1]).toEqual({ top: 112, height: 100 })
  })

  it('treats a non-positive or non-finite height as zero height but keeps its slot', () => {
    expect(layoutPages([100, 0, -5, Number.NaN, 100], 0)).toEqual([
      { top: 0, height: 100 },
      { top: 100, height: 0 },
      { top: 100, height: 0 },
      { top: 100, height: 0 },
      { top: 100, height: 100 }
    ])
  })

  it('returns an empty layout for an empty input', () => {
    expect(layoutPages([])).toEqual([])
  })
})

const PAGES: PageBox[] = layoutPages([100, 100, 100, 100], 0) // tops: 0, 100, 200, 300

describe('currentPageIndex', () => {
  it('returns 0 for an empty layout or non-positive scroll', () => {
    expect(currentPageIndex(50, [])).toBe(0)
    expect(currentPageIndex(0, PAGES)).toBe(0)
    expect(currentPageIndex(-40, PAGES)).toBe(0)
  })

  it('finds the page whose box contains scrollTop', () => {
    expect(currentPageIndex(150, PAGES)).toBe(1)
    expect(currentPageIndex(199, PAGES)).toBe(1)
    expect(currentPageIndex(200, PAGES)).toBe(2)
  })

  it('clamps to the last page when scrolled past the end', () => {
    expect(currentPageIndex(10_000, PAGES)).toBe(3)
  })
})

describe('visiblePageIndices', () => {
  it('returns the pages intersecting the viewport, expanded by the margin', () => {
    // viewport [120, 220) sits inside page 1 (100-200) and touches page 2 (200-300);
    // margin 1 pulls in page 0 before and page 3 after
    expect(visiblePageIndices(120, 100, PAGES, 1)).toEqual([0, 1, 2, 3])
  })

  it('with margin 0 returns exactly the intersecting pages, no more', () => {
    // viewport [120, 150) is entirely inside page 1 only
    expect(visiblePageIndices(120, 30, PAGES, 0)).toEqual([1])
  })

  it('clamps the expanded window to the layout bounds at both ends', () => {
    expect(visiblePageIndices(0, 10, PAGES, 5)).toEqual([0, 1, 2, 3])
    expect(visiblePageIndices(390, 10, PAGES, 5)).toEqual([0, 1, 2, 3])
  })

  it('returns empty for an empty layout or a zero/negative viewport height', () => {
    expect(visiblePageIndices(0, 100, [])).toEqual([])
    expect(visiblePageIndices(0, 0, PAGES)).toEqual([])
    expect(visiblePageIndices(0, -10, PAGES)).toEqual([])
  })

  it('clamps a negative scrollTop to 0 rather than under-shooting the window', () => {
    expect(visiblePageIndices(-50, 60, PAGES, 0)).toEqual([0])
  })
})
