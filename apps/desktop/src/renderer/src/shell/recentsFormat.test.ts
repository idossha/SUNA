import { describe, expect, it } from 'vitest'
import { parentPath, toRecentProjectRow } from './recentsFormat'

describe('parentPath', () => {
  it('returns the containing directory', () => {
    expect(parentPath('/work/papers/my-project')).toBe('/work/papers')
  })

  it('keeps the lone separator for a top-level path', () => {
    expect(parentPath('/my-project')).toBe('/')
  })

  it('trims trailing separators before splitting', () => {
    expect(parentPath('/work/papers/my-project/')).toBe('/work/papers')
    expect(parentPath('/work/papers/my-project///')).toBe('/work/papers')
  })

  it('handles windows-style separators', () => {
    expect(parentPath('C:\\Users\\me\\papers\\proj')).toBe('C:\\Users\\me\\papers')
  })

  it('returns an empty string when there is no separator to split on', () => {
    expect(parentPath('project')).toBe('')
  })
})

describe('toRecentProjectRow', () => {
  const now = new Date('2026-08-15T12:00:00.000Z').getTime()

  it('derives the display row from a recents entry', () => {
    const row = toRecentProjectRow(
      { path: '/work/papers/exo', name: 'Exo survey', lastOpenedAt: '2026-08-15T10:00:00.000Z', exists: true },
      now
    )
    expect(row).toEqual({
      path: '/work/papers/exo',
      name: 'Exo survey',
      parentPath: '/work/papers',
      timeLabel: '2h ago',
      missing: false
    })
  })

  it('flags a deleted project as missing', () => {
    const row = toRecentProjectRow(
      { path: '/work/gone', name: 'Gone', lastOpenedAt: '2026-08-15T10:00:00.000Z', exists: false },
      now
    )
    expect(row.missing).toBe(true)
    expect(row.parentPath).toBe('/work')
  })

  it('defaults `now` to the current clock when omitted', () => {
    const justNow = new Date().toISOString()
    const row = toRecentProjectRow({ path: '/a/b', name: 'b', lastOpenedAt: justNow, exists: true })
    expect(row.timeLabel).toBe('just now')
  })
})
