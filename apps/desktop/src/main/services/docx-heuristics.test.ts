import { describe, expect, it } from 'vitest'
import type { Block } from './docx-html'
import {
  blocksToMarkdown,
  detectAbstract,
  detectAffiliations,
  detectAuthors,
  detectHighlights,
  detectKeywords,
  detectSignificance,
  detectTitle,
  runsToMarkdown,
  slugifyHeading,
  splitSections,
  type CitationRun
} from './docx-heuristics'

const p = (text: string): Block => ({ kind: 'paragraph', runs: [{ text }] })
const h = (level: number, text: string): Block => ({ kind: 'heading', level, runs: [{ text }] })
const bold = (text: string): Block => ({ kind: 'paragraph', runs: [{ text, bold: true }] })

describe('detectTitle', () => {
  it('picks a fully-bold paragraph before any body text (ground truth: real manuscripts bold the title instead of using the Title style)', () => {
    const blocks: Block[] = [bold('Sleep and thermal inertia in the built environment'), p('Ada Researcher1, Ben Collaborator2')]
    const result = detectTitle(blocks)
    expect(result.value).toBe('Sleep and thermal inertia in the built environment')
    expect(result.index).toBe(0)
    expect(result.reason).toMatch(/bold/)
  })

  it('picks an h1 heading when the document does use the Title/Heading style', () => {
    const blocks: Block[] = [h(1, 'A properly styled title'), p('Author One')]
    const result = detectTitle(blocks)
    expect(result.value).toBe('A properly styled title')
    expect(result.reason).toMatch(/heading/)
  })

  it('stops looking once plain body text starts, returning null', () => {
    const blocks: Block[] = [p('Just a normal opening paragraph, no title styling.'), bold('Not actually the title')]
    const result = detectTitle(blocks)
    expect(result.value).toBeNull()
    expect(result.index).toBeNull()
  })
})

describe('detectAuthors', () => {
  it('splits on <sup> affiliation markers when present', () => {
    const blocks: Block[] = [
      bold('Title'),
      {
        kind: 'paragraph',
        runs: [
          { text: 'Ada Researcher' },
          { text: '1', sup: true },
          { text: ', Ben Collaborator' },
          { text: '2', sup: true }
        ]
      }
    ]
    const result = detectAuthors(blocks, 0)
    expect(result.index).toBe(1)
    expect(result.authors).toEqual([
      { name: 'Ada Researcher', given: 'Ada', family: 'Researcher', markers: ['1'] },
      { name: 'Ben Collaborator', given: 'Ben', family: 'Collaborator', markers: ['2'] }
    ])
    expect(result.reason).toMatch(/<sup>/)
  })

  it('falls back to comma-separated names when there are no <sup> markers', () => {
    const blocks: Block[] = [bold('Title'), p('Ada Researcher, Ben Collaborator, and Cara Third')]
    const result = detectAuthors(blocks, 0)
    expect(result.authors.map((a) => a.name)).toEqual(['Ada Researcher', 'Ben Collaborator', 'Cara Third'])
    expect(result.authors.every((a) => a.markers.length === 0)).toBe(true)
    expect(result.reason).toMatch(/no <sup> markers/)
  })

  it('reports no match when nothing looks like an author line', () => {
    const blocks: Block[] = [bold('Title'), h(1, 'Introduction')]
    const result = detectAuthors(blocks, 0)
    expect(result.authors).toEqual([])
    expect(result.index).toBeNull()
  })
})

describe('detectAffiliations', () => {
  it('collects contiguous digit-marker paragraphs after the author line', () => {
    const blocks: Block[] = [
      bold('Title'),
      p('Ada Researcher1, Ben Collaborator2'),
      p('1Department of Sleep Medicine, University X'),
      p('2Institute of Circadian Biology, University Y'),
      h(1, 'Introduction')
    ]
    const result = detectAffiliations(blocks, 1)
    expect(result.affiliations).toEqual([
      { marker: '1', text: 'Department of Sleep Medicine, University X' },
      { marker: '2', text: 'Institute of Circadian Biology, University Y' }
    ])
    expect(result.usedIndices).toEqual([2, 3])
  })

  it('reads the marker off a leading <sup> run when present', () => {
    const blocks: Block[] = [
      bold('Title'),
      p('Author'),
      { kind: 'paragraph', runs: [{ text: '1', sup: true }, { text: ' Department of X' }] }
    ]
    const result = detectAffiliations(blocks, 1)
    expect(result.affiliations).toEqual([{ marker: '1', text: 'Department of X' }])
  })

  it('returns empty with a reason when nothing matches', () => {
    const blocks: Block[] = [bold('Title'), p('Author'), h(1, 'Introduction')]
    const result = detectAffiliations(blocks, 1)
    expect(result.affiliations).toEqual([])
    expect(result.reason).toMatch(/no paragraphs/)
  })
})

describe('detectAbstract', () => {
  it('takes the paragraph following a heading matching /abstract|summary/i', () => {
    const blocks: Block[] = [bold('Title'), p('Authors'), h(2, 'Abstract'), p('We report on a study of…'), h(1, 'Introduction')]
    const result = detectAbstract(blocks)
    expect(result.value).toBe('We report on a study of…')
    expect(result.index).toBe(3)
    expect(result.reason).toMatch(/abstract\|summary/)
  })

  it('is null when there is no abstract/summary heading at all', () => {
    const blocks: Block[] = [bold('Title'), p('Authors'), h(1, 'Introduction'), p('Body.')]
    const result = detectAbstract(blocks)
    expect(result.value).toBeNull()
  })
})

