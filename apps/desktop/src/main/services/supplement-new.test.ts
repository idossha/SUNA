import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SunaProjectManifestSchema, resolveDocuments } from '@suna/core'
import { createSupplement } from './supplement-new'

/**
 * Adding the Supplementary Information from the Writing view's "+", against a
 * real project tree on disk.
 */

let dir: string

const MANIFEST = {
  schemaVersion: 1,
  name: 'Fixture',
  activeProfileId: 'nature',
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

const registry = async (): Promise<ReturnType<typeof resolveDocuments>> =>
  resolveDocuments(
    SunaProjectManifestSchema.parse(JSON.parse(await readFile(join(dir, 'suna.json'), 'utf8')))
  )

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-supplement-'))
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  await writeFile(join(dir, 'suna.json'), JSON.stringify(MANIFEST, null, 2), 'utf8')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createSupplement', () => {
  it('seeds supplementary.md and registers it as a supplement document', async () => {
    const res = await createSupplement(dir)
    expect(res).toEqual({
      documentId: 'supplement',
      proseFile: 'supplementary.md',
      fileCreated: true
    })

    const prose = await readFile(join(dir, 'manuscript', 'supplementary.md'), 'utf8')
    expect(prose).toContain('# Supplementary Methods')

    const docs = await registry()
    // The manuscript the manifest never declared is kept, not dropped: the
    // registry was synthesized and is now written out for the first time.
    expect(docs.map((d) => d.kind)).toEqual(['manuscript', 'supplement'])
    expect(docs[1]).toMatchObject({
      id: 'supplement',
      kind: 'supplement',
      file: 'supplementary.md',
      meta: null,
      title: 'Supplementary Information'
    })
  })

  it('adopts a supplementary.md that is already on disk without touching it', async () => {
    await writeFile(join(dir, 'manuscript', 'supplementary.md'), '# Mine\n', 'utf8')
    const res = await createSupplement(dir)
    expect(res.fileCreated).toBe(false)
    expect(await readFile(join(dir, 'manuscript', 'supplementary.md'), 'utf8')).toBe('# Mine\n')
    expect((await registry()).some((d) => d.kind === 'supplement')).toBe(true)
  })

  it('refuses a second supplement — there is one path and it is taken', async () => {
    await createSupplement(dir)
    await expect(createSupplement(dir)).rejects.toThrow(/already has a Supplementary/)
    expect((await registry()).filter((d) => d.kind === 'supplement')).toHaveLength(1)
  })
})
