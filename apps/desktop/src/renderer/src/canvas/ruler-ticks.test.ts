import { describe, expect, it } from 'vitest'
import { rulerTicks } from './ruler-ticks'

describe('rulerTicks', () => {
  it('produces one tick per mm from 0 through the rounded-down length', () => {
    const ticks = rulerTicks(25.4)
    expect(ticks).toHaveLength(26) // 0..25
    expect(ticks[0]).toEqual({ mm: 0, major: true })
    expect(ticks[25]).toEqual({ mm: 25, major: false })
  })

  it('marks every 10mm as major, starting at the origin', () => {
    const ticks = rulerTicks(30)
    const majors = ticks.filter((t) => t.major).map((t) => t.mm)
    expect(majors).toEqual([0, 10, 20, 30])
  })

  it('returns an empty ruler for a non-positive or non-finite length', () => {
    expect(rulerTicks(0)).toEqual([])
    expect(rulerTicks(-5)).toEqual([])
    expect(rulerTicks(Number.NaN)).toEqual([])
  })

  it('honors custom minor/major step sizes', () => {
    const ticks = rulerTicks(20, 5, 20)
    expect(ticks.map((t) => t.mm)).toEqual([0, 5, 10, 15, 20])
    expect(ticks.filter((t) => t.major).map((t) => t.mm)).toEqual([0, 20])
  })
})
