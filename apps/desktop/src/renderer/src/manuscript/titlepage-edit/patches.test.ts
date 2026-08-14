import { describe, expect, it } from 'vitest'
import type { Affiliation, Author } from '@suna/core'
import {
  abstractPatch,
  addHighlight,
  affiliationsPatch,
  articleTypePatch,
  authorsPatch,
  blankAffiliation,
  blankAuthor,
  highlightsPatch,
  isValidEmail,
  isValidOrcid,
  moveAffiliationById,
  moveAuthorById,
  moveItem,
  nextId,
  removeAffiliationById,
  removeAuthorById,
  removeHighlight,
  reorderHighlight,
  shortTitlePatch,
  significancePatch,
  titlePatch,
  toggleAffiliationRef,
  updateAffiliation,
  updateAuthor,
  updateHighlight,
  validateAffiliations,
  validateAuthors
} from './patches'

function author(overrides: Partial<Author> = {}): Author {
  return {
    id: 'a1',
    given: 'Ada',
    family: 'Researcher',
    nativeScript: null,
    orcid: null,
    affiliationRefs: [],
    corresponding: false,
    email: null,
    equalContribution: false,
    deceased: false,
    ...overrides
  }
}

function affiliation(overrides: Partial<Affiliation> = {}): Affiliation {
  return { id: 'af1', text: 'Example University', ...overrides }
}

describe('scalar field patches', () => {
  it('builds the smallest patch for each top-level field', () => {
    expect(titlePatch('New title')).toEqual({ title: 'New title' })
    expect(shortTitlePatch('Running')).toEqual({ shortTitle: 'Running' })
    expect(articleTypePatch('review')).toEqual({ articleType: 'review' })
    expect(abstractPatch('Body text')).toEqual({ abstract: { content: 'Body text' } })
  })

  it('clears significance to null when the text is blank (schema forbids empty string)', () => {
    expect(significancePatch('')).toEqual({ significance: null })
    expect(significancePatch('   ')).toEqual({ significance: null })
    expect(significancePatch('Matters because…')).toEqual({ significance: 'Matters because…' })
  })
})

describe('array field patches', () => {
  it('replaces highlights wholesale, nulling out an emptied list', () => {
    expect(highlightsPatch([])).toEqual({ highlights: null })
    expect(highlightsPatch(['First', 'Second'])).toEqual({ highlights: ['First', 'Second'] })
  })

  it('replaces authors/affiliations wholesale as plain arrays', () => {
    const authors = [author()]
    const affiliations = [affiliation()]
    expect(authorsPatch(authors)).toEqual({ authors })
    expect(affiliationsPatch(affiliations)).toEqual({ affiliations })
    // defensive copies, not the same array reference
    expect(authorsPatch(authors).authors).not.toBe(authors)
  })
})

describe('ORCID validation', () => {
  it('accepts a well-formed ORCID (numeric and X check-digit)', () => {
    expect(isValidOrcid('0000-0002-1825-0097')).toBe(true)
    expect(isValidOrcid('0000-0002-1825-009X')).toBe(true)
  })

  it('rejects malformed ORCIDs', () => {
    expect(isValidOrcid('bad-orcid')).toBe(false)
    expect(isValidOrcid('0000-0002-1825')).toBe(false)
    expect(isValidOrcid('0000-0002-1825-00970')).toBe(false)
    expect(isValidOrcid('')).toBe(false)
  })
})

describe('email validation', () => {
  it('accepts simple addresses and rejects obviously malformed ones', () => {
    expect(isValidEmail('ada@observatory.edu')).toBe(true)
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('missing@domain')).toBe(false)
    expect(isValidEmail('@no-local.com')).toBe(false)
  })
})

describe('validateAuthors', () => {
  it('requires at least one author', () => {
    expect(validateAuthors([])).toMatch(/at least one author/i)
  })

  it('requires non-empty given/family', () => {
    expect(validateAuthors([author({ given: '' })])).toMatch(/given name/i)
    expect(validateAuthors([author({ family: '  ' })])).toMatch(/family name/i)
  })

  it('rejects a malformed ORCID and a malformed email', () => {
    expect(validateAuthors([author({ orcid: 'nope' })])).toMatch(/ORCID/)
    expect(validateAuthors([author({ email: 'nope' })])).toMatch(/email/i)
  })

  it('accepts a fully valid list', () => {
    expect(
      validateAuthors([author({ orcid: '0000-0002-1825-0097', email: 'ada@observatory.edu' })])
    ).toBeNull()
  })
})

