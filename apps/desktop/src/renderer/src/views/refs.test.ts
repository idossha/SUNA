import { describe, expect, it } from 'vitest'
import type { BibEntry } from '@suna/bib'
import { BUNDLED_PROFILE_IDS, getBundledProfile } from '@suna/formatter'
import { citeStyleOf, entryMatches, firstAuthorOf, maxAuthorsFor } from './refs'

const natureTruncation = { etAlAllowed: true, truncateWhenMoreThan: 5, keepFirstN: 1 }

describe('maxAuthorsFor', () => {
  it('keeps the full list at or below the threshold', () => {
    expect(maxAuthorsFor(natureTruncation, 5)).toBe(5)
    expect(maxAuthorsFor(natureTruncation, 1)).toBe(1)
  })

  it('truncates to keepFirstN above the threshold', () => {
    expect(maxAuthorsFor(natureTruncation, 12)).toBe(1)
  })

  it('falls back to the threshold when keepFirstN is unstated', () => {
    expect(maxAuthorsFor({ etAlAllowed: true, truncateWhenMoreThan: 8, keepFirstN: null }, 9)).toBe(8)
  })

  it('never truncates when et al. is disallowed or unstated', () => {
    expect(maxAuthorsFor({ etAlAllowed: false, truncateWhenMoreThan: 3, keepFirstN: 1 }, 9)).toBe(9)
    expect(maxAuthorsFor({ etAlAllowed: null, truncateWhenMoreThan: null, keepFirstN: null }, 4)).toBe(4)
  })
})

describe('citeStyleOf over the bundled profiles', () => {
  it('yields a complete style config for every bundled profile', () => {
    for (const id of BUNDLED_PROFILE_IDS) {
      const profile = getBundledProfile(id)
      expect(profile, id).not.toBeNull()
      if (profile === null) continue
      const style = citeStyleOf(profile.citations)
      expect(['numeric-superscript', 'author-year', 'parenthetical-numeric']).toContain(style.mode)
      expect(typeof style.collapseRanges).toBe('boolean')
      expect(style.textualTokens.ref.length).toBeGreaterThan(0)
    }
  })
})

const entry: BibEntry = {
  key: 'gunn1972',
  entryType: 'article',
  title: 'On the infall of matter into clusters of galaxies',
  authors: [
    { kind: 'person', family: 'Gunn', given: 'James E.' },
    { kind: 'person', family: 'Gott', given: 'J. Richard' }
  ],
  year: '1972',
  journal: 'The Astrophysical Journal',
  raw: {}
}

describe('firstAuthorOf / entryMatches', () => {
  it('names the first author family', () => {
    expect(firstAuthorOf(entry)).toBe('Gunn')
    expect(firstAuthorOf({ ...entry, authors: [] })).toBe('—')
    expect(firstAuthorOf({ ...entry, authors: [{ kind: 'literal', literal: 'LIGO Collaboration' }] })).toBe(
      'LIGO Collaboration'
    )
  })

  it('filters case-insensitively across key, title, authors, year', () => {
    expect(entryMatches(entry, '')).toBe(true)
    expect(entryMatches(entry, 'GUNN')).toBe(true)
    expect(entryMatches(entry, 'infall of matter')).toBe(true)
    expect(entryMatches(entry, '1972')).toBe(true)
    expect(entryMatches(entry, 'quasar')).toBe(false)
  })
})
