import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

const NOW = new Date('2026-08-14T12:00:00.000Z').getTime()

describe('relativeTime', () => {
  it('reports "just now" for sub-5-second gaps', () => {
    expect(relativeTime(new Date(NOW - 2_000).toISOString(), NOW)).toBe('just now')
  })

  it('reports seconds under a minute', () => {
    expect(relativeTime(new Date(NOW - 40_000).toISOString(), NOW)).toBe('40s ago')
  })

  it('reports minutes under an hour', () => {
    expect(relativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago')
  })

  it('reports hours under a day', () => {
    expect(relativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago')
  })

  it('reports days under a month', () => {
    expect(relativeTime(new Date(NOW - 4 * 86_400_000).toISOString(), NOW)).toBe('4d ago')
  })

  it('reports months under a year', () => {
    expect(relativeTime(new Date(NOW - 90 * 86_400_000).toISOString(), NOW)).toBe('3mo ago')
  })

  it('reports years beyond that', () => {
    expect(relativeTime(new Date(NOW - 400 * 86_400_000).toISOString(), NOW)).toBe('1y ago')
  })

  it('falls back to the raw string for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('not-a-date')
  })
})
