import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PROJECT_DIRS, type CommentsFile } from '@suna/core'
import { addComment, agentAuthor, listComments, replyComment, resolveComment } from './comments'
import type { ProjectContext } from './project'

let dir = ''
let ctx: ProjectContext

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-mcp-comments-'))
  await mkdir(join(dir, 'manuscript', 'sections'), { recursive: true })
  await writeFile(
    join(dir, 'manuscript', 'sections', '02-results.md'),
    'We measured a best-fit centroid of 6563.3 Å with high confidence.',
    'utf8'
  )
  ctx = { root: dir, name: 'test', activeProfileId: null, dirs: { ...DEFAULT_PROJECT_DIRS } }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readCommentsJson(): Promise<CommentsFile> {
  const raw = await readFile(join(dir, 'manuscript', 'comments.json'), 'utf8')
  return JSON.parse(raw) as CommentsFile
}

describe('listComments', () => {
  it('reports "no comments" when comments.json does not exist yet', async () => {
    expect(await listComments(ctx, {})).toBe('no comments')
  })

  it('lists an added comment with its quote and author', async () => {
    await addComment(ctx, {
      path: 'sections/02-results.md',
      quote: 'best-fit centroid of 6563.3',
      body: 'Vacuum or air wavelength?'
    })
    const out = await listComments(ctx, {})
    expect(out).toContain('Agent (agent): Vacuum or air wavelength?')
    expect(out).toContain('"best-fit centroid of 6563.3"')
    expect(out).toContain('[open]')
  })

  it('filters by resolved status', async () => {
    const added = await addComment(ctx, {
      path: 'sections/02-results.md',
      quote: 'high confidence',
      body: 'Quantify this.'
    })
    const id = added.split(' ')[1] as string
    expect(await listComments(ctx, { resolved: true })).toBe('no comments')
    await resolveComment(ctx, { id, resolved: true })
    expect(await listComments(ctx, { resolved: true })).toContain(id)
    expect(await listComments(ctx, { resolved: false })).toBe('no comments')
  })

  it('filters by section path', async () => {
    await addComment(ctx, {
      path: 'sections/02-results.md',
      quote: 'high confidence',
      body: 'On results.'
    })
    expect(await listComments(ctx, { path: 'sections/02-results.md' })).toContain('On results.')
    expect(await listComments(ctx, { path: 'sections/01-intro.md' })).toBe('no comments')
  })
})

describe('addComment', () => {
  it('anchors on the exact quote and writes a schema-valid comments.json', async () => {
    await addComment(ctx, {
      path: 'sections/02-results.md',
      quote: 'best-fit centroid of 6563.3',
      body: 'Check the rest wavelength.'
    })
    const file = await readCommentsJson()
    expect(file.schemaVersion).toBe(1)
    expect(file.comments).toHaveLength(1)
    const comment = file.comments[0]
    expect(comment?.target).toEqual({
      kind: 'section',
      path: 'sections/02-results.md',
      anchor: {
        quote: 'best-fit centroid of 6563.3',
        prefix: 'We measured a ',
        suffix: ' Å with high confidence.'
      }
    })
    expect(comment?.author).toEqual({ kind: 'agent', name: 'Agent' })
    expect(comment?.resolved).toBe(false)
    expect(comment?.detached).toBe(false)
  })

  it('throws when the quote is not found, and writes nothing', async () => {
    await expect(
      addComment(ctx, { path: 'sections/02-results.md', quote: 'nonexistent phrase', body: 'x' })
    ).rejects.toThrow(/quote not found/)
    await expect(readCommentsJson()).rejects.toThrow()
  })

  it('appends to existing comments rather than clobbering them', async () => {
    await addComment(ctx, { path: 'sections/02-results.md', quote: 'high confidence', body: 'first' })
    await addComment(ctx, { path: 'sections/02-results.md', quote: 'best-fit centroid', body: 'second' })
    const file = await readCommentsJson()
    expect(file.comments).toHaveLength(2)
  })

  it('refuses a path outside the project root', async () => {
    await expect(
      addComment(ctx, { path: '../../outside.md', quote: 'x', body: 'y' })
    ).rejects.toThrow(/escapes the project root/)
  })
})

describe('replyComment', () => {
  it('appends a reply authored by the agent', async () => {
    const added = await addComment(ctx, {
      path: 'sections/02-results.md',
      quote: 'high confidence',
      body: 'Quantify this.'
    })
    const id = added.split(' ')[1] as string
    await replyComment(ctx, { id, body: 'Will add a sigma value.' })
    const file = await readCommentsJson()
    expect(file.comments[0]?.replies).toHaveLength(1)
    expect(file.comments[0]?.replies[0]).toMatchObject({
      body: 'Will add a sigma value.',
      author: { kind: 'agent', name: 'Agent' }
    })
  })

  it('throws for an unknown comment id', async () => {
    await expect(replyComment(ctx, { id: 'c-does-not-exist', body: 'x' })).rejects.toThrow(
      /no comment with id/
    )
  })
})

describe('resolveComment', () => {
  it('flips the resolved flag both ways', async () => {
    const added = await addComment(ctx, {
      path: 'sections/02-results.md',
      quote: 'high confidence',
      body: 'Quantify this.'
    })
    const id = added.split(' ')[1] as string
    await resolveComment(ctx, { id, resolved: true })
    expect((await readCommentsJson()).comments[0]?.resolved).toBe(true)
    await resolveComment(ctx, { id, resolved: false })
    expect((await readCommentsJson()).comments[0]?.resolved).toBe(false)
  })

  it('throws for an unknown comment id', async () => {
    await expect(resolveComment(ctx, { id: 'c-does-not-exist', resolved: true })).rejects.toThrow(
      /no comment with id/
    )
  })
})

describe('agentAuthor', () => {
  it('defaults to a generic agent identity with no env set', () => {
    expect(agentAuthor({})).toEqual({ kind: 'agent', name: 'Agent' })
  })

  it('takes name and model from SUNA_AGENT_NAME / SUNA_AGENT_MODEL', () => {
    expect(
      agentAuthor({ SUNA_AGENT_NAME: 'Claude Code', SUNA_AGENT_MODEL: 'claude-fable-5' })
    ).toEqual({ kind: 'agent', name: 'Claude Code', model: 'claude-fable-5' })
  })

  it('ignores blank values rather than producing empty fields', () => {
    expect(agentAuthor({ SUNA_AGENT_NAME: '  ', SUNA_AGENT_MODEL: '' })).toEqual({
      kind: 'agent',
      name: 'Agent'
    })
  })
})
