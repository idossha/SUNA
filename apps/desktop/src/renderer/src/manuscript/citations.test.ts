import { describe, expect, it } from 'vitest'
import { assignNumbers, type BibEntry } from '@suna/bib'
import {
  buildLabelMap,
  collectClusters,
  collectEquationLabels,
  orderedReferences,
  resolveCrossRefLabel,
  slugifyHeading
} from './citations'

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

describe('slugifyHeading', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyHeading('Methods')).toBe('methods')
    expect(slugifyHeading('Results & Discussion')).toBe('results-discussion')
  })

  it('trims leading and trailing separators', () => {
    expect(slugifyHeading('  Methods!  ')).toBe('methods')
  })
})

describe('collectEquationLabels', () => {
  it('collects labeled and unlabeled display equations in order', () => {
    const source =
      '$$ {#eq:stripping}\nP = 1\n$$\n\nSome text.\n\n$$\nx + y\n$$\n\n$$ {#eq:mass}\nE = mc^2\n$$\n'
    expect(collectEquationLabels(source)).toEqual(['stripping', undefined, 'mass'])
  })

  it('returns an empty list when there is no display math', () => {
    expect(collectEquationLabels('Just prose with $x^2$ inline math.')).toEqual([])
  })
})

describe('buildLabelMap', () => {
  const figures = [{ id: 'fig-spectrum' }, { id: 'fig-velocity-map' }]
  const tables = [{ id: 'tab-observed' }]
  const sections = [
    { heading: null, source: 'Intro.\n\n$$ {#eq:stripping}\nP = 1\n$$\n' },
    { heading: 'Results', source: '$$\nunlabeled\n$$\n' },
    { heading: 'Methods', source: '$$ {#eq:mass}\nE = mc^2\n$$\n' }
  ]

  it('numbers figures and tables by manuscript.json array order', () => {
    const labels = buildLabelMap(figures, tables, sections)
    expect(labels.figures.get('fig-spectrum')).toBe('Fig. 1')
    expect(labels.figures.get('fig-velocity-map')).toBe('Fig. 2')
    expect(labels.tables.get('tab-observed')).toBe('Table 1')
  })

  it('numbers every display equation across sections, labeled or not', () => {
    const labels = buildLabelMap(figures, tables, sections)
    expect(labels.equations.get('stripping')).toBe('equation (1)')
    expect(labels.equations.get('mass')).toBe('equation (3)')
  })

  // The display equation's own right-margin chip needs the bare number; the
  // prose form ("equation (1)") would have to be re-parsed to get at it.
  it('exposes the same equation numbering as bare numbers', () => {
    const labels = buildLabelMap(figures, tables, sections)
    expect(labels.equationNumbers.get('stripping')).toBe(1)
    expect(labels.equationNumbers.get('mass')).toBe(3)
    expect(labels.equationNumbers.has('unlabeled')).toBe(false)
    expect(labels.equationNumbers.size).toBe(labels.equations.size)
  })

  it('maps a slugified heading to its display text, skipping unheaded sections', () => {
    const labels = buildLabelMap(figures, tables, sections)
    expect(labels.sections.get('results')).toBe('Results')
    expect(labels.sections.get('methods')).toBe('Methods')
    expect(labels.sections.size).toBe(2)
  })

  it('honors custom label words', () => {
    const labels = buildLabelMap(figures, tables, sections, { figure: 'Figure', table: 'Tab.' })
    expect(labels.figures.get('fig-spectrum')).toBe('Figure 1')
    expect(labels.tables.get('tab-observed')).toBe('Tab. 1')
  })
})

describe('resolveCrossRefLabel', () => {
  const labels = buildLabelMap(
    [{ id: 'fig-spectrum' }, { id: 'fig-velocity-map' }],
    [{ id: 'tab-observed' }],
    [{ heading: null, source: '$$ {#eq:stripping}\nP = 1\n$$\n' }, { heading: 'Methods', source: '' }]
  )

  it('resolves a figure crossRef with a panel suffix appended directly', () => {
    expect(resolveCrossRefLabel('fig', 'fig-spectrum', 'a', labels)).toEqual({
      text: 'Fig. 1a',
      resolved: true
    })
  })

  it('resolves an equation crossRef to its number', () => {
    expect(resolveCrossRefLabel('eq', 'stripping', undefined, labels)).toEqual({
      text: 'equation (1)',
      resolved: true
    })
  })

  it('resolves a section crossRef by slug', () => {
    expect(resolveCrossRefLabel('sec', 'methods', undefined, labels)).toEqual({
      text: 'Methods',
      resolved: true
    })
  })

  it('keeps the raw "kind:id" text and flags unresolved ids, never blank', () => {
    expect(resolveCrossRefLabel('fig', 'nope', undefined, labels)).toEqual({
      text: 'fig:nope',
      resolved: false
    })
  })
})
