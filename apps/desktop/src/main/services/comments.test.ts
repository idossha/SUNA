import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommentsFile } from '@suna/core'
import { readCommentsFile, writeCommentsFile } from './comments'
import { allowRoot } from './roots'

let dir = ''
let commentsFile = ''

const anchoredComment = {
  id: 'c-2026-08-14-a1b2',
  target: {
    kind: 'section' as const,
    path: 'sections/02-results.md',
    anchor: { quote: 'best-fit centroid of 6563.3', prefix: '…with a ', suffix: ' Å and σ…' }
  },
  body: 'Should this be the vacuum wavelength?',
  author: { kind: 'human' as const, name: 'Ada' },
  createdAt: '2026-08-14T21:03:00Z',
  resolved: false
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-comments-'))
  allowRoot(dir)
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  commentsFile = join(dir, 'manuscript', 'comments.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readCommentsFile', () => {
  it('returns an empty file when comments.json does not exist yet', async () => {
    const file = await readCommentsFile(dir)
    expect(file).toEqual({ schemaVersion: 1, comments: [] })
  })

  it('does not create the file as a side effect of reading', async () => {
    await readCommentsFile(dir)
    await expect(readFile(commentsFile, 'utf8')).rejects.toThrow()
  })

  it('fills defaults for detached and replies', async () => {
    await writeFile(
      commentsFile,
      JSON.stringify({ schemaVersion: 1, comments: [anchoredComment] }),
      'utf8'
    )
    const file = await readCommentsFile(dir)
    expect(file.comments[0]?.detached).toBe(false)
    expect(file.comments[0]?.replies).toEqual([])
  })

  it('throws rather than silently dropping a corrupt comments.json', async () => {
    await writeFile(commentsFile, '{ not json', 'utf8')
    await expect(readCommentsFile(dir)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects a file whose comments fail the schema', async () => {
    await writeFile(
      commentsFile,
      JSON.stringify({ schemaVersion: 1, comments: [{ id: 'c1' }] }),
      'utf8'
    )
    await expect(readCommentsFile(dir)).rejects.toThrow()
  })
})

describe('writeCommentsFile', () => {
  it('creates comments.json on first write and round-trips through read', async () => {
    await writeCommentsFile(dir, { schemaVersion: 1, comments: [anchoredComment] })
    const raw = await readFile(commentsFile, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    const file = await readCommentsFile(dir)
    expect(file.comments).toHaveLength(1)
    expect(file.comments[0]?.body).toBe('Should this be the vacuum wavelength?')
  })

  it('persists a reply thread and a resolved flag', async () => {
    const withReply: CommentsFile = {
      schemaVersion: 1,
      comments: [
        {
          ...anchoredComment,
          resolved: true,
          detached: false,
          replies: [
            {
              id: 'r-1',
              body: 'Air wavelength, matching the instrument docs.',
              author: { kind: 'agent', name: 'Reviewer', model: 'claude-opus-4' },
              createdAt: '2026-08-14T21:20:00Z'
            }
          ]
        }
      ]
    }
    await writeCommentsFile(dir, withReply)
    const file = await readCommentsFile(dir)
    expect(file.comments[0]?.resolved).toBe(true)
    expect(file.comments[0]?.replies[0]?.author.kind).toBe('agent')
  })

  it('keeps a detached comment instead of dropping it', async () => {
    await writeCommentsFile(dir, {
      schemaVersion: 1,
      comments: [{ ...anchoredComment, detached: true }]
    })
    expect((await readCommentsFile(dir)).comments[0]?.detached).toBe(true)
  })

  it('validates before writing — an invalid file never reaches disk', async () => {
    await expect(
      writeCommentsFile(dir, { schemaVersion: 1, comments: [{ id: 'c1', body: '' }] })
    ).rejects.toThrow()
    await expect(readFile(commentsFile, 'utf8')).rejects.toThrow()
  })

  it('refuses a directory outside every open project', async () => {
    await expect(
      writeCommentsFile(join(tmpdir(), 'not-a-suna-project'), { schemaVersion: 1, comments: [] })
    ).rejects.toThrow(/outside any open project/)
  })
})
