import { describe, expect, it } from 'vitest'
import { PublisherProfileSchema, type PublisherProfile } from '@suna/core'
import { getBundledProfile } from '@suna/formatter'
import { citationModeLabel, profileRequirements, sourceLinks, stanceTag, statusOf } from './requirements'

/**
 * Headless tests for the requirements-panel row derivation (requirements.ts)
 * — apps/desktop has no DOM test environment, which is exactly why the
 * derivation is a pure module. Two fixtures: a synthetic profile exercising
 * every branch, and the real bundled SLEEP profile (the journal that states
 * "do not number the lines" — the case that proves stances are per-journal,
 * not universal defaults).
 */

/** A schema-valid profile where the journal states nothing at all. */
const BARE: PublisherProfile = {
  schemaVersion: 3,
  id: 'test-journal',
  journalName: 'Test Journal',
  publisher: 'Test Press',
  lastVerified: '2026-08-01',
  citations: {
    mode: 'author-year',
    collapseRanges: false,
    textualTokens: { ref: 'ref.', refs: 'refs' },
    authorYear: null,
    referenceList: {
      entryTemplates: { article: null, book: null, preprint: null, software: null },
      authorTruncation: { etAlAllowed: null, truncateWhenMoreThan: null, keepFirstN: null },
      journalAbbreviation: null,
      doiPolicy: null,
      sortOrder: 'alphabetical'
    },
    maxReferences: null,
    sources: []
  },
  figures: {
    widthPresetsMm: { single: null, onehalf: null, double: null },
    maxHeightMm: null,
    minFontPt: null,
    maxFontPt: null,
    lineWeightPt: { min: null, max: null },
    preferredFontFamilies: null,
    palette: {
      requirement: 'none-stated',
      suggestedRamps: [],
      suggestedHex: null,
      colorAsSoleDelimiter: null,
      redGreenDiscouraged: null
    },
    formats: { vectorPreferred: [], rasterAccepted: [], minDpi: null },
    panelLabel: { letterCase: null, weight: null, wrapper: null },
    sources: []
  },
  manuscript: {
    articleTypes: [
      {
        id: 'article',
        name: 'Article',
        wordLimit: null,
        abstractWordLimit: null,
        titleLimitChars: null,
        maxDisplayItems: null,
        maxReferences: null
      }
    ],
    runningHeadLimitChars: null,
    requiredSections: [],
    availabilityStatements: { data: null, code: null },
    submissionFormat: { doubleSpacing: null, lineNumbers: null, acceptedFileTypes: [] },
    sources: []
  },
  notes: []
}

/** A profile where the journal states everything the panel can show. */
function statedProfile(): PublisherProfile {
  const p = structuredClone(BARE)
  p.citations.mode = 'numeric-superscript'
  p.citations.collapseRanges = true
  p.citations.referenceList.sortOrder = 'appearance'
  p.citations.referenceList.authorTruncation = {
    etAlAllowed: true,
    truncateWhenMoreThan: 6,
    keepFirstN: 3
  }
  p.citations.maxReferences = 60
  p.citations.sources = ['https://journal.example/citations']
  p.figures.widthPresetsMm = { single: 89, onehalf: 120, double: 183 }
  p.figures.maxHeightMm = 240
  p.figures.minFontPt = 5
  p.figures.maxFontPt = 7
  p.figures.lineWeightPt = { min: 0.25, max: 1 }
  p.figures.preferredFontFamilies = ['Helvetica', 'Arial']
  p.figures.palette.requirement = 'colorblind-safe-required'
  p.figures.formats = { vectorPreferred: ['eps', 'pdf'], rasterAccepted: ['tif'], minDpi: 300 }
  p.figures.sources = ['https://journal.example/figures']
  p.manuscript.articleTypes = [
    {
      id: 'research',
      name: 'Research Article',
      wordLimit: { max: 5000, scope: 'total', hard: true },
      abstractWordLimit: 250,
      titleLimitChars: 120,
      maxDisplayItems: 6,
      maxReferences: 50
    }
  ]
  p.manuscript.requiredSections = [
    { id: 'abstract', label: 'Abstract', required: true },
    { id: 'acknowledgments', label: 'Acknowledgments', required: false }
  ]
  p.manuscript.availabilityStatements = { data: true, code: false }
  p.manuscript.submissionFormat = {
    doubleSpacing: true,
    lineNumbers: false,
    acceptedFileTypes: ['docx']
  }
  p.manuscript.sources = ['https://journal.example/manuscript', 'https://journal.example/citations']
  p.notes = ['A short note.']
  return p
}

describe('fixtures', () => {
  it('both fixtures validate against PublisherProfileSchema', () => {
    expect(PublisherProfileSchema.safeParse(BARE).success).toBe(true)
    expect(PublisherProfileSchema.safeParse(statedProfile()).success).toBe(true)
  })
})

