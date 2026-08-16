import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthorsFileSchema, ManuscriptSchema } from '@suna/core'
import { outlineFromMarkdown } from '@suna/markdown'
import { migrateCommentTargets, migrateProject } from './migrate-manuscript'

let dir = ''
let manuscriptDir = ''

const INTRO = `Galaxies falling into dense clusters lose their gas [@gunn1972].

A second intro paragraph, unheaded on purpose.
`

const RESULTS = `We detect a stripped tail (see @fig:spectrum).
`

const METHODS = `Observations were taken with the demo telescope.
`

const PARTICLES = `Particles were initialized on a grid.
`

const AUTHORS = [
  {
    id: 'a1',
    given: 'Ada',
    family: 'Researcher',
    nativeScript: null,
    orcid: '0000-0002-1825-0097',
    affiliationRefs: ['af1'],
    corresponding: true,
    email: 'ada@observatory.edu',
    equalContribution: false,
    deceased: false
  },
  {
    id: 'a2',
    given: 'Ben',
    family: 'Collaborator',
    nativeScript: null,
    orcid: null,
    affiliationRefs: ['af2'],
    corresponding: false,
    email: null,
    equalContribution: false,
    deceased: false
  }
]

const AFFILIATIONS = [
  { id: 'af1', text: 'Example University' },
  { id: 'af2', text: 'Institute for Cosmic Discovery' }
]

function legacyManuscript(): Record<string, unknown> {
  return {
    title: 'A demo paper',
    shortTitle: 'Demo',
    articleType: 'article',
    doi: null,
    openAccess: null,
    authors: AUTHORS,
    affiliations: AFFILIATIONS,
    history: { received: null, accepted: null, publishedOnline: null },
    abstract: { content: 'We demonstrate the migration.' },
    significance: 'It matters.',
    body: [
      { kind: 'section', heading: null, level: 'A', content: 'sections/01-introduction.md', children: [] },
      { kind: 'section', heading: 'Results', level: 'A', content: 'sections/02-results.md', children: [] },
      {
        kind: 'section',
        heading: 'Methods',
        level: 'A',
        content: 'sections/03-methods.md',
        children: [
          {
            kind: 'section',
            heading: 'Particle initialization.',
            level: 'C-runin',
            content: 'sections/04-particles.md',
            children: []
          }
        ]
      }
    ],
    figures: [],
    tables: [],
    availability: { data: '', code: '' },
    backMatter: {
      acknowledgements: null,
      authorContributions: null,
      funding: [],
      competingInterests: null,
      peerReview: null,
      supplementaryInfo: null
    },
    bibliography: 'references.bib'
  }
}

