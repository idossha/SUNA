import { describe, expect, it } from 'vitest'
import { assignNumbers, type BibEntry } from '@suna/bib'
import { collectClusters, orderedReferences } from './citations'

function entry(key: string, family: string, year: string): BibEntry {
  return {
    key,
    entryType: 'article',
    title: `${family} on ${key}`,
    authors: [{ kind: 'person', family }],
    year,
    raw: {}
  }
}

describe('collectClusters', () => {
  it('collects bracket and bare citations in order of appearance', () => {
    const clusters = collectClusters(
      'Stripping [@gunn1972] is common [@cortese2021; @boselli2022], see @poggianti2017.'
    )
    expect(clusters.map((c) => c.keys)).toEqual([
      ['gunn1972'],
      ['cortese2021', 'boselli2022'],
      ['poggianti2017']
    ])
    expect(clusters.map((c) => c.narrative)).toEqual([false, false, true])
  })

  it('ignores citation-like text inside code and math', () => {
    const clusters = collectClusters('A real one [@real].\n\n```\n[@fake]\n```\n\n$x_{@nope}$\n')
    expect(clusters.map((c) => c.keys)).toEqual([['real']])
  })

  it('returns no clusters for plain prose', () => {
    expect(collectClusters('No citations here, just an email a@b.')).toEqual([])
  })
})

describe('orderedReferences', () => {
  const clusters = [['b-key'], ['a-key', 'missing'], ['b-key', 'c-key']]
  const numbers = assignNumbers(clusters)
  const entries = new Map<string, BibEntry>([
    ['a-key', entry('a-key', 'Zhou', '2019')],
    ['b-key', entry('b-key', 'Abt', '2021')],
    ['c-key', entry('c-key', 'Meier', '2020')]
  ])

  it('orders by first appearance for numeric profiles', () => {
    const rows = orderedReferences(numbers, entries, 'appearance')
    expect(rows.map((r) => r.key)).toEqual(['b-key', 'a-key', 'c-key', 'missing'])
    expect(rows.map((r) => r.number)).toEqual([1, 2, 4, 3])
  })

  it('orders alphabetically for author-year profiles', () => {
    const rows = orderedReferences(numbers, entries, 'alphabetical')
    expect(rows.map((r) => r.key)).toEqual(['b-key', 'c-key', 'a-key', 'missing'])
  })

  it('flags unknown keys by leaving entry undefined, sunk to the end', () => {
    const rows = orderedReferences(numbers, entries, 'appearance')
    const last = rows[rows.length - 1]
    expect(last?.key).toBe('missing')
    expect(last?.entry).toBeUndefined()
  })
})
