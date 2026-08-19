import { describe, expect, it } from 'vitest'
import {
  authorColor,
  DOT,
  edgePath,
  GRAPH_COLORS,
  gutterWidth,
  hashString,
  initials,
  LANE_W,
  laneX,
  MAX_LANES,
  relativeTime,
  ROW_H
} from './timeline'

describe('laneX / gutterWidth', () => {
  it('centres each column in its own slot', () => {
    expect(laneX(0)).toBe(LANE_W / 2)
    expect(laneX(2)).toBe(2 * LANE_W + LANE_W / 2)
  })

  it('always reserves at least one column', () => {
    expect(gutterWidth(0)).toBe(LANE_W)
  })

  it('stops widening past the cap, so the subject keeps its room', () => {
    expect(gutterWidth(MAX_LANES + 5)).toBe(MAX_LANES * LANE_W)
  })
})

describe('edgePath', () => {
  it('draws a straight line for a lane that does not move', () => {
    expect(edgePath(1, 1, 1)).toBe(`M${laneX(1)},0 L${laneX(1)},${ROW_H}`)
  })

  it('starts at the dot when the edge leaves a commit', () => {
    const path = edgePath(DOT, 2, 0)
    expect(path.startsWith(`M${laneX(0)},${ROW_H / 2}`)).toBe(true)
    expect(path.endsWith(`${laneX(2)},${ROW_H}`)).toBe(true)
  })

  it('ends at the dot when the edge arrives at a commit', () => {
    const path = edgePath(2, DOT, 0)
    expect(path.startsWith(`M${laneX(2)},0`)).toBe(true)
    expect(path.endsWith(`${laneX(0)},${ROW_H / 2}`)).toBe(true)
  })

  it('curves rather than corners when the lane changes', () => {
    expect(edgePath(0, 3, 0)).toContain('C')
    expect(edgePath(DOT, 3, 0)).toContain('C')
    expect(edgePath(3, DOT, 0)).toContain('C')
  })

  it('does not curve when a dot edge stays in its own lane', () => {
    expect(edgePath(DOT, 1, 1)).not.toContain('C')
    expect(edgePath(1, DOT, 1)).not.toContain('C')
  })
})

describe('authorColor', () => {
  it('always lands inside the palette', () => {
    for (const email of ['a@b.c', 'ada@lab.edu', '', 'x'.repeat(200)]) {
      const index = authorColor(email, 'Name')
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(GRAPH_COLORS)
    }
  })

  it('is stable for one author and ignores case', () => {
    expect(authorColor('Ada@Lab.edu', 'Ada')).toBe(authorColor('ada@lab.edu', 'Ada'))
  })

  it('falls back to the name when there is no email', () => {
    expect(authorColor('', 'Ada Lovelace')).toBe(authorColor('', 'ada lovelace'))
  })

  it('separates two people at the same institution', () => {
    // Not guaranteed by the type, but it is the property that makes the
    // avatars useful — a hash that collided here would be worth knowing about.
    expect(authorColor('ada@lab.edu', 'Ada')).not.toBe(authorColor('bob@lab.edu', 'Bob'))
  })
})

describe('hashString', () => {
  it('is deterministic and unsigned', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).toBeGreaterThanOrEqual(0)
  })

  it('separates near-identical inputs', () => {
    expect(hashString('ada@lab.edu')).not.toBe(hashString('adb@lab.edu'))
  })
})

describe('initials', () => {
  it('takes the first and last name', () => {
    expect(initials('Ada Lovelace', 'a@b.c')).toBe('AL')
  })

  it('uses the middle name for nobody', () => {
    expect(initials('Ada Byron Lovelace', 'a@b.c')).toBe('AL')
  })

  it('falls back to the email local part when there is no name', () => {
    expect(initials('', 'ada.lovelace@lab.edu')).toBe('AL')
    expect(initials('', 'ada@lab.edu')).toBe('A')
  })

  it('never returns an empty label', () => {
    expect(initials('', '')).toBe('?')
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-08-19T12:00:00Z')

  it('describes the recent past in the unit that fits', () => {
    expect(relativeTime('2026-08-19T11:59:30Z', now)).toBe('just now')
    expect(relativeTime('2026-08-19T11:46:00Z', now)).toBe('14m ago')
    expect(relativeTime('2026-08-19T09:00:00Z', now)).toBe('3h ago')
    expect(relativeTime('2026-08-17T12:00:00Z', now)).toBe('2d ago')
  })

  it('switches to a date once a week has passed', () => {
    const out = relativeTime('2026-07-04T12:00:00Z', now)
    expect(out).not.toMatch(/ago/)
    expect(out).toMatch(/Jul/)
  })

  it('says nothing rather than NaN for an unparseable date', () => {
    expect(relativeTime('not a date', now)).toBe('')
  })
})
