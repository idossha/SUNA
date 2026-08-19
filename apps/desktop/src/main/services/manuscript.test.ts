import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManuscriptSchema, type Manuscript } from '@suna/core'
import { deepMergePatch, readManuscript, updateManuscript } from './manuscript'
import { allowRoot } from './roots'

function fixtureManuscript(): Manuscript {
  return ManuscriptSchema.parse({
    title: 'Ram pressure at cosmic noon',
    articleType: 'article',
    doi: null,
    openAccess: null,
    history: { received: null, accepted: null, publishedOnline: null },
    abstract: { content: 'We report stripping in dense environments.' },
    manuscriptFile: 'manuscript.md',
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
  } satisfies Manuscript)
}

let dir = ''
let manuscriptFile = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-manuscript-'))
  allowRoot(dir)
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  manuscriptFile = join(dir, 'manuscript', 'manuscript.json')
  await writeFile(manuscriptFile, JSON.stringify(fixtureManuscript(), null, 2) + '\n', 'utf8')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function onDisk(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(manuscriptFile, 'utf8')) as Record<string, unknown>
}

describe('deepMergePatch', () => {
  it('merges nested objects key by key', () => {
    const merged = deepMergePatch(
      { abstract: { content: 'old', extra: 1 }, title: 'T' },
      { abstract: { content: 'new' } }
    )
    expect(merged).toEqual({ abstract: { content: 'new', extra: 1 }, title: 'T' })
  })

  it('replaces arrays wholesale instead of merging by index', () => {
    const merged = deepMergePatch({ authors: [{ id: 'a1' }, { id: 'a2' }] }, { authors: [{ id: 'a3' }] })
    expect(merged).toEqual({ authors: [{ id: 'a3' }] })
  })

  it('replaces scalars and honours an explicit null', () => {
    expect(deepMergePatch({ doi: '10.1/x', significance: 'why' }, { doi: null })).toEqual({
      doi: null,
      significance: 'why'
    })
  })

  it('ignores undefined values so a partial patch never clears a field', () => {
    expect(deepMergePatch({ title: 'T' }, { title: undefined })).toEqual({ title: 'T' })
  })

  it('does not mutate the base object', () => {
    const base = { abstract: { content: 'old' } }
    deepMergePatch(base, { abstract: { content: 'new' } })
    expect(base.abstract.content).toBe('old')
  })
})

describe('updateManuscript', () => {
  it('applies a nested patch and writes schema-valid JSON to disk', async () => {
    const merged = await updateManuscript(dir, { abstract: { content: 'Revised abstract.' } })
    expect(merged['title']).toBe('Ram pressure at cosmic noon')
    const file = await onDisk()
    expect(file['abstract']).toEqual({ content: 'Revised abstract.' })
    expect(ManuscriptSchema.safeParse(file).success).toBe(true)
  })

  it('renames an author by replacing the authors array', async () => {
    const authors = [
      {
        id: 'a1',
        given: 'Grace',
        family: 'Hopper',
        nativeScript: null,
        orcid: null,
        affiliationRefs: ['af1'],
        corresponding: true,
        email: null,
        equalContribution: false,
        deceased: false
      }
    ]
    await updateManuscript(dir, { authors })
    const file = await onDisk()
    expect(file['authors']).toEqual(authors)
  })

  it('re-reads the file so a concurrent agent edit is never overwritten', async () => {
    const agentEdited = { ...fixtureManuscript(), keywords: ['agent keyword'] }
    await writeFile(manuscriptFile, JSON.stringify(agentEdited, null, 2) + '\n', 'utf8')
    await updateManuscript(dir, { title: 'Human title' })
    const file = await onDisk()
    expect(file['keywords']).toEqual(['agent keyword'])
    expect(file['title']).toBe('Human title')
  })

  it('rejects an invalid patch and leaves the file untouched', async () => {
    const before = await readFile(manuscriptFile, 'utf8')
    await expect(updateManuscript(dir, { articleType: 'blog-post' })).rejects.toThrow()
    await expect(updateManuscript(dir, { manuscriptFile: '' })).rejects.toThrow()
    await expect(updateManuscript(dir, ['not', 'an', 'object'])).rejects.toThrow(
      /patch must be an object/
    )
    expect(await readFile(manuscriptFile, 'utf8')).toBe(before)
  })

  it('rejects a nested invalid value without writing', async () => {
    const before = await readFile(manuscriptFile, 'utf8')
    await expect(
      updateManuscript(dir, { openAccess: { license: '', copyrightHolder: 'x', year: 2026 } })
    ).rejects.toThrow()
    expect(await readFile(manuscriptFile, 'utf8')).toBe(before)
  })

  it('preserves unknown top-level keys already in the file', async () => {
    await writeFile(
      manuscriptFile,
      JSON.stringify({ ...fixtureManuscript(), futureField: { keep: true } }, null, 2) + '\n',
      'utf8'
    )
    await updateManuscript(dir, { title: 'Still here' })
    expect((await onDisk())['futureField']).toEqual({ keep: true })
  })

  it('refuses a directory outside every open project', async () => {
    await expect(updateManuscript(join(tmpdir(), 'not-a-suna-project'), {})).rejects.toThrow(
      /outside any open project/
    )
  })

  it('reads the manuscript back validated', async () => {
    const read = await readManuscript(dir)
    expect(read['title']).toBe('Ram pressure at cosmic noon')
  })
})