describe('splitSections', () => {
  it('splits at h1/h2 boundaries and keeps h3+ nested inside the section blocks', () => {
    const blocks: Block[] = [
      h(1, 'Introduction'),
      p('Intro text.'),
      h(1, 'Results'),
      h(3, 'Subsection'),
      p('Result text.'),
      h(2, 'Discussion'),
      p('Discussion text.')
    ]
    const sections = splitSections(blocks, 0, new Set())
    expect(sections.map((s) => [s.heading, s.level])).toEqual([
      ['Introduction', 1],
      ['Results', 1],
      ['Discussion', 2]
    ])
    expect(sections[1]?.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph'])
  })

  it('gives a null-heading section to content before the first h1/h2', () => {
    const blocks: Block[] = [p('Preamble.'), h(1, 'Introduction'), p('Body.')]
    const sections = splitSections(blocks, 0, new Set())
    expect(sections[0]).toEqual({ heading: null, level: 1, blocks: [blocks[0]] })
  })

  it('excludes blocks already consumed by front-matter detection', () => {
    const blocks: Block[] = [bold('Title'), p('Authors'), h(1, 'Introduction'), p('Body.')]
    const sections = splitSections(blocks, 0, new Set([0, 1]))
    expect(sections).toEqual([{ heading: 'Introduction', level: 1, blocks: [blocks[3]] }])
  })
})

describe('slugifyHeading', () => {
  it('kebab-cases and falls back to "section"', () => {
    expect(slugifyHeading('Results & Discussion')).toBe('results-discussion')
    expect(slugifyHeading(null)).toBe('section')
    expect(slugifyHeading('   ')).toBe('section')
  })
})

describe('runsToMarkdown / blocksToMarkdown', () => {
  it('renders bold/italic as markdown and sup/sub as literal inline HTML', () => {
    const markdown = runsToMarkdown([
      { text: 'plain ' },
      { text: 'bold', bold: true },
      { text: ' ' },
      { text: 'italic', italic: true },
      { text: ' x' },
      { text: '2', sup: true },
      { text: ' H' },
      { text: '2', sub: true },
      { text: 'O' }
    ])
    expect(markdown).toBe('plain **bold** _italic_ x<sup>2</sup> H<sub>2</sub>O')
  })

  it('escapes markdown-significant characters in plain text', () => {
    expect(runsToMarkdown([{ text: '3 * 4 [not a link]' }])).toBe('3 \\* 4 \\[not a link\\]')
  })

  it('emits a citation run verbatim, bypassing escaping', () => {
    const run: CitationRun = { text: '[@gunn1972]', citation: true }
    expect(runsToMarkdown([{ text: '(see ' }, run, { text: ')' }])).toBe('(see [@gunn1972])')
  })

  it('renders a whole section (heading + paragraph + list + table) as markdown', () => {
    const blocks: Block[] = [
      { kind: 'heading', level: 3, runs: [{ text: 'Subsection' }] },
      p('Some text.'),
      { kind: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] },
      {
        kind: 'table',
        rows: [
          [[{ text: 'H1' }], [{ text: 'H2' }]],
          [[{ text: 'a' }], [{ text: 'b' }]]
        ]
      }
    ]
    const md = blocksToMarkdown(blocks)
    expect(md).toContain('### Subsection')
    expect(md).toContain('Some text.')
    expect(md).toContain('- one\n- two')
    expect(md).toContain('| H1 | H2 |')
    expect(md).toContain('| a | b |')
  })
})

describe('detectSignificance', () => {
  it('takes the prose under a "Statement of Significance" heading and reports its indices', () => {
    const blocks: Block[] = [
      h(1, 'Statement of Significance'),
      p('Slow waves matter.'),
      p('And so does dose.'),
      h(1, 'Introduction'),
      p('Body.')
    ]
    const result = detectSignificance(blocks)
    expect(result.value).toBe('Slow waves matter.\n\nAnd so does dose.')
    expect(result.usedIndices).toEqual([0, 1, 2])
  })

  it('ignores prose that merely mentions significance', () => {
    expect(detectSignificance([p('The significance of this result is unclear.')]).value).toBeNull()
  })
})

describe('detectHighlights', () => {
  it('reads bullets from a list or from bulleted paragraphs', () => {
    const list: Block[] = [
      h(1, 'Highlights'),
      { kind: 'list', ordered: false, items: [[{ text: 'One thing.' }], [{ text: 'Another.' }]] },
      h(1, 'Introduction')
    ]
    expect(detectHighlights(list).value).toEqual(['One thing.', 'Another.'])
    const paragraphs: Block[] = [h(1, 'Highlights'), p('\u2022 One thing.'), h(1, 'Introduction')]
    expect(detectHighlights(paragraphs).value).toEqual(['One thing.'])
  })
})

describe('detectKeywords', () => {
  it('splits on semicolons, keeping keywords that contain commas', () => {
    const result = detectKeywords([p('Keywords: NREM sleep; slow waves, K-complexes; tTIS.')])
    expect(result.value).toEqual(['NREM sleep', 'slow waves, K-complexes', 'tTIS'])
    expect(result.usedIndices).toEqual([0])
  })

  it('falls back to commas when there is no semicolon', () => {
    expect(detectKeywords([p('Key words: sleep, spindles, attention')]).value).toEqual([
      'sleep',
      'spindles',
      'attention'
    ])
  })

  it('finds nothing in a document without a keywords line', () => {
    expect(detectKeywords([p('The keywords were chosen carefully.')]).value).toEqual([])
  })
})
