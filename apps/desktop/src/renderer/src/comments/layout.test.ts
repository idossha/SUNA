import { describe, expect, it } from 'vitest'
import { layoutCards, partitionByViewport, type CardAnchor } from './layout'

describe('layoutCards', () => {
  it('returns an empty array for empty input', () => {
    expect(layoutCards([], 8)).toEqual([])
  })

  it('places a single card exactly at its anchor', () => {
    const out = layoutCards([{ id: 'a', top: 120, height: 40 }], 8)
    expect(out).toEqual([{ id: 'a', top: 120 }])
  })

  it('keeps well-separated cards exactly at their anchors', () => {
    const anchors: CardAnchor[] = [
      { id: 'a', top: 0, height: 30 },
      { id: 'b', top: 200, height: 30 }
    ]
    expect(layoutCards(anchors, 8)).toEqual([
      { id: 'a', top: 0 },
      { id: 'b', top: 200 }
    ])
  })

  it('pushes an adjacent card down just enough to clear the gap, never overlapping', () => {
    const anchors: CardAnchor[] = [
      { id: 'a', top: 100, height: 20 },
      { id: 'b', top: 110, height: 20 }
    ]
    const out = layoutCards(anchors, 8)
    const a = out.find((c) => c.id === 'a')!
    const b = out.find((c) => c.id === 'b')!
    expect(a.top).toBe(100)
    // b must start no earlier than a's bottom + gap
    expect(b.top).toBeGreaterThanOrEqual(a.top + 20 + 8)
    expect(b.top).toBe(128)
  })

  it('stacks many cards anchored to the same line, in input order, none overlapping', () => {
    const anchors: CardAnchor[] = [
      { id: 'a', top: 50, height: 30 },
      { id: 'b', top: 50, height: 30 },
      { id: 'c', top: 50, height: 30 }
    ]
    const out = layoutCards(anchors, 6)
    const byId = new Map(out.map((c) => [c.id, c.top]))
    expect(byId.get('a')).toBe(50)
    expect(byId.get('b')).toBe(86) // 50 + 30 + 6
    expect(byId.get('c')).toBe(122) // 86 + 30 + 6
    // no pair overlaps
    const sorted = out.slice().sort((x, y) => x.top - y.top)
    for (let i = 1; i < sorted.length; i++) {
      const prevId = sorted[i - 1]!.id
      const prevHeight = anchors.find((a) => a.id === prevId)!.height
      expect(sorted[i]!.top).toBeGreaterThanOrEqual(sorted[i - 1]!.top + prevHeight + 6)
    }
  })

  it('pushes a card below a very tall preceding card', () => {
    const anchors: CardAnchor[] = [
      { id: 'tall', top: 0, height: 500 },
      { id: 'next', top: 10, height: 20 }
    ]
    const out = layoutCards(anchors, 8)
    expect(out.find((c) => c.id === 'tall')!.top).toBe(0)
    expect(out.find((c) => c.id === 'next')!.top).toBe(508)
  })

  it('sorts by anchor top regardless of input order', () => {
    const anchors: CardAnchor[] = [
      { id: 'later', top: 300, height: 10 },
      { id: 'earlier', top: 0, height: 10 }
    ]
    const out = layoutCards(anchors, 8)
    expect(out.find((c) => c.id === 'earlier')!.top).toBe(0)
    expect(out.find((c) => c.id === 'later')!.top).toBe(300)
  })

  it('never produces overlapping cards for a mixed, randomly-ordered set', () => {
    const anchors: CardAnchor[] = [
      { id: 'a', top: 40, height: 60 },
      { id: 'b', top: 0, height: 20 },
      { id: 'c', top: 35, height: 15 },
      { id: 'd', top: 400, height: 100 },
      { id: 'e', top: 38, height: 200 }
    ]
    const out = layoutCards(anchors, 10)
    const heightById = new Map(anchors.map((a) => [a.id, a.height]))
    const sorted = out.slice().sort((x, y) => x.top - y.top)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const prevBottom = prev.top + heightById.get(prev.id)!
      expect(sorted[i]!.top).toBeGreaterThanOrEqual(prevBottom + 10)
    }
  })
})

describe('partitionByViewport', () => {
  it('returns everything in-range when it fits the viewport', () => {
    const anchors: CardAnchor[] = [
      { id: 'a', top: 10, height: 20 },
      { id: 'b', top: 100, height: 20 }
    ]
    const { above, below, inRange } = partitionByViewport(anchors, 500)
    expect(above).toEqual([])
    expect(below).toEqual([])
    expect(inRange).toEqual(anchors)
  })

  it('buckets anchors above and below the visible window, nearest-edge first', () => {
    const anchors: CardAnchor[] = [
      { id: 'far-above', top: -900, height: 20 },
      { id: 'near-above', top: -10, height: 20 },
      { id: 'visible', top: 50, height: 20 },
      { id: 'near-below', top: 510, height: 20 },
      { id: 'far-below', top: 1200, height: 20 }
    ]
    const { above, below, inRange } = partitionByViewport(anchors, 500)
    expect(above).toEqual(['near-above', 'far-above'])
    expect(below).toEqual(['near-below', 'far-below'])
    expect(inRange.map((a) => a.id)).toEqual(['visible'])
  })

  it('returns empty buckets for empty input', () => {
    expect(partitionByViewport([], 500)).toEqual({ above: [], below: [], inRange: [] })
  })

  it('extends the visible window by the margin', () => {
    const anchors: CardAnchor[] = [{ id: 'edge', top: -5, height: 20 }]
    expect(partitionByViewport(anchors, 500, 0).above).toEqual(['edge'])
    expect(partitionByViewport(anchors, 500, 10).above).toEqual([])
  })
})
