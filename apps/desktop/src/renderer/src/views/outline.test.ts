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

  it('carries headingFrom straight through from the outline section', () => {
    const rows = outlineRows(sections)
    expect(rows.map((r) => r.headingFrom)).toEqual([0, 10, 60, 120])
  })

  it('rolls a subsection\'s words up into its parent heading', () => {
    const rows = outlineRows(sections)
    // Results = 3 + Spectroscopy 12 + Kinematics 5; Spectroscopy = 12 + 5
    expect(rows.map((r) => r.words)).toEqual([8, 20, 17, 5])
  })

  it('stops the roll-up at the next sibling, and never rolls into the untitled section', () => {
    const rows = outlineRows([
      { level: 0, title: '', headingFrom: 0, from: 0, to: 4, words: 7 },
      { level: 1, title: 'Methods', headingFrom: 4, from: 14, to: 20, words: 1 },
      { level: 2, title: 'Data', headingFrom: 20, from: 27, to: 40, words: 10 },
      { level: 1, title: 'Results', headingFrom: 40, from: 50, to: 60, words: 4 }
    ])
    expect(rows.map((r) => r.words)).toEqual([7, 11, 10, 4])
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
