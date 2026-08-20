import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CoverLetterMetaSchema,
  SunaProjectManifestSchema,
  resolveDocuments,
  unansweredIn
} from '@suna/core'
import { createLetter } from './letter-new'

/**
 * feature-plan-12 §2e end to end, against a real project tree on disk.
 */

let dir: string

const MANIFEST = {
  schemaVersion: 1,
  name: 'Fixture',
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
  createdAt: '2026-08-14T00:00:00.000Z'
}

const MANUSCRIPT = {
  title: 'Rapid quenching by ram-pressure stripping',
  shortTitle: null,
  articleType: 'article',
  manuscriptFile: 'manuscript.md',
  abstract: { content: 'Galaxies falling into dense cluster environments lose gas.' },
  significance: 'Environmental quenching is one of the fastest routes.',
  figures: [],
  tables: [],
  availability: { data: null, code: null },
  backMatter: {}
}

const AUTHORS = {
  schemaVersion: 1,
  authors: [
    {
      id: 'a1',
      given: 'Ada',
      family: 'Ramos',
      affiliationRefs: ['1'],
      corresponding: true,
      email: 'ada@example.edu',
      orcid: null,
      equalContribution: false
    }
  ],
  affiliations: [{ marker: '1', text: 'Example University' }]
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-letter-'))
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  await writeFile(join(dir, 'suna.json'), JSON.stringify(MANIFEST))
  await writeFile(join(dir, 'manuscript', 'manuscript.json'), JSON.stringify(MANUSCRIPT))
  await writeFile(join(dir, 'manuscript', 'authors.json'), JSON.stringify(AUTHORS))
  await writeFile(join(dir, 'manuscript', 'manuscript.md'), '# Introduction\n\nText.\n')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const read = (rel: string): Promise<string> => readFile(join(dir, rel), 'utf8')

describe('createLetter', () => {
  it('writes prose, sidecar and private sidecar under manuscript/letters', async () => {
    const res = await createLetter({
      rootDir: dir,
      id: 'cover-science',
      letterKind: 'submission',
      targetProfileId: 'science'
    })
    expect(res.proseFile).toBe(join('letters', 'cover-science.md'))
    const prose = await read('manuscript/letters/cover-science.md')
    expect(prose).toContain('Dear Editor,')
    expect(prose).toContain('Rapid quenching by ram-pressure stripping')
    // The venue's own name, from the profile — not the project's active one.
    expect(prose).toContain('Science')

    const meta = CoverLetterMetaSchema.parse(
      JSON.parse(await read('manuscript/letters/cover-science.json'))
    )
    expect(meta.targetProfileId).toBe('science')
    expect(meta.covers[0]?.title).toBe(MANUSCRIPT.title)

    const priv = JSON.parse(await read('manuscript/letters/cover-science.private.json'))
    expect(priv.suggestedReviewers).toEqual([])
  })

  it('ignores the private sidecar, and writes the ignore line before the file', async () => {
    const res = await createLetter({
      rootDir: dir,
      id: 'cover-science',
      letterKind: 'submission',
      targetProfileId: 'science'
    })
    expect(res.gitignoreTouched).toBe(true)
    const ignore = await read('.gitignore')
    expect(ignore.split('\n')).toContain('manuscript/**/*.private.json')
  })

  it('appends to a .gitignore that predates the feature without rewriting it', async () => {
    await writeFile(join(dir, '.gitignore'), 'node_modules\noutput/\n')
    await createLetter({
      rootDir: dir,
      id: 'cover-science',
      letterKind: 'submission',
      targetProfileId: 'science'
    })
    const ignore = await read('.gitignore')
    expect(ignore.startsWith('node_modules\noutput/\n')).toBe(true)
    expect(ignore).toContain('manuscript/**/*.private.json')
  })

  it('seeds every required assertion as unanswered, and answers none of them', async () => {
    const res = await createLetter({
      rootDir: dir,
      id: 'cover-science',
      letterKind: 'submission',
      targetProfileId: 'science'
    })
    expect(res.requiredAssertions.length).toBeGreaterThan(0)
    const meta = CoverLetterMetaSchema.parse(
      JSON.parse(await read('manuscript/letters/cover-science.json'))
    )
    expect(meta.assertions.map((a) => a.id)).toEqual(res.requiredAssertions)
    // SUNA never writes the author's claims.
    expect(meta.assertions.every((a) => a.text === null)).toBe(true)
    // …and the prose shows every one of them as an open question.
    const prose = await read('manuscript/letters/cover-science.md')
    expect(unansweredIn(prose).sort()).toEqual([...res.requiredAssertions].sort())
  })

  it('delivers the abstract as a comment, never as prose', async () => {
    const res = await createLetter({
      rootDir: dir,
      id: 'cover-science',
      letterKind: 'submission',
      targetProfileId: 'science'
    })
    expect(res.seedComment).toContain('Environmental quenching')
    const prose = await read('manuscript/letters/cover-science.md')
    expect(prose).not.toContain('Environmental quenching')
    expect(prose).not.toContain('Galaxies falling into dense cluster')
  })

  it('registers the letter in suna.json, and leaves the manuscript entry intact', async () => {
    await createLetter({
      rootDir: dir,
      id: 'cover-science',
      letterKind: 'submission',
      targetProfileId: 'science'
    })
    const manifest = SunaProjectManifestSchema.parse(JSON.parse(await read('suna.json')))
    const docs = resolveDocuments(manifest)
    expect(docs.map((d) => d.id).sort()).toEqual(['cover-science', 'manuscript'])
    const letter = docs.find((d) => d.id === 'cover-science')
    expect(letter?.kind).toBe('cover-letter')
    expect(letter?.profile).toEqual({ registry: 'journal', id: 'science' })
    expect(docs.find((d) => d.kind === 'manuscript')?.meta).toBe('manuscript.json')
  })

  it('a PNAS letter seeds no assertions, because PNAS does not request a letter', async () => {
    const res = await createLetter({
      rootDir: dir,
      id: 'cover-pnas',
      letterKind: 'submission',
      targetProfileId: 'pnas'
    })
    expect(res.requiredAssertions).toEqual([])
    const prose = await read('manuscript/letters/cover-pnas.md')
    expect(unansweredIn(prose)).toEqual([])
  })

  it('refuses a duplicate id', async () => {
    await createLetter({ rootDir: dir, id: 'c', letterKind: 'submission', targetProfileId: 'science' })
    await expect(
      createLetter({ rootDir: dir, id: 'c', letterKind: 'submission', targetProfileId: 'science' })
    ).rejects.toThrow(/already has a document/)
  })

  it('refuses a non-slug id and an unknown profile', async () => {
    await expect(
      createLetter({ rootDir: dir, id: 'Cover Letter', letterKind: 'submission', targetProfileId: 'science' })
    ).rejects.toThrow(/lowercase slug/)
    await expect(
      createLetter({ rootDir: dir, id: 'c', letterKind: 'submission', targetProfileId: 'no-such-journal' })
    ).rejects.toThrow(/unknown publisher profile/)
  })

  it('creates a letter in a project with no authors.json', async () => {
    await rm(join(dir, 'manuscript', 'authors.json'))
    const res = await createLetter({
      rootDir: dir,
      id: 'cover-science',
      letterKind: 'submission',
      targetProfileId: 'science'
    })
    expect(res.documentId).toBe('cover-science')
  })

  it('opens the letter with the target journal, not the project active profile', async () => {
    // The project targets nature-astronomy; the letter targets Science. The
    // letter must never silently inherit.
    const res = await createLetter({
      rootDir: dir,
      id: 'cover-science',
      letterKind: 'submission',
      targetProfileId: 'science'
    })
    const meta = CoverLetterMetaSchema.parse(JSON.parse(await read(join('manuscript', res.metaFile))))
    expect(meta.targetProfileId).toBe('science')
    expect(MANIFEST.activeProfileId).toBe('nature-astronomy')
  })
})