describe('statusOf / stanceTag / citationModeLabel', () => {
  it('maps the tri-state stance: true=required, false=do-not-use, null=not-stated', () => {
    expect(statusOf(true)).toBe('required')
    expect(statusOf(false)).toBe('do-not-use')
    expect(statusOf(null)).toBe('not-stated')
  })

  it('stanceTag words the journal stance as information, and stays silent on null', () => {
    expect(stanceTag('SLEEP', true)).toBe('SLEEP requires this')
    expect(stanceTag('SLEEP', false)).toBe('SLEEP says do not use')
    expect(stanceTag('SLEEP', null)).toBeNull()
  })

  it('humanizes all three citation modes', () => {
    expect(citationModeLabel('numeric-superscript')).toBe('Superscript numbers¹')
    expect(citationModeLabel('parenthetical-numeric')).toBe('Bracketed numbers [1]')
    expect(citationModeLabel('author-year')).toBe('(Author, Year)')
  })
})

describe('profileRequirements — fully stated profile', () => {
  const req = profileRequirements(statedProfile())

  it('carries the header identity', () => {
    expect(req.journalName).toBe('Test Journal')
    expect(req.publisher).toBe('Test Press')
    expect(req.lastVerified).toBe('2026-08-01')
  })

  it('derives all three submission rows plus uppercased file-type chips', () => {
    expect(req.submission).not.toBeNull()
    expect(req.submission!.rows).toEqual([
      { id: 'double-spacing', label: 'Double spacing', status: 'required' },
      { id: 'line-numbers', label: 'Line numbers', status: 'do-not-use' },
      { id: 'page-numbers', label: 'Page numbering', status: 'not-stated' }
    ])
    expect(req.submission!.fileTypes).toEqual(['DOCX'])
  })

  it('turns every stated article-type limit into a chip, comma-grouping thousands', () => {
    expect(req.articleTypes).toEqual([
      {
        id: 'research',
        name: 'Research Article',
        chips: ['≤ 5,000 words', 'abstract ≤ 250', 'title ≤ 120 chars', '≤ 6 display items', '≤ 50 refs']
      }
    ])
  })

  it('keeps required and optional sections apart', () => {
    expect(req.sections).toEqual([
      { id: 'abstract', label: 'Abstract', required: true },
      { id: 'acknowledgments', label: 'Acknowledgments', required: false }
    ])
  })

  it('humanizes the citation rules', () => {
    expect(req.citations).toEqual([
      { label: 'In-text citations', value: 'Superscript numbers¹' },
      { label: 'Citation clusters', value: 'ranges collapsed [1–4]' },
      { label: 'Reference list', value: 'in citation order' },
      { label: 'Author lists', value: 'et al. when more than 6 authors, first 3 kept' },
      { label: 'Reference cap', value: '≤ 60 references' }
    ])
  })

  it('derives figure width/format chips and facts', () => {
    expect(req.figures).not.toBeNull()
    expect(req.figures!.widthChips).toEqual([
      'Single column 89 mm',
      '1.5 column 120 mm',
      'Double column 183 mm'
    ])
    expect(req.figures!.vectorFormats).toEqual(['EPS', 'PDF'])
    expect(req.figures!.rasterFormats).toEqual(['TIF'])
    expect(req.figures!.facts).toEqual([
      { label: 'Raster resolution', value: 'min 300 dpi' },
      { label: 'Label font size', value: 'labels 5–7 pt' },
      { label: 'Max height', value: '240 mm' },
      { label: 'Line weight', value: '0.25–1 pt' },
      { label: 'Fonts', value: 'Helvetica, Arial' },
      { label: 'Palette', value: 'colorblind-safe required' }
    ])
  })

  it('states availability requirements in both directions', () => {
    expect(req.availability).toEqual([
      { label: 'Data availability', value: 'statement required' },
      { label: 'Code availability', value: 'statement not required' }
    ])
  })

  it('dedupes source URLs across profile blocks and names same-host pages uniquely', () => {
    expect(req.sources).toEqual([
      { url: 'https://journal.example/citations', label: 'journal.example — citations' },
      { url: 'https://journal.example/figures', label: 'journal.example — figures' },
      { url: 'https://journal.example/manuscript', label: 'journal.example — manuscript' }
    ])
  })
})

describe('sourceLinks — unique naming', () => {
  it('a lone URL on a host is labeled by the bare host, www stripped', () => {
    expect(sourceLinks(['https://www.sciencedirect.com/journal/brain-stimulation/publish/guide-for-authors'])).toEqual([
      {
        url: 'https://www.sciencedirect.com/journal/brain-stimulation/publish/guide-for-authors',
        label: 'sciencedirect.com'
      }
    ])
  })

  it('several pages on one host get distinct path-derived names, generic hops dropped', () => {
    const links = sourceLinks([
      'https://academic.oup.com/sleep/pages/author-guidelines',
      'https://academic.oup.com/sleep/pages/general_instructions'
    ])
    expect(links.map((l) => l.label)).toEqual([
      'academic.oup.com — author guidelines',
      'academic.oup.com — general instructions'
    ])
  })

  it('widens leftward through the path when the last segments collide', () => {
    const links = sourceLinks([
      'https://academic.oup.com/sleep/pages/author-guidelines',
      'https://academic.oup.com/sleepadvances/pages/author-guidelines'
    ])
    expect(new Set(links.map((l) => l.label)).size).toBe(2)
    expect(links[0]?.label).toContain('sleep')
    expect(links[1]?.label).toContain('sleepadvances')
  })

  it('falls back to numeric suffixes when URLs differ only in ways paths cannot show', () => {
    const links = sourceLinks(['https://x.example/?a=1', 'https://x.example/?a=2'])
    expect(new Set(links.map((l) => l.label)).size).toBe(2)
  })

  it('dedupes identical URLs', () => {
    expect(sourceLinks(['https://x.example/a', 'https://x.example/a'])).toHaveLength(1)
  })
})

