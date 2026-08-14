import { describe, expect, it } from 'vitest'
import { formatAuthors, formatCitedBy, formatYearVenue } from './result-format'

describe('formatAuthors', () => {
  it('joins up to three authors as-is', () => {
    expect(formatAuthors(['Ada Lovelace'])).toBe('Ada Lovelace')
    expect(formatAuthors(['Ada Lovelace', 'Alan Turing'])).toBe('Ada Lovelace, Alan Turing')
    expect(formatAuthors(['A', 'B', 'C'])).toBe('A, B, C')
  })

  it('truncates to the first three with "et al." beyond that', () => {
    expect(formatAuthors(['A', 'B', 'C', 'D'])).toBe('A, B, C et al.')
    expect(formatAuthors(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C et al.')
  })

  it('falls back to a placeholder for an empty author list', () => {
    expect(formatAuthors([])).toBe('Unknown authors')
  })
})

describe('formatYearVenue', () => {
  it('joins year and venue with a middle dot', () => {
    expect(formatYearVenue(2019, 'Nature Astronomy')).toBe('2019 · Nature Astronomy')
  })

  it('drops whichever half is missing without a dangling separator', () => {
    expect(formatYearVenue(2019, null)).toBe('2019')
    expect(formatYearVenue(null, 'Nature Astronomy')).toBe('Nature Astronomy')
    expect(formatYearVenue(null, null)).toBe('')
  })

  it('treats an empty-string venue the same as null', () => {
    expect(formatYearVenue(2019, '')).toBe('2019')
  })
})

describe('formatCitedBy', () => {
  it('pluralizes correctly and adds thousands separators', () => {
    expect(formatCitedBy(0)).toBe('0 citations')
    expect(formatCitedBy(1)).toBe('1 citation')
    expect(formatCitedBy(1204)).toBe('1,204 citations')
  })

  it('is empty when the provider gave no count', () => {
    expect(formatCitedBy(null)).toBe('')
  })
})
