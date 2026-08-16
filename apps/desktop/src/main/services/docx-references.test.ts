import { describe, expect, it } from 'vitest'
import type { Block } from './docx-html'
import { isCitationRun } from './docx-heuristics'
import {
  assignCiteKeys,
  collectRawEntries,
  extractReferences,
  findReferencesHeadingIndex,
  parseReferenceEntry,
  rewriteBlocksCitations
} from './docx-references'

const p = (text: string): Block => ({ kind: 'paragraph', runs: [{ text }] })
const h = (level: number, text: string): Block => ({ kind: 'heading', level, runs: [{ text }] })

describe('findReferencesHeadingIndex', () => {
  it('finds a heading matching references/bibliography/works cited', () => {
    expect(findReferencesHeadingIndex([h(1, 'Introduction'), h(1, 'References')])).toBe(1)
    expect(findReferencesHeadingIndex([h(2, 'Bibliography')])).toBe(0)
    expect(findReferencesHeadingIndex([h(1, 'Works Cited')])).toBe(0)
    expect(findReferencesHeadingIndex([h(1, 'Introduction')])).toBeNull()
  })
})

describe('collectRawEntries', () => {
  it('flattens a genuine <ol> list, one entry per <li>, stopping at the next h1/h2', () => {
    const blocks: Block[] = [
      h(1, 'References'),
      { kind: 'list', ordered: true, items: [[{ text: 'Entry one.' }], [{ text: 'Entry two.' }]] },
      h(1, 'Acknowledgements'),
      p('Thanks.')
    ]
    const { entries, endIndex } = collectRawEntries(blocks, 0)
    expect(entries).toEqual([
      { raw: 'Entry one.', listNumber: 1 },
      { raw: 'Entry two.', listNumber: 2 }
    ])
    expect(endIndex).toBe(2)
  })

  it('falls back to one paragraph per entry when there is no list (hanging-indent author-year style)', () => {
    const blocks: Block[] = [h(1, 'References'), p('Smith, J. (2020). A title. J. Sleep, 1, 1-2.'), p('Jones, K. (2019). Another. J. Sleep, 2, 3-4.')]
    const { entries } = collectRawEntries(blocks, 0)
    expect(entries.map((e) => e.raw)).toEqual([
      'Smith, J. (2020). A title. J. Sleep, 1, 1-2.',
      'Jones, K. (2019). Another. J. Sleep, 2, 3-4.'
    ])
    expect(entries.every((e) => e.listNumber === null)).toBe(true)
  })
})

describe('parseReferenceEntry — numbered', () => {
  it('parses a "1. Author, A. (Year). Title. Journal, vol, pages." entry', () => {
    const result = parseReferenceEntry('1. Smith, J. (2020). A title about sleep. J. Sleep, 1, 1-2.', null)
    expect(result.style).toBe('numbered')
    expect(result.number).toBe(1)
    expect(result.authors).toEqual(['Smith, J.'])
    expect(result.year).toBe('2020')
    expect(result.title).toBe('A title about sleep')
    expect(result.journal).toBe('J. Sleep, 1, 1-2')
  })

  it('parses a "[N] ..." bracket-numbered entry', () => {
    const result = parseReferenceEntry('[3] Jones, K., Lee, M. (2019). Another study. Nature, 5, 9-10.', null)
    expect(result.style).toBe('numbered')
    expect(result.number).toBe(3)
    expect(result.authors).toEqual(['Jones, K.', 'Lee, M.'])
  })

  it('uses the list position as the number when the source was a real <ol> and no leading digit is present', () => {
    const result = parseReferenceEntry('Smith, J. (2020). A title. J. Sleep, 1, 1-2.', 7)
    expect(result.number).toBe(7)
    expect(result.style).toBe('numbered')
  })
})

describe('parseReferenceEntry — vancouver', () => {
  it('detects "Family AB, Family2 CD." author style and does not comma-split within a name', () => {
    const result = parseReferenceEntry(
      '1. Smith AB, Jones CD, Lee EF. Title of the article. J Sleep. 2020;12(3):45-67.',
      null
    )
    expect(result.style).toBe('vancouver')
    expect(result.authors).toEqual(['Smith AB', 'Jones CD', 'Lee EF'])
    expect(result.year).toBe('2020')
    expect(result.title).toBe('Title of the article')
  })
})

describe('parseReferenceEntry — author-year', () => {
  it('parses "Author, A. (Year). Title. Journal, vol, pages." with no leading number', () => {
    const result = parseReferenceEntry('Smith, J., & Jones, K. (2020). A title about sleep. Journal of Sleep, 12(3), 45-67.', null)
    expect(result.style).toBe('author-year')
    expect(result.number).toBeNull()
    expect(result.authors).toEqual(['Smith, J.', 'Jones, K.'])
    expect(result.year).toBe('2020')
    expect(result.title).toBe('A title about sleep')
  })
})

describe('parseReferenceEntry — unrecognized', () => {
  it('never drops the entry: falls back to the raw text as the title with style "unknown"', () => {
    const result = parseReferenceEntry('Just some unstructured note with no year at all', null)
    expect(result.style).toBe('unknown')
    expect(result.title).toBe('Just some unstructured note with no year at all')
    expect(result.year).toBeNull()
  })
})

