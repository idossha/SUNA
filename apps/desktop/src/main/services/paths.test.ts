import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commentsJsonPath,
  documentDir,
  documentFile,
  manuscriptJsonPath,
  projectDocument,
  projectDocuments,
  projectPrimaryDocument,
  revisionsJsonPath,
  roundDir,
  roundsDir
} from './paths'

/**
 * feature-plan-12 §1's load-bearing acceptance criterion: a project with no
 * `documents` field in suna.json resolves byte-identical paths through the
 * registry helpers and through the three helpers that predate them.
 */

let dir: string

const DIRS = {
  manuscript: 'manuscript',
  figures: 'figures',
  code: 'code',
  data: 'data',
  analysis: 'analysis',
  results: 'results',
  output: 'output'
}

const writeManifest = async (extra: Record<string, unknown> = {}): Promise<void> => {
  await writeFile(
    join(dir, 'suna.json'),
    JSON.stringify({
      schemaVersion: 1,
      name: 'Fixture',
      activeProfileId: 'nature',
      directories: DIRS,
      createdAt: '2026-08-14T00:00:00.000Z',
      ...extra
    })
  )
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-paths-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('a project with no document registry', () => {
  beforeEach(() => writeManifest())

  it('synthesizes exactly one manuscript entry', async () => {
    const docs = await projectDocuments(dir)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.kind).toBe('manuscript')
    expect((await projectPrimaryDocument(dir)).id).toBe('manuscript')
  })

  it('resolves the manuscript sidecar byte-identically to manuscriptJsonPath', async () => {
    const viaRegistry = await documentFile(dir, await projectPrimaryDocument(dir), 'meta')
    expect(viaRegistry).toBe(await manuscriptJsonPath(dir))
  })

  it('resolves the prose path under the manuscript dir', async () => {
    const prose = await documentFile(dir, await projectPrimaryDocument(dir), 'prose')
    expect(prose).toBe(join(dir, 'manuscript', 'manuscript.md'))
  })

  it('honours manuscript.json:manuscriptFile through the override', async () => {
    const prose = await documentFile(dir, await projectPrimaryDocument(dir), 'prose', 'paper.md')
    expect(prose).toBe(join(dir, 'manuscript', 'paper.md'))
  })

  it('leaves the other two legacy helpers untouched', async () => {
    expect(await commentsJsonPath(dir)).toBe(join(dir, 'manuscript', 'comments.json'))
    expect(await revisionsJsonPath(dir)).toBe(join(dir, 'manuscript', 'revisions.json'))
  })
})

describe('a renamed manuscript directory', () => {
  beforeEach(async () => {
    await writeManifest({ directories: { ...DIRS, manuscript: 'ms-src' } })
  })

  it('is followed by both the legacy helper and the registry helper', async () => {
    expect(await manuscriptJsonPath(dir)).toBe(join(dir, 'ms-src', 'manuscript.json'))
    expect(await documentDir(dir)).toBe(join(dir, 'ms-src'))
    const viaRegistry = await documentFile(dir, await projectPrimaryDocument(dir), 'meta')
    expect(viaRegistry).toBe(await manuscriptJsonPath(dir))
  })
})

describe('a project that declares a registry', () => {
  beforeEach(async () => {
    await writeManifest({
      documents: [
        { id: 'manuscript', kind: 'manuscript', file: null, meta: 'manuscript.json', title: 'Manuscript' },
        {
          id: 'cover-science',
          kind: 'cover-letter',
          file: 'letters/cover-science.md',
          meta: 'letters/cover-science.json',
          title: 'Cover letter'
        }
      ]
    })
  })

  it('resolves a nested letter under the manuscript dir', async () => {
    const letter = await projectDocument(dir, 'cover-science')
    expect(letter).not.toBeNull()
    expect(await documentFile(dir, letter!, 'prose')).toBe(
      join(dir, 'manuscript', 'letters', 'cover-science.md')
    )
  })

  it('still resolves the primary exactly as before', async () => {
    const viaRegistry = await documentFile(dir, await projectPrimaryDocument(dir), 'meta')
    expect(viaRegistry).toBe(await manuscriptJsonPath(dir))
  })

  it('returns null for an unknown document id', async () => {
    expect(await projectDocument(dir, 'absent')).toBeNull()
  })
})

describe('a project whose manifest cannot be read', () => {
  it('degrades to the synthesized registry rather than throwing', async () => {
    // No suna.json at all — projectSubdir already falls back to the defaults,
    // and the registry must degrade the same way.
    const docs = await projectDocuments(dir)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.kind).toBe('manuscript')
  })

  it('degrades on invalid JSON too', async () => {
    await writeFile(join(dir, 'suna.json'), '{ not json')
    expect(await projectDocuments(dir)).toHaveLength(1)
  })
})

describe('rounds/ is fixed at the project root', () => {
  beforeEach(async () => {
    await writeManifest({ directories: { ...DIRS, manuscript: 'ms-src' } })
  })

  it('does not follow directories, because it is not a ProjectDirKey', () => {
    expect(roundsDir(dir)).toBe(join(dir, 'rounds'))
    expect(roundDir(dir, 'round-2')).toBe(join(dir, 'rounds', 'round-2'))
  })
})
