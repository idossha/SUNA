import { describe, expect, it } from 'vitest'
import {
  anchorCard,
  centreCard,
  chooseSide,
  isVisibleRect,
  padRect,
  TOUR_GAP,
  TOUR_MARGIN,
  type Rect
} from './anchor'

const viewport = { width: 1400, height: 900 }
const card = { width: 340, height: 200 }

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

describe('padRect', () => {
  it('grows on every side', () => {
    expect(padRect(rect(100, 100, 40, 20), 6)).toEqual({ x: 94, y: 94, width: 52, height: 32 })
  })
})

describe('chooseSide', () => {
  it('takes the first preferred side that fits', () => {
    // A control near the top-left: 'bottom' has all the room in the world.
    expect(chooseSide(rect(40, 60, 30, 30), card, viewport, ['bottom', 'right'])).toBe('bottom')
  })

  it('falls through to the next preference when the first has no room', () => {
    // The rail runs the full height, so nothing fits above or below it.
    const rail = rect(0, 0, 48, viewport.height)
    expect(chooseSide(rail, card, viewport, ['bottom', 'right'])).toBe('right')
  })

  it('takes the roomiest side when none of them fits', () => {
    // A target filling the window: every side overflows, and the largest
    // remaining gap is below (900 - 700 - 12 = 188 vs 100 above).
    const huge = rect(0, 100, viewport.width, 600)
    expect(chooseSide(huge, card, viewport, ['top'])).toBe('bottom')
  })

  it('defaults its preference order when given none', () => {
    expect(chooseSide(rect(40, 60, 30, 30), card, viewport, [])).toBe('bottom')
  })
})

describe('anchorCard', () => {
  it('sits below a target and centres on it', () => {
    const target = rect(500, 100, 100, 40)
    const placed = anchorCard(target, card, viewport, ['bottom'])
    expect(placed.side).toBe('bottom')
    expect(placed.card.y).toBe(100 + 40 + TOUR_GAP)
    expect(placed.card.x).toBe(550 - card.width / 2)
  })

  it('sits to the right of a full-height rail', () => {
    const placed = anchorCard(rect(0, 0, 48, viewport.height), card, viewport, ['bottom', 'right'])
    expect(placed.side).toBe('right')
    expect(placed.card.x).toBe(48 + TOUR_GAP)
  })

  it('never pushes the card past a viewport edge', () => {
    // A control hard against the right edge would centre a 340px card at
    // x = 1370 - 170, running its right half off-screen.
    const placed = anchorCard(rect(1330, 40, 40, 40), card, viewport, ['bottom'])
    expect(placed.card.x).toBeLessThanOrEqual(viewport.width - card.width - TOUR_MARGIN)
    expect(placed.card.x).toBeGreaterThanOrEqual(TOUR_MARGIN)
  })

  it('keeps the card on screen when it is wider than the window', () => {
    const narrow = { width: 300, height: 900 }
    const placed = anchorCard(rect(10, 10, 20, 20), card, narrow, ['bottom'])
    expect(placed.card.x).toBe(TOUR_MARGIN)
  })

  it('slides the beak along the card edge to line up with the target', () => {
    // Clamped card (target at the right edge) — the beak has to leave the
    // card's centre to keep pointing at the control.
    const target = rect(1330, 40, 40, 40)
    const placed = anchorCard(target, card, viewport, ['bottom'])
    expect(placed.beak.y).toBe(placed.card.y)
    expect(placed.beak.x).toBeGreaterThan(placed.card.x + card.width / 2)
    expect(placed.beak.x).toBeLessThanOrEqual(placed.card.x + card.width)
  })

  it('keeps the beak clear of the corners', () => {
    // Target far to the right of a card pinned by the left margin.
    const placed = anchorCard(rect(1390, 40, 4, 4), card, viewport, ['bottom'])
    expect(placed.beak.x).toBeLessThan(placed.card.x + card.width)
    expect(placed.beak.x).toBeGreaterThan(placed.card.x)
  })

  it('puts the beak on the card edge that faces the target', () => {
    const above = anchorCard(rect(600, 800, 100, 40), card, viewport, ['top'])
    expect(above.side).toBe('top')
    expect(above.beak.y).toBe(above.card.y + card.height)

    const left = anchorCard(rect(1300, 400, 60, 60), card, viewport, ['left'])
    expect(left.side).toBe('left')
    expect(left.beak.x).toBe(left.card.x + card.width)
  })
})

describe('centreCard', () => {
  it('centres, and never goes negative', () => {
    expect(centreCard(card, viewport)).toEqual({ x: 530, y: 350 })
    expect(centreCard({ width: 2000, height: 2000 }, viewport)).toEqual({
      x: TOUR_MARGIN,
      y: TOUR_MARGIN
    })
  })
})

describe('isVisibleRect', () => {
  it('rejects the 0x0 rect a hidden element measures', () => {
    expect(isVisibleRect(rect(0, 0, 0, 0))).toBe(false)
    expect(isVisibleRect(rect(10, 10, 4, 0))).toBe(false)
    expect(isVisibleRect(rect(10, 10, 4, 4))).toBe(true)
  })
})
