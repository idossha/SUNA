import { describe, expect, it } from 'vitest'
import type { Author } from '@suna/core'
import { authorMarkers, numberAffiliations, splitTexSpans } from './title-page'

function author(id: string, refs: string[], corresponding = false): Author {
  return {
    id,
    given: 'A',
    family: id.toUpperCase(),
    nativeScript: null,
    orcid: null,
    affiliationRefs: refs,
    corresponding,
    email: null,
    equalContribution: false,
    deceased: false
  }
}

describe('splitTexSpans', () => {
  it('splits text and inline math', () => {
    expect(splitTexSpans('Quenching at $z = 1.7$ in clusters')).toEqual([
      { kind: 'text', value: 'Quenching at ' },
      { kind: 'math', value: 'z = 1.7' },
      { kind: 'text', value: ' in clusters' }
    ])
  })

  it('keeps an unclosed dollar as literal text', () => {
    expect(splitTexSpans('Costs $5 and rising')).toEqual([
      { kind: 'text', value: 'Costs $5 and rising' }
    ])
  })

  it('handles adjacent math spans and empty input', () => {
    expect(splitTexSpans('$a$$b$')).toEqual([
      { kind: 'math', value: 'a' },
      { kind: 'math', value: 'b' }
    ])
    expect(splitTexSpans('')).toEqual([])
  })
})

describe('numberAffiliations', () => {
  const affiliations = [
    { id: 'af1', text: 'One' },
    { id: 'af2', text: 'Two' },
    { id: 'af3', text: 'Three (unreferenced)' }
  ]

  it('numbers by first appearance in author order', () => {
    const authors = [author('a1', ['af2', 'af1']), author('a2', ['af1'])]
    const { ordered, numberOf } = numberAffiliations(authors, affiliations)
    expect(ordered.map((a) => a.id)).toEqual(['af2', 'af1', 'af3'])
    expect(numberOf.get('af2')).toBe(1)
    expect(numberOf.get('af1')).toBe(2)
    expect(numberOf.get('af3')).toBe(3)
  })

  it('ignores dangling affiliation refs', () => {
    const { ordered } = numberAffiliations([author('a1', ['ghost', 'af1'])], affiliations)
    expect(ordered.map((a) => a.id)).toEqual(['af1', 'af2', 'af3'])
  })
})

describe('authorMarkers', () => {
  it('emits affiliation numbers in ref order plus the corresponding mark', () => {
    const numberOf = new Map([
      ['af1', 2],
      ['af2', 1]
    ])
    expect(authorMarkers(author('a1', ['af1', 'af2'], true), numberOf)).toEqual(['2', '1', '*'])
    expect(authorMarkers(author('a2', ['af2']), numberOf)).toEqual(['1'])
  })
})
