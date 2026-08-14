import { describe, expect, it } from 'vitest'
import type { LitResult } from '@suna/core'
import { parseBibtex } from './parse.js'
import { appendLitResultToBib } from './bib-write.js'

const gunn: LitResult = {
  source: 'crossref',
  id: '10.1086/151605',
  doi: '10.1086/151605',
  title: 'On the infall of matter into clusters of galaxies',
  authors: ['James E. Gunn', 'J. Richard Gott'],
  year: 1972,
  venue: 'The Astrophysical Journal',
  citedByCount: 3021,
  openAccessUrl: null,
  abstract: null
}

const EXISTING = `@article{gunn1972infall,
  title = {Some other paper},
  year = {1999}
}
`

describe('appendLitResultToBib', () => {
  it('appends a new entry to an empty file', () => {
    const outcome = appendLitResultToBib('', gunn)
    expect(outcome.key).toBe('gunn1972infall')
    expect(outcome.text).toContain('@article{gunn1972infall,')
    expect(outcome.text).toContain('title = {On the infall of matter into clusters of galaxies}')
    expect(outcome.parseErrors).toEqual([])
  })

  it('dedupes the key against an entry already in the file, appending after it untouched', () => {
    const outcome = appendLitResultToBib(EXISTING, gunn)
    expect(outcome.key).toBe('gunn1972infalla')
    // the original entry's exact text survives byte-for-byte
    expect(outcome.text.startsWith(EXISTING.trimEnd())).toBe(true)
    expect(outcome.text).toContain('@article{gunn1972infalla,')
  })

  it('produces a file the parser round-trips with no new errors', () => {
    const outcome = appendLitResultToBib(EXISTING, gunn)
    const reparsed = parseBibtex(outcome.text)
    expect(reparsed.errors).toEqual([])
    expect(reparsed.entries).toHaveLength(2)
    expect(reparsed.entries.map((e) => e.key)).toEqual(['gunn1972infall', 'gunn1972infalla'])
  })

  it('separates a fresh append with exactly one blank line', () => {
    const outcome = appendLitResultToBib(EXISTING, gunn)
    expect(outcome.text).toBe(`${EXISTING.trimEnd()}\n\n@article{gunn1972infalla,\n  author = {Gunn, James E. and Gott, J. Richard},\n  title = {On the infall of matter into clusters of galaxies},\n  journal = {The Astrophysical Journal},\n  year = {1972},\n  doi = {10.1086/151605}\n}\n`)
  })

  it('surfaces (but does not drop) a pre-existing parse error', () => {
    const broken = `${EXISTING}\n@article{oops,\n  title = {unterminated\n`
    const outcome = appendLitResultToBib(broken, gunn)
    expect(outcome.parseErrors.length).toBeGreaterThan(0)
    // the malformed source text is still present, untouched, in the output
    expect(outcome.text).toContain('@article{oops,')
    expect(outcome.text).toContain('title = {unterminated')
  })
})
