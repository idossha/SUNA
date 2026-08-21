import { describe, expect, it } from 'vitest'
import { PDF_EVIDENCE_IDS, type LibraryAcquireOutcome, type PdfMatch } from '@suna/core'
import type { BibEntry, PdfResolution } from '@suna/bib'
import { BUNDLED_PROFILE_IDS, getBundledProfile } from '@suna/formatter'
import {
  acquireNote,
  autoOpenPdfPath,
  citeStyleOf,
  describeEvidence,
  entryMatches,
  removablePdfPath,
  deleteExplanation,
  removeNote,
  evidenceLabel,
  firstAuthorOf,
  litResultForEntry,
  maxAuthorsFor,
  pdfBadgeTitle,
  shortenPath,
  sourceHost
} from './refs'

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

describe('pdfBadgeTitle', () => {
  it('names every resolution mechanism, distinctly', () => {
    const fileField = pdfBadgeTitle('file-field')
    const citekey = pdfBadgeTitle('citekey')
    const fuzzy = pdfBadgeTitle('fuzzy')
    for (const label of [fileField, citekey, fuzzy]) expect(label.length).toBeGreaterThan(0)
    expect(new Set([fileField, citekey, fuzzy]).size).toBe(3)
  })
})

describe('autoOpenPdfPath', () => {
  const resolution: PdfResolution = { path: '/proj/references/gunn1972.pdf', how: 'citekey' }

  it('returns the resolved path when the preference is on', () => {
    expect(autoOpenPdfPath(resolution, true)).toBe('/proj/references/gunn1972.pdf')
  })

  it('returns null when the preference is off, even with a resolution', () => {
    expect(autoOpenPdfPath(resolution, false)).toBeNull()
  })

  it('returns null when nothing resolves, preference on or off', () => {
    expect(autoOpenPdfPath(null, true)).toBeNull()
    expect(autoOpenPdfPath(undefined, true)).toBeNull()
    expect(autoOpenPdfPath(null, false)).toBeNull()
  })
})

describe('litResultForEntry', () => {
  it('synthesizes a crossref result from a DOI entry, every unknown field explicitly null', () => {
    const { result, error } = litResultForEntry({ ...entry, doi: '10.1086/151605' })
    expect(error).toBeNull()
    expect(result).toEqual({
      source: 'crossref',
      id: '10.1086/151605',
      doi: '10.1086/151605',
      title: 'On the infall of matter into clusters of galaxies',
      authors: ['James E. Gunn', 'J. Richard Gott'],
      year: 1972,
      venue: 'The Astrophysical Journal',
      citedByCount: null,
      openAccessUrl: null,
      abstract: null
    })
  })

  it("uses source 'arxiv' with the bare id when the entry has one, so the arXiv rungs fire", () => {
    const { result } = litResultForEntry({
      ...entry,
      doi: '10.48550/arXiv.2401.00001',
      arxivId: '2401.00001',
      url: 'https://arxiv.org/abs/2401.00001'
    })
    expect(result?.source).toBe('arxiv')
    expect(result?.id).toBe('2401.00001')
    // The DOI still rides along — the byte and filename DOI rules read it.
    expect(result?.doi).toBe('10.48550/arXiv.2401.00001')
    expect(result?.openAccessUrl).toBe('https://arxiv.org/abs/2401.00001')
  })

  it('falls back to the cite key as the id when there is no DOI and no arXiv id', () => {
    const { result } = litResultForEntry(entry)
    expect(result?.source).toBe('crossref')
    expect(result?.id).toBe('gunn1972')
    expect(result?.doi).toBeNull()
  })

  it('reads a disambiguated year, drops blank authors, and prefers journal over booktitle', () => {
    const { result } = litResultForEntry({
      ...entry,
      year: '1972a',
      booktitle: 'Proceedings of nothing',
      authors: [
        { kind: 'person', family: 'Gunn' },
        { kind: 'literal', literal: '   ' },
        { kind: 'literal', literal: 'LIGO Collaboration' }
      ]
    })
    expect(result?.year).toBe(1972)
    expect(result?.authors).toEqual(['Gunn', 'LIGO Collaboration'])
    expect(result?.venue).toBe('The Astrophysical Journal')
  })

  it('states an unparseable year as null rather than a number that is not one', () => {
    expect(litResultForEntry({ ...entry, year: 'in press' }).result?.year).toBeNull()
    expect(litResultForEntry({ ...entry, year: undefined }).result?.year).toBeNull()
  })

  it('falls back to booktitle when there is no journal, and to null when there is neither', () => {
    const { result } = litResultForEntry({
      ...entry,
      journal: undefined,
      booktitle: 'Proceedings of the 3rd Workshop'
    })
    expect(result?.venue).toBe('Proceedings of the 3rd Workshop')
    expect(litResultForEntry({ ...entry, journal: undefined }).result?.venue).toBeNull()
  })

  it('refuses a titleless entry with a reason instead of substituting the cite key', () => {
    const { result, error } = litResultForEntry({ ...entry, title: '   ' })
    expect(result).toBeNull()
    expect(error).toMatch(/gunn1972/)
    expect(error).toMatch(/no title/)
  })

  it('refuses an entry with nothing at all to identify it by', () => {
    const { result, error } = litResultForEntry({ ...entry, key: '' })
    expect(result).toBeNull()
    expect(error).toMatch(/no DOI, arXiv id or cite key/)
  })
})