/** Writes the OLD layout: manuscript.json with a body, plus sections/*.md. */
async function writeOldProject(overrides: Record<string, unknown> = {}): Promise<void> {
  await writeFile(
    join(dir, 'suna.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        name: 'demo',
        activeProfileId: 'nature-astronomy',
        directories: {
          manuscript: 'manuscript',
          figures: 'figures',
          code: 'code',
          data: 'data',
          analysis: 'analysis',
          results: 'results',
          output: 'output'
        },
        createdAt: '2026-08-13T09:30:00.000Z'
      },
      null,
      2
    ) + '\n'
  )
  await mkdir(join(manuscriptDir, 'sections'), { recursive: true })
  await writeFile(
    join(manuscriptDir, 'manuscript.json'),
    JSON.stringify({ ...legacyManuscript(), ...overrides }, null, 2) + '\n'
  )
  await writeFile(join(manuscriptDir, 'sections', '01-introduction.md'), INTRO)
  await writeFile(join(manuscriptDir, 'sections', '02-results.md'), RESULTS)
  await writeFile(join(manuscriptDir, 'sections', '03-methods.md'), METHODS)
  await writeFile(join(manuscriptDir, 'sections', '04-particles.md'), PARTICLES)
  await writeFile(join(manuscriptDir, 'references.bib'), '@article{gunn1972,}\n')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-migrate-'))
  manuscriptDir = join(dir, 'manuscript')
  await mkdir(manuscriptDir, { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('migrateProject', () => {
  it('turns the old layout into the flat one without losing a byte of prose', async () => {
    await writeOldProject()
    const result = await migrateProject(dir)

    expect(result.error).toBeNull()
    expect(result.migrated).toBe(true)

    const prose = await readFile(join(manuscriptDir, 'manuscript.md'), 'utf8')
    // Every section file's text survives verbatim…
    for (const text of [INTRO, RESULTS, METHODS, PARTICLES]) {
      expect(prose).toContain(text.trimEnd())
    }
    // …in body order, with headings emitted at their level (A→#, C-runin→###)
    // and no heading at all for the unheaded introduction.
    expect(outlineFromMarkdown(prose).map((s) => [s.level, s.title])).toEqual([
      [0, ''],
      [1, 'Results'],
      [1, 'Methods'],
      [3, 'Particle initialization.']
    ])
    expect(prose.indexOf(INTRO.trimEnd())).toBeLessThan(prose.indexOf(RESULTS.trimEnd()))
    expect(prose.indexOf(RESULTS.trimEnd())).toBeLessThan(prose.indexOf(METHODS.trimEnd()))
    expect(prose.endsWith('\n')).toBe(true)

    const authors = AuthorsFileSchema.parse(
      JSON.parse(await readFile(join(manuscriptDir, 'authors.json'), 'utf8'))
    )
    expect(authors).toEqual({ schemaVersion: 1, authors: AUTHORS, affiliations: AFFILIATIONS })

    const rewritten = JSON.parse(
      await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')
    ) as Record<string, unknown>
    expect(rewritten).not.toHaveProperty('body')
    expect(rewritten).not.toHaveProperty('authors')
    expect(rewritten).not.toHaveProperty('affiliations')
    expect(rewritten['manuscriptFile']).toBe('manuscript.md')
    expect(rewritten['significance']).toBe('It matters.')
    expect(ManuscriptSchema.safeParse(rewritten).success).toBe(true)

    // sections/ goes only after all three files exist and parse.
    expect(await exists(join(manuscriptDir, 'sections'))).toBe(false)
    expect((await readdir(manuscriptDir)).sort()).toEqual([
      'authors.json',
      'manuscript.json',
      'manuscript.md',
      'references.bib'
    ])
  })

  it('is idempotent: a second run changes nothing', async () => {
    await writeOldProject()
    await migrateProject(dir)
    const before = {
      prose: await readFile(join(manuscriptDir, 'manuscript.md'), 'utf8'),
      authors: await readFile(join(manuscriptDir, 'authors.json'), 'utf8'),
      manuscript: await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')
    }

    const again = await migrateProject(dir)
    expect(again).toEqual({ migrated: false, notes: ['project is already flat'], error: null })
    expect(await readFile(join(manuscriptDir, 'manuscript.md'), 'utf8')).toBe(before.prose)
    expect(await readFile(join(manuscriptDir, 'authors.json'), 'utf8')).toBe(before.authors)
    expect(await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')).toBe(before.manuscript)
  })

  it('does nothing at all when there is no manuscript.json', async () => {
    const result = await migrateProject(dir)
    expect(result).toEqual({
      migrated: false,
      notes: ['no manuscript.json — nothing to migrate'],
      error: null
    })
  })

  it('retargets section comments at the prose file and leaves figure comments alone', async () => {
    await writeOldProject()
    await writeFile(
      join(manuscriptDir, 'comments.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          comments: [
            {
              id: 'c1',
              target: {
                kind: 'section',
                path: 'sections/02-results.md',
                anchor: { quote: 'stripped tail', prefix: 'We detect a ', suffix: ' (see' }
              },
              body: 'Is this significant?',
              author: { kind: 'human', name: 'Ada' },
              createdAt: '2026-08-13T09:30:00.000Z',
              resolved: false,
              detached: false,
              replies: []
            },
            {
              id: 'c2',
              target: { kind: 'figure', figureId: 'fig-spectrum' },
              body: 'Axis labels are too small.',
              author: { kind: 'human', name: 'Ben' },
              createdAt: '2026-08-13T09:31:00.000Z',
              resolved: false,
              detached: false,
              replies: []
            }
          ]
        },
        null,
        2
      ) + '\n'
    )

    const result = await migrateProject(dir)
    expect(result.migrated).toBe(true)
    expect(result.notes.some((n) => n.includes('retargeted 1 comment'))).toBe(true)

    const comments = JSON.parse(
      await readFile(join(manuscriptDir, 'comments.json'), 'utf8')
    ) as { comments: { target: Record<string, unknown> }[] }
    expect(comments.comments[0]?.target['path']).toBe('manuscript.md')
    // The quote is untouched, so re-anchoring finds it in the merged file.
    expect(comments.comments[0]?.target['anchor']).toEqual({
      quote: 'stripped tail',
      prefix: 'We detect a ',
      suffix: ' (see'
    })
    expect(comments.comments[1]?.target).toEqual({ kind: 'figure', figureId: 'fig-spectrum' })
  })

  it('notes a missing section file instead of aborting (there is no prose to lose)', async () => {
    await writeOldProject()
    await rm(join(manuscriptDir, 'sections', '02-results.md'))

    const result = await migrateProject(dir)
    expect(result.migrated).toBe(true)
    expect(result.error).toBeNull()
    expect(result.notes.some((n) => n.includes('sections/02-results.md'))).toBe(true)

    const prose = await readFile(join(manuscriptDir, 'manuscript.md'), 'utf8')
    expect(prose).toContain('# Results')
    expect(prose).toContain(INTRO.trimEnd())
    expect(prose).toContain(METHODS.trimEnd())
  })

  it('refuses to overwrite an existing manuscript.md and leaves the project untouched', async () => {
    await writeOldProject()
    const original = 'Hand-written prose that must not be clobbered.\n'
    await writeFile(join(manuscriptDir, 'manuscript.md'), original)
    const manuscriptJsonBefore = await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')

    const result = await migrateProject(dir)
    expect(result.migrated).toBe(false)
    expect(result.error).toMatch(/already exists/)

    expect(await readFile(join(manuscriptDir, 'manuscript.md'), 'utf8')).toBe(original)
    expect(await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')).toBe(manuscriptJsonBefore)
    expect(await exists(join(manuscriptDir, 'authors.json'))).toBe(false)
    // sections/ is intact: an unmigrated project is still a working old-layout one.
    expect((await readdir(join(manuscriptDir, 'sections'))).sort()).toEqual([
      '01-introduction.md',
      '02-results.md',
      '03-methods.md',
      '04-particles.md'
    ])
  })

  it('rolls back and reports when a body node points outside the manuscript directory', async () => {
    await writeOldProject({
      body: [
        { kind: 'section', heading: null, level: 'A', content: '../../../etc/hosts', children: [] }
      ]
    })
    const manuscriptJsonBefore = await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')

    const result = await migrateProject(dir)
    expect(result.migrated).toBe(false)
    expect(result.error).toMatch(/escapes the manuscript directory/)
    expect(await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')).toBe(manuscriptJsonBefore)
    expect(await exists(join(manuscriptDir, 'manuscript.md'))).toBe(false)
    expect(await exists(join(manuscriptDir, 'authors.json'))).toBe(false)
    expect(await exists(join(manuscriptDir, 'sections'))).toBe(true)
  })

  it('abandons the migration when the rewritten manuscript.json would be invalid', async () => {
    await writeOldProject({ bibliography: 'references.txt' })
    const manuscriptJsonBefore = await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')

    const result = await migrateProject(dir)
    expect(result.migrated).toBe(false)
    expect(result.error).toMatch(/manuscript\.json would be invalid/)
    expect(await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')).toBe(manuscriptJsonBefore)
    expect(await exists(join(manuscriptDir, 'manuscript.md'))).toBe(false)
    expect(await exists(join(manuscriptDir, 'sections'))).toBe(true)
  })

  it('reports invalid JSON without touching anything', async () => {
    await writeFile(join(manuscriptDir, 'manuscript.json'), '{ not json')
    const result = await migrateProject(dir)
    expect(result.migrated).toBe(false)
    expect(result.error).toMatch(/not valid JSON/)
    expect(await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8')).toBe('{ not json')
  })

  it('migrates a project whose byline is the only legacy field', async () => {
    const legacy = legacyManuscript()
    delete legacy['body']
    await writeFile(join(dir, 'suna.json'), JSON.stringify({ schemaVersion: 1, name: 'x', activeProfileId: 'p', directories: {}, createdAt: '2026-08-13T09:30:00.000Z' }, null, 2))
    await writeFile(join(manuscriptDir, 'manuscript.json'), JSON.stringify(legacy, null, 2) + '\n')

    const result = await migrateProject(dir)
    expect(result.migrated).toBe(true)
    expect(await readFile(join(manuscriptDir, 'manuscript.md'), 'utf8')).toBe('')
    const authors = AuthorsFileSchema.parse(
      JSON.parse(await readFile(join(manuscriptDir, 'authors.json'), 'utf8'))
    )
    expect(authors.authors).toHaveLength(2)
  })

  it('finishes a half-migrated project without touching the prose it already has', async () => {
    await writeOldProject()
    const handMigrated = 'Prose the user already extracted by hand.\n'
    await writeFile(join(manuscriptDir, 'manuscript.md'), handMigrated)
    // The body is gone from manuscript.json; only the byline is still legacy.
    const legacy = legacyManuscript()
    delete legacy['body']
    await writeFile(join(manuscriptDir, 'manuscript.json'), JSON.stringify(legacy, null, 2) + '\n')

    const result = await migrateProject(dir)
    expect(result.migrated).toBe(true)
    expect(result.error).toBeNull()
    expect(await readFile(join(manuscriptDir, 'manuscript.md'), 'utf8')).toBe(handMigrated)
    const authors = AuthorsFileSchema.parse(
      JSON.parse(await readFile(join(manuscriptDir, 'authors.json'), 'utf8'))
    )
    expect(authors.authors).toHaveLength(2)
  })

  it('flattens box nodes into headings and says so', async () => {
    await writeOldProject({
      body: [
        { kind: 'section', heading: 'Results', level: 'A', content: 'sections/02-results.md', children: [] },
        {
          kind: 'box',
          id: 'box-icecube',
          title: 'The IceCube experiment.',
          content: 'sections/03-methods.md',
          figureRefs: []
        }
      ]
    })
    const result = await migrateProject(dir)
    expect(result.migrated).toBe(true)
    expect(result.notes.some((n) => n.includes('box-icecube'))).toBe(true)
    const prose = await readFile(join(manuscriptDir, 'manuscript.md'), 'utf8')
    expect(prose).toContain('## The IceCube experiment.')
    expect(prose).toContain(METHODS.trimEnd())
  })
})

describe('migrateCommentTargets', () => {
  const comment = (path: string) => ({
    id: 'c1',
    target: { kind: 'section', path, anchor: { quote: 'q', prefix: '', suffix: '' } },
    body: 'b'
  })

  it('rewrites only section targets that are not already the prose file', () => {
    const { file, retargeted } = migrateCommentTargets(
      { schemaVersion: 1, comments: [comment('sections/a.md'), comment('manuscript.md')] },
      'manuscript.md'
    )
    expect(retargeted).toBe(1)
    const comments = (file as { comments: { target: { path: string } }[] }).comments
    expect(comments.map((c) => c.target.path)).toEqual(['manuscript.md', 'manuscript.md'])
  })

  it('honours a custom prose file name and ignores non-comment shapes', () => {
    expect(migrateCommentTargets({ comments: 'nope' }, 'paper.md').retargeted).toBe(0)
    expect(migrateCommentTargets(null, 'paper.md')).toEqual({ file: null, retargeted: 0 })
    const { retargeted } = migrateCommentTargets(
      { schemaVersion: 1, comments: [comment('sections/a.md')] },
      'paper.md'
    )
    expect(retargeted).toBe(1)
  })
})
