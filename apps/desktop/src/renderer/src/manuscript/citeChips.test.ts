import { describe, expect, it } from 'vitest'
import { assignNumbers, type BibEntry, type CitationStyleConfig } from '@suna/bib'
import { citeChipText, parseRawCiteLabel } from './citeChips'

function entry(key: string, families: string[], year: string): BibEntry {
  return {
    key,
    entryType: 'article',
    title: `On ${key}`,
    authors: families.map((family) => ({ kind: 'person' as const, family })),
    year,
    raw: {}
  }
}

const numbers = assignNumbers([['gunn1972'], ['cortese2021', 'boselli2022'], ['poggianti2017']])
const entries = new Map<string, BibEntry>([
  ['gunn1972', entry('gunn1972', ['Gunn', 'Gott'], '1972')],
  ['cortese2021', entry('cortese2021', ['Cortese', 'Catinella', 'Smith'], '2021')],
  ['boselli2022', entry('boselli2022', ['Boselli'], '2022')],
  ['poggianti2017', entry('poggianti2017', ['Poggianti'], '2017')]
])

const superscript: CitationStyleConfig = {
  mode: 'numeric-superscript',
  collapseRanges: true,
  textualTokens: { ref: 'ref.', refs: 'refs' }
}
const parenthetical: CitationStyleConfig = {
  mode: 'parenthetical-numeric',
  collapseRanges: true,
  textualTokens: { ref: 'ref.', refs: 'refs' }
}
const authorYear: CitationStyleConfig = {
  mode: 'author-year',
  collapseRanges: false,
  textualTokens: { ref: 'ref.', refs: 'refs' }
}

describe('parseRawCiteLabel', () => {
  it('parses single- and multi-key raw labels', () => {
    expect(parseRawCiteLabel('[gunn1972]')).toEqual(['gunn1972'])
    expect(parseRawCiteLabel('[cortese2021; boselli2022]')).toEqual([
      'cortese2021',
      'boselli2022'
    ])
  })

  it('rejects resolved and foreign labels', () => {
    expect(parseRawCiteLabel('[12]')).toBeNull() // already numeric
    expect(parseRawCiteLabel('(Gunn & Gott 1972)')).toBeNull()
    expect(parseRawCiteLabel('1,3')).toBeNull()
    expect(parseRawCiteLabel('[]')).toBeNull()
    expect(parseRawCiteLabel('')).toBeNull()
    expect(parseRawCiteLabel(null)).toBeNull()
  })
})

describe('citeChipText', () => {
  it('renders numeric-superscript clusters with collapsed ranges', () => {
    const chip = citeChipText(['gunn1972', 'cortese2021', 'boselli2022'], {
      numbers,
      entries,
      style: superscript
    })
    expect(chip).toEqual({ text: '1–3', form: 'superscript' })
  })

  it('renders parenthetical-numeric clusters inline', () => {
    const chip = citeChipText(['gunn1972', 'poggianti2017'], {
      numbers,
      entries,
      style: parenthetical
    })
    expect(chip).toEqual({ text: '(1, 4)', form: 'inline' })
  })

  it('renders author-year clusters from bib entries', () => {
    const chip = citeChipText(['gunn1972', 'cortese2021'], {
      numbers,
      entries,
      style: authorYear
    })
    expect(chip).toEqual({
      text: '(Gunn & Gott 1972; Cortese et al. 2021)',
      form: 'inline'
    })
  })

  it('keeps the raw chip (null) when a numeric profile has not numbered a key', () => {
    expect(
      citeChipText(['freshlyTyped2026'], { numbers, entries, style: superscript })
    ).toBeNull()
  })

  it('falls back to the key for author-year entries missing from the bib', () => {
    const chip = citeChipText(['missingKey'], { numbers, entries, style: authorYear })
    expect(chip).toEqual({ text: '(missingKey)', form: 'inline' })
  })
})