describe('shortenPath / sourceHost', () => {
  it('keeps the identifying tail of a long path and the whole of a short one', () => {
    expect(shortenPath('/Users/ada/Zotero/storage/AB12/Gunn 1972.pdf')).toBe(
      '…/storage/AB12/Gunn 1972.pdf'
    )
    expect(shortenPath('/tmp/x.pdf')).toBe('/tmp/x.pdf')
    expect(shortenPath('/a/b/c/d.pdf', 1)).toBe('…/d.pdf')
  })

  it('names the host a download came from, and never invents one', () => {
    expect(sourceHost('https://arxiv.org/pdf/2401.00001')).toBe('arxiv.org')
    expect(sourceHost('https://www.nature.com/articles/x.pdf')).toBe('nature.com')
    expect(sourceHost('not a url')).toBe('not a url')
    expect(sourceHost(null)).toBe('an unnamed source')
  })
})

describe('describeEvidence', () => {
  it('has a legible label for every evidence id @suna/core defines', () => {
    const labels = PDF_EVIDENCE_IDS.map(evidenceLabel)
    for (const label of labels) expect(label.length).toBeGreaterThan(0)
    expect(new Set(labels).size).toBe(PDF_EVIDENCE_IDS.length)
  })

  it('joins several reasons and still answers plainly with none', () => {
    expect(describeEvidence(['doi-in-bytes', 'filename-author-year'])).toBe(
      'the DOI is inside the file, the filename matches the author and year'
    )
    expect(describeEvidence([])).toBe('no stated evidence')
  })
})

