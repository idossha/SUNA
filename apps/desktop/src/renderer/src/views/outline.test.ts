import { describe, expect, it } from 'vitest'
import type { OutlineSection } from '@suna/markdown'
import { outlineRows } from './outline'

const sections: OutlineSection[] = [
  { level: 0, title: '', headingFrom: 0, from: 0, to: 10, words: 8 },
  { level: 1, title: 'Results', headingFrom: 10, from: 20, to: 60, words: 3 },
  { level: 2, title: 'Spectroscopy', headingFrom: 60, from: 76, to: 120, words: 12 },
  { level: 3, title: 'Kinematics', headingFrom: 120, from: 134, to: 160, words: 5 }
]

describe('outlineRows', () => {
  it('maps sections in document order', () => {
    const rows = outlineRows(sections)
    expect(rows.map((r) => r.label)).toEqual([null, 'Results', 'Spectroscopy', 'Kinematics'])
  })

  it('maps heading levels to chips, with an empty chip for the untitled leading section', () => {
    const rows = outlineRows(sections)
    expect(rows.map((r) => r.chip)).toEqual(['', 'A', 'B', 'C'])
  })

  it('derives depth from heading level for sidebar indentation', () => {
    const rows = outlineRows(sections)
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 2])
  })

  it('carries headingFrom and words straight through from the outline section', () => {
    const rows = outlineRows(sections)
    expect(rows.map((r) => r.headingFrom)).toEqual([0, 10, 60, 120])
    expect(rows.map((r) => r.words)).toEqual([8, 3, 12, 5])
  })

  it('assigns unique stable keys', () => {
    const rows = outlineRows(sections)
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('maps a level-4+ heading to the "C" chip too', () => {
    const rows = outlineRows([
      { level: 4, title: 'Deep', headingFrom: 0, from: 6, to: 6, words: 0 }
    ])
    expect(rows[0]?.chip).toBe('C')
    expect(rows[0]?.depth).toBe(3)
  })

  it('returns an empty list for an empty outline', () => {
    expect(outlineRows([])).toEqual([])
  })
})