describe('profileRequirements — null means "not stated", never invented', () => {
  const req = profileRequirements(BARE)

  it('drops the submission section entirely when nothing about it is stated', () => {
    expect(req.submission).toBeNull()
  })

  it('drops the figures section entirely when nothing about it is stated', () => {
    expect(req.figures).toBeNull()
  })

  it('an article type with no stated limits keeps its name and zero chips', () => {
    expect(req.articleTypes).toEqual([{ id: 'article', name: 'Article', chips: [] }])
  })

  it('omits unstated citation facts, keeping only the always-present mode and sort order', () => {
    expect(req.citations).toEqual([
      { label: 'In-text citations', value: '(Author, Year)' },
      { label: 'Reference list', value: 'alphabetical' }
    ])
  })

  it('null availability statements produce no rows', () => {
    expect(req.availability).toEqual([])
  })

  it('sections, notes and sources are empty, not fabricated', () => {
    expect(req.sections).toEqual([])
    expect(req.notes).toEqual([])
    expect(req.sources).toEqual([])
  })

  it('a lone stated value keeps the submission section, with the rest marked not-stated', () => {
    const p = structuredClone(BARE)
    p.manuscript.submissionFormat.lineNumbers = true
    const rows = profileRequirements(p).submission!.rows
    expect(rows.map((r) => r.status)).toEqual(['not-stated', 'required', 'not-stated'])
  })

  it('explicit et-al-forbidden reads as "all authors listed"', () => {
    const p = structuredClone(BARE)
    p.citations.referenceList.authorTruncation.etAlAllowed = false
    const authorFact = profileRequirements(p).citations.find((f) => f.label === 'Author lists')
    expect(authorFact?.value).toBe('all authors listed — no et al.')
  })

  it('picks up an optional future pageNumbers field without requiring a schema change', () => {
    const p = structuredClone(BARE)
    p.manuscript.submissionFormat = Object.assign({}, p.manuscript.submissionFormat, {
      pageNumbers: true
    })
    const rows = profileRequirements(p).submission!.rows
    expect(rows.find((r) => r.id === 'page-numbers')?.status).toBe('required')
  })
})

describe('profileRequirements — real bundled SLEEP profile', () => {
  const sleep = getBundledProfile('sleep')

  it('the bundled profile loads', () => {
    expect(sleep).not.toBeNull()
  })

  const req = profileRequirements(sleep!)

  it('SLEEP requires double spacing but says do not use line numbers', () => {
    const byId = new Map(req.submission!.rows.map((r) => [r.id, r.status]))
    expect(byId.get('double-spacing')).toBe('required')
    expect(byId.get('line-numbers')).toBe('do-not-use')
    expect(req.submission!.fileTypes).toEqual(['DOCX', 'RTF', 'PDF'])
  })

  it('SLEEP Research Letters carry the hard word/display/reference limits', () => {
    const letters = req.articleTypes.find((t) => t.id === 'research-letter')
    expect(letters?.chips).toEqual(['≤ 1,200 words', '≤ 1 display item', '≤ 10 refs'])
  })

  it('SLEEP citations: bracketed numbers, collapsed ranges, citation order, AMA author truncation', () => {
    expect(req.citations).toEqual([
      { label: 'In-text citations', value: 'Bracketed numbers [1]' },
      { label: 'Citation clusters', value: 'ranges collapsed [1–4]' },
      { label: 'Reference list', value: 'in citation order' },
      { label: 'Author lists', value: 'et al. when more than 6 authors, first 3 kept' }
    ])
  })

  it('SLEEP figures: no width presets stated, but formats and 300 dpi are', () => {
    expect(req.figures!.widthChips).toEqual([])
    expect(req.figures!.vectorFormats).toEqual(['EPS', 'PDF'])
    expect(req.figures!.rasterFormats).toEqual(['TIF'])
    expect(req.figures!.facts).toEqual([{ label: 'Raster resolution', value: 'min 300 dpi' }])
  })

  it('SLEEP states no availability requirements — none are invented', () => {
    expect(req.availability).toEqual([])
  })

  it('all three blocks cite the same guidelines page, deduped to one host-labeled source', () => {
    expect(req.sources).toEqual([
      { url: 'https://academic.oup.com/sleep/pages/author-guidelines', label: 'academic.oup.com' }
    ])
  })
})