describe('acquireNote', () => {
  const outcome = (over: Partial<LibraryAcquireOutcome>): LibraryAcquireOutcome => ({
    acquisition: null,
    path: null,
    relativePath: null,
    source: null,
    matches: [],
    notes: [],
    error: null,
    ...over
  })

  const weak: PdfMatch = {
    path: '/Users/ada/Downloads/gunn-galaxies.pdf',
    sizeBytes: 120_000,
    confidence: 'low',
    evidence: ['filename-title-words']
  }

  it('reports a refusal as the reason main gave, never as "no PDF"', () => {
    const note = acquireNote(
      'gunn1972',
      outcome({ error: 'refusing to file a PDF under cite key "a/b": a cite key is a name, not a path' })
    )
    expect(note).toMatch(/^Could not find a PDF for gunn1972:/)
    expect(note).toMatch(/a cite key is a name/)
  })

  it('says the project already had it, and that nothing was searched', () => {
    const note = acquireNote(
      'gunn1972',
      outcome({
        acquisition: 'already-present',
        path: '/work/paper/references/gunn1972.pdf',
        relativePath: 'references/gunn1972.pdf'
      })
    )
    expect(note).toMatch(/already had references\/gunn1972\.pdf/)
    expect(note).toMatch(/nothing was searched or fetched/)
  })

  it('names the machine path a local copy came from, shortened', () => {
    const note = acquireNote(
      'gunn1972',
      outcome({
        acquisition: 'copied-local',
        path: '/work/paper/references/gunn1972.pdf',
        relativePath: 'references/gunn1972.pdf',
        source: '/Users/ada/Zotero/storage/AB12/Gunn 1972.pdf'
      })
    )
    expect(note).toBe('Copied references/gunn1972.pdf from …/storage/AB12/Gunn 1972.pdf')
  })

  it('names the host a download came from', () => {
    const note = acquireNote(
      'gunn1972',
      outcome({
        acquisition: 'downloaded',
        path: '/work/paper/references/gunn1972.pdf',
        relativePath: 'references/gunn1972.pdf',
        source: 'https://arxiv.org/pdf/2401.00001'
      })
    )
    expect(note).toBe('Downloaded references/gunn1972.pdf from arxiv.org')
  })

  it('says where it looked when there is genuinely no PDF', () => {
    const note = acquireNote('gunn1972', outcome({ acquisition: 'metadata-only' }))
    expect(note).toMatch(/No PDF found for gunn1972/)
    expect(note).toMatch(/project, on this machine, or online/)
    expect(note).toMatch(/cited from its metadata/)
  })

  it('offers the weak candidates instead of claiming nothing matched', () => {
    const note = acquireNote(
      'gunn1972',
      outcome({ acquisition: 'metadata-only', matches: [weak, { ...weak, path: '/tmp/other.pdf' }] })
    )
    expect(note).not.toMatch(/No PDF found/)
    expect(note).toMatch(/…\/ada\/Downloads\/gunn-galaxies\.pdf/)
    expect(note).toMatch(/the filename matches words from the title/)
    expect(note).toMatch(/and 1 other/)
    expect(note).toMatch(/too weak to copy without guessing/)
  })

  it('refuses to claim an outcome when main reported neither one nor an error', () => {
    const note = acquireNote('gunn1972', outcome({}))
    expect(note).toMatch(/no outcome and no reason/)
  })
})

describe('removablePdfPath', () => {
  const root = '/Users/ada/paper'

  it('offers a PDF inside the project references/ folder', () => {
    expect(
      removablePdfPath({ path: `${root}/references/gunn1972.pdf`, how: 'citekey' }, root)
    ).toBe(`${root}/references/gunn1972.pdf`)
  })

  it('refuses a file field pointing outside the project', () => {
    expect(
      removablePdfPath({ path: '/Users/ada/Zotero/storage/AB/gunn.pdf', how: 'file-field' }, root)
    ).toBeNull()
    expect(removablePdfPath({ path: `${root}/figures/gunn.pdf`, how: 'fuzzy' }, root)).toBeNull()
  })

  it('has nothing to delete when no PDF resolved', () => {
    expect(removablePdfPath(null, root)).toBeNull()
    expect(removablePdfPath(undefined, root)).toBeNull()
  })
})

describe('removeNote', () => {
  it('always says what happened to the PDF', () => {
    expect(removeNote('gunn1972', true)).toMatch(/deleted its PDF/)
    expect(removeNote('gunn1972', false)).not.toMatch(/PDF/)
  })
})

describe('deleteExplanation', () => {
  it('names every file the second click removes', () => {
    const withPdf = deleteExplanation('gunn1972', true, false)
    expect(withPdf).toContain('references.bib')
    expect(withPdf).toContain('references/gunn1972.pdf')
    expect(withPdf).toContain('reading notes')
    expect(withPdf).toContain('cannot be undone')
  })

  it('does not promise to delete a PDF that is not there', () => {
    const noPdf = deleteExplanation('gunn1972', false, false)
    expect(noPdf).not.toContain('references/gunn1972.pdf')
    expect(noPdf).toContain('No PDF in this project')
  })

  it('warns when the reference is cited in the manuscript', () => {
    expect(deleteExplanation('gunn1972', true, true)).toContain('cited in the manuscript')
    expect(deleteExplanation('gunn1972', true, false)).not.toContain('cited in the manuscript')
  })
})