describe('assignCiteKeys', () => {
  it('dedupes colliding keys with a/b/c suffixes', () => {
    const parsed = [
      parseReferenceEntry('1. Smith, J. (2020). A title. J. Sleep, 1, 1-2.', null),
      parseReferenceEntry('2. Smith, J. (2020). A title. J. Sleep, 3, 4-5.', null)
    ]
    const withKeys = assignCiteKeys(parsed)
    expect(withKeys[0]?.citeKey).not.toBe(withKeys[1]?.citeKey)
    expect(new Set(withKeys.map((r) => r.citeKey)).size).toBe(2)
  })
})

describe('extractReferences (end to end)', () => {
  it('detects the section, parses every entry, and assigns keys', () => {
    const blocks: Block[] = [
      h(1, 'Introduction'),
      p('Body.'),
      h(1, 'References'),
      { kind: 'list', ordered: true, items: [[{ text: 'Smith, J. (2020). A title. J. Sleep, 1, 1-2.' }]] }
    ]
    const result = extractReferences(blocks)
    expect(result.headingIndex).toBe(2)
    expect(result.references).toHaveLength(1)
    expect(result.references[0]?.citeKey).toMatch(/^smith2020/)
  })
})

describe('rewriteBlocksCitations — numeric styles (unambiguous vs ambiguous)', () => {
  const refs = assignCiteKeys([
    parseReferenceEntry('1. Smith, J. (2020). A title. J. Sleep, 1, 1-2.', null),
    parseReferenceEntry('2. Jones, K. (2019). Another. J. Sleep, 2, 3-4.', null)
  ])

  it('rewrites an unambiguous bracket marker to [@key]', () => {
    const blocks: Block[] = [p('Earlier work [1] showed this.')]
    const result = rewriteBlocksCitations(blocks, refs)
    const paragraph = result.blocks[0]
    if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph')
    const citation = paragraph.runs.find(isCitationRun)
    expect(citation?.text).toBe(`[@${refs[0]?.citeKey}]`)
    expect(result.mappedCount).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })

  it('rewrites a multi-number bracket marker to a semicolon-joined citation', () => {
    const blocks: Block[] = [p('Prior studies [1,2] agree.')]
    const result = rewriteBlocksCitations(blocks, refs)
    const paragraph = result.blocks[0]
    if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph')
    const citation = paragraph.runs.find(isCitationRun)
    expect(citation?.text).toBe(`[@${refs[0]?.citeKey}; @${refs[1]?.citeKey}]`)
  })

  it('rewrites an unambiguous pure-digit superscript run', () => {
    const blocks: Block[] = [{ kind: 'paragraph', runs: [{ text: 'Shown previously' }, { text: '1', sup: true }, { text: '.' }] }]
    const result = rewriteBlocksCitations(blocks, refs)
    const paragraph = result.blocks[0]
    if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.runs.some((r) => isCitationRun(r) && r.text === `[@${refs[0]?.citeKey}]`)).toBe(true)
  })

  it('leaves a marker literal and warns when the number is not in the reference list', () => {
    const blocks: Block[] = [p('Unknown source [5] here.')]
    const result = rewriteBlocksCitations(blocks, refs)
    const paragraph = result.blocks[0]
    if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.runs.some(isCitationRun)).toBe(false)
    expect(runsText(paragraph.runs)).toBe('Unknown source [5] here.')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.code).toBe('citation-ambiguous')
  })

  it('leaves a marker literal and warns when the number is ambiguous (shared by two references)', () => {
    const dupRefs = assignCiteKeys([
      parseReferenceEntry('1. Smith, J. (2020). A title. J. Sleep, 1, 1-2.', null),
      parseReferenceEntry('1. Duplicate, D. (2021). Another title. J. Sleep, 2, 3-4.', null)
    ])
    const blocks: Block[] = [p('See [1] for details.')]
    const result = rewriteBlocksCitations(blocks, dupRefs)
    const paragraph = result.blocks[0]
    if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.runs.some(isCitationRun)).toBe(false)
    expect(result.warnings).toHaveLength(1)
  })
})

describe('rewriteBlocksCitations — author-year style', () => {
  const refs = assignCiteKeys([
    parseReferenceEntry('Smith, J. (2020). A title. Journal of Sleep, 12(3), 45-67.', null),
    parseReferenceEntry('Jones, K. (2019). Another title. Journal of Sleep, 11(2), 20-30.', null)
  ])

  it('rewrites an unambiguous "(Family, Year)" parenthetical to [@key]', () => {
    const blocks: Block[] = [p('This was already known (Smith, 2020) in the field.')]
    const result = rewriteBlocksCitations(blocks, refs)
    const paragraph = result.blocks[0]
    if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph')
    const citation = paragraph.runs.find(isCitationRun)
    expect(citation?.text).toBe(`[@${refs[0]?.citeKey}]`)
  })

  it('leaves an unmatched family/year parenthetical literal and warns', () => {
    const blocks: Block[] = [p('An unrelated claim (Nobody, 2020) here.')]
    const result = rewriteBlocksCitations(blocks, refs)
    const paragraph = result.blocks[0]
    if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.runs.some(isCitationRun)).toBe(false)
    expect(result.warnings).toHaveLength(1)
  })
})

function runsText(runs: readonly { text: string }[]): string {
  return runs.map((r) => r.text).join('')
}