describe('validateAffiliations', () => {
  it('rejects blank affiliation text and accepts real text', () => {
    expect(validateAffiliations([affiliation({ text: '   ' })])).toMatch(/cannot be empty/i)
    expect(validateAffiliations([affiliation()])).toBeNull()
  })
})

describe('moveItem', () => {
  it('swaps with the neighbor in the given direction', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op copy at either edge', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('nextId', () => {
  it('is one past the highest existing numeric suffix', () => {
    expect(nextId('a', [{ id: 'a1' }, { id: 'a2' }])).toBe('a3')
    expect(nextId('af', [])).toBe('af1')
    expect(nextId('af', [{ id: 'af1' }, { id: 'af5' }])).toBe('af6')
  })

  it('ignores ids that do not match prefix+digits exactly', () => {
    expect(nextId('a', [{ id: 'a1x' }, { id: 'xa2' }, { id: 'a3' }])).toBe('a4')
  })
})

describe('highlight list ops', () => {
  const list = ['First', 'Second', 'Third']

  it('adds to the end', () => {
    expect(addHighlight(list, 'Fourth')).toEqual(['First', 'Second', 'Third', 'Fourth'])
  })

  it('removes by index', () => {
    expect(removeHighlight(list, 1)).toEqual(['First', 'Third'])
  })

  it('reorders by index', () => {
    expect(reorderHighlight(list, 0, 1)).toEqual(['Second', 'First', 'Third'])
  })

  it('replaces the text at an index, leaving others untouched', () => {
    expect(updateHighlight(list, 1, 'Edited')).toEqual(['First', 'Edited', 'Third'])
  })
})

describe('author list ops', () => {
  it('blankAuthor gets a fresh id and schema-valid placeholder names', () => {
    const a = blankAuthor([author({ id: 'a1' }), author({ id: 'a2' })])
    expect(a.id).toBe('a3')
    expect(a.given.trim()).not.toBe('')
    expect(a.family.trim()).not.toBe('')
    expect(a.affiliationRefs).toEqual([])
  })

  it('updateAuthor patches only the matching row', () => {
    const list = [author({ id: 'a1' }), author({ id: 'a2', given: 'Ben' })]
    const next = updateAuthor(list, 'a2', { given: 'Benjamin' })
    expect(next[0]?.given).toBe('Ada')
    expect(next[1]?.given).toBe('Benjamin')
  })

  it('removeAuthorById drops only the matching row', () => {
    const list = [author({ id: 'a1' }), author({ id: 'a2' })]
    expect(removeAuthorById(list, 'a1').map((a) => a.id)).toEqual(['a2'])
  })

  it('moveAuthorById moves by id regardless of array position', () => {
    const list = [author({ id: 'a1' }), author({ id: 'a2' }), author({ id: 'a3' })]
    expect(moveAuthorById(list, 'a3', -1).map((a) => a.id)).toEqual(['a1', 'a3', 'a2'])
    expect(moveAuthorById(list, 'ghost', -1).map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('toggleAffiliationRef adds then removes', () => {
    expect(toggleAffiliationRef([], 'af1')).toEqual(['af1'])
    expect(toggleAffiliationRef(['af1'], 'af1')).toEqual([])
    expect(toggleAffiliationRef(['af1'], 'af2')).toEqual(['af1', 'af2'])
  })
})

describe('affiliation list ops', () => {
  it('blankAffiliation gets a fresh id and non-empty placeholder text', () => {
    const a = blankAffiliation([affiliation({ id: 'af1' })])
    expect(a.id).toBe('af2')
    expect(a.text.trim()).not.toBe('')
  })

  it('updateAffiliation / removeAffiliationById / moveAffiliationById target by id', () => {
    const list = [affiliation({ id: 'af1' }), affiliation({ id: 'af2', text: 'Other' })]
    expect(updateAffiliation(list, 'af2', { text: 'Renamed' })[1]?.text).toBe('Renamed')
    expect(removeAffiliationById(list, 'af1').map((a) => a.id)).toEqual(['af2'])
    expect(moveAffiliationById(list, 'af2', -1).map((a) => a.id)).toEqual(['af2', 'af1'])
  })
})
