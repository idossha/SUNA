import { describe, expect, it } from 'vitest'
import { assignNumbers, type BibEntry, type CitationStyleConfig } from '@suna/bib'
import {
  citeChipText,
  figureCaptionText,
  parseRawCiteLabel,
  parseRawEqLabel,
  parseRawXref
} from './citeChips'

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

describe('parseRawXref', () => {
  it('parses a bare "kind:id" widget with no panel title', () => {
    expect(parseRawXref('fig:fig-spectrum', '')).toEqual({
      kind: 'fig',
      id: 'fig-spectrum',
      suffix: undefined
    })
  })

  it('reads the panel suffix out of the widget title', () => {
    expect(parseRawXref('fig:fig-spectrum', 'panel a')).toEqual({
      kind: 'fig',
      id: 'fig-spectrum',
      suffix: 'a'
    })
  })

  it('parses every crossRef kind', () => {
    expect(parseRawXref('tbl:tab-observed', '')?.kind).toBe('tbl')
    expect(parseRawXref('eq:stripping', '')?.kind).toBe('eq')
    expect(parseRawXref('sec:methods', '')?.kind).toBe('sec')
  })

  it('rejects unknown kinds, resolved text, and null', () => {
    expect(parseRawXref('data:release', '')).toBeNull()
    expect(parseRawXref('Fig. 1', '')).toBeNull()
    expect(parseRawXref(null, '')).toBeNull()
  })
})

describe('parseRawEqLabel', () => {
  it('reads the id out of a raw live-preview equation label chip', () => {
    expect(parseRawEqLabel('(eq:stripping)')).toBe('stripping')
  })

  it('accepts ids with the punctuation the label grammar allows', () => {
    expect(parseRawEqLabel('(eq:mass-loss.v2)')).toBe('mass-loss.v2')
  })

  it('rejects an already-numbered chip, a foreign chip, and null', () => {
    expect(parseRawEqLabel('(1)')).toBeNull()
    expect(parseRawEqLabel('(fig:spectrum)')).toBeNull()
    expect(parseRawEqLabel('(eq:)')).toBeNull()
    expect(parseRawEqLabel(null)).toBeNull()
  })
})

describe('figureCaptionText', () => {
  const labels = {
    figures: new Map([['fig-spectrum', 'Fig. 1']]),
    tables: new Map<string, string>(),
    equations: new Map<string, string>(),
    equationNumbers: new Map<string, number>(),
    sections: new Map<string, string>()
  }

  it('numbers a figure the label map knows', () => {
    expect(figureCaptionText('fig-spectrum', { labels })).toEqual({
      text: 'Fig. 1',
      numbered: true
    })
  })

  it('keeps the raw id for a figure nothing matches, rather than blanking it', () => {
    expect(figureCaptionText('nope', { labels })).toEqual({ text: 'fig:nope', numbered: false })
  })

  it('keeps the raw id before any labels have been computed', () => {
    // the manuscript tab renders before the label map resolves; a figure must
    // still say what it is rather than flashing an empty caption
    expect(figureCaptionText('fig-spectrum', null)).toEqual({
      text: 'fig:fig-spectrum',
      numbered: false
    })
  })
})
