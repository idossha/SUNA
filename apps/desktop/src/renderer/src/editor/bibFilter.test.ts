import { describe, expect, it } from 'vitest'
import type { BibEntry } from '@suna/bib'
import { authorSummary, filterBibEntries } from './bibFilter'

const smith: BibEntry = {
  key: 'smith2020',
  entryType: 'article',
  title: 'Ram pressure stripping in cluster galaxies',
  authors: [{ kind: 'person', family: 'Smith', given: 'Jane' }],
  year: '2020',
  raw: {}
}

const doeAndRoe: BibEntry = {
  key: 'doe2019',
  entryType: 'article',
  title: 'A survey of galactic winds',
  authors: [
    { kind: 'person', family: 'Doe', given: 'John' },
    { kind: 'person', family: 'Roe', given: 'Ann' }
  ],
  year: '2019',
  raw: {}
}

const literalOrg: BibEntry = {
  key: 'gass2010',
  entryType: 'misc',
  title: 'GASS survey data release',
  authors: [{ kind: 'literal', literal: 'GASS Collaboration' }],
  year: '2010',
  raw: {}
}

const entries = [smith, doeAndRoe, literalOrg]

describe('filterBibEntries', () => {
  it('returns every entry for an empty/whitespace query', () => {
    expect(filterBibEntries(entries, '')).toEqual(entries)
    expect(filterBibEntries(entries, '   ')).toEqual(entries)
  })

  it('matches by citation key, case-insensitively', () => {
    expect(filterBibEntries(entries, 'SMITH2020')).toEqual([smith])
  })

  it('matches by title substring', () => {
    expect(filterBibEntries(entries, 'galactic winds')).toEqual([doeAndRoe])
  })

  it('matches by year', () => {
    expect(filterBibEntries(entries, '2010')).toEqual([literalOrg])
  })

  it('matches by person-author family name', () => {
    expect(filterBibEntries(entries, 'roe')).toEqual([doeAndRoe])
  })

  it('matches by literal (organization) author', () => {
    expect(filterBibEntries(entries, 'collaboration')).toEqual([literalOrg])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterBibEntries(entries, 'nonexistent-key-xyz')).toEqual([])
  })
})

describe('authorSummary', () => {
  it('single author: "Family · Year"', () => {
    expect(authorSummary(smith)).toBe('Jane Smith · 2020')
  })

  it('multiple authors: "First et al. · Year"', () => {
    expect(authorSummary(doeAndRoe)).toBe('John Doe et al. · 2019')
  })

  it('literal author: uses the literal name as-is', () => {
    expect(authorSummary(literalOrg)).toBe('GASS Collaboration · 2010')
  })

  it('no authors at all falls back to just the year', () => {
    const noAuthors: BibEntry = { ...smith, authors: [] }
    expect(authorSummary(noAuthors)).toBe('2020')
  })
})
