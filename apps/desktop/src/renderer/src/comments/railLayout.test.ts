import { describe, expect, it } from 'vitest'
import { layoutSlots } from './railLayout'

describe('layoutSlots', () => {
  it('keeps non-overlapping cards exactly at their anchors', () => {
    const tops = layoutSlots(
      [
        { id: 'a', desiredTop: 100, height: 60 },
        { id: 'b', desiredTop: 300, height: 60 }
      ],
      10
    )
    expect(tops.get('a')).toBe(100)
    expect(tops.get('b')).toBe(300)
  })

  it('pushes an overlapping card below the one above it, plus the gap', () => {
    const tops = layoutSlots(
      [
        { id: 'a', desiredTop: 100, height: 60 },
        { id: 'b', desiredTop: 120, height: 40 }
      ],
      10
    )
    expect(tops.get('a')).toBe(100)
    expect(tops.get('b')).toBe(170) // 100 + 60 + 10
  })

  it('cascades push-down through a whole cluster', () => {
    const tops = layoutSlots(
      [
        { id: 'a', desiredTop: 0, height: 50 },
        { id: 'b', desiredTop: 10, height: 50 },
        { id: 'c', desiredTop: 20, height: 50 }
      ],
      10
    )
    expect(tops.get('a')).toBe(0)
    expect(tops.get('b')).toBe(60)
    expect(tops.get('c')).toBe(120)
  })

  it('a card is never placed above its own anchor', () => {
    const entries = [
      { id: 'a', desiredTop: 500, height: 80 },
      { id: 'b', desiredTop: 40, height: 30 },
      { id: 'c', desiredTop: 45, height: 30 }
    ]
    const tops = layoutSlots(entries, 10)
    for (const entry of entries) {
      expect(tops.get(entry.id)!).toBeGreaterThanOrEqual(entry.desiredTop)
    }
  })

  it('input order does not matter — placement is by document position', () => {
    const shuffled = layoutSlots(
      [
        { id: 'b', desiredTop: 120, height: 40 },
        { id: 'a', desiredTop: 100, height: 60 }
      ],
      10
    )
    expect(shuffled.get('a')).toBe(100)
    expect(shuffled.get('b')).toBe(170)
  })

  it('handles an empty list', () => {
    expect(layoutSlots([], 10).size).toBe(0)
  })
})
