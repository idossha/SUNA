import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  CommentsFileSchema,
  emptyCommentsFile,
  makeAnchor,
  type Comment,
  type CommentAuthor,
  type CommentsFile,
  type Reply
} from '@suna/core'
import { resolveInside, type ProjectContext } from './project'

/**
 * MCP-side comment verbs. These read/write manuscript/comments.json directly
 * on disk — same discipline as the app's main-process service (read fresh,
 * validate with CommentsFileSchema, write atomically) — because the MCP
 * server runs standalone, without the Electron app, and cannot import its
 * main-process services. Anchoring for `add_comment` reuses the exact same
 * `makeAnchor` from @suna/core that the renderer's comment UI uses
 * (apps/desktop/src/renderer/src/comments/anchor.ts re-exports it), so a
 * quote anchored here and one anchored by a human in the app resolve
 * identically.
 */

/**
 * Comment authorship is read from the environment at call time so different
 * agent CLIs sharing one .mcp.json identify themselves distinctly (set the
 * variables in .mcp.json's env block or the launching shell). Exported for
 * tests.
 */
export function agentAuthor(env: NodeJS.ProcessEnv = process.env): CommentAuthor {
  const name = env['SUNA_AGENT_NAME']?.trim()
  const model = env['SUNA_AGENT_MODEL']?.trim()
  return {
    kind: 'agent',
    name: name !== undefined && name !== '' ? name : 'Agent',
    ...(model !== undefined && model !== '' ? { model } : {})
  }
}

function makeId(prefix: 'c' | 'r'): string {
  const date = new Date().toISOString().slice(0, 10)
  const random = randomUUID().replace(/-/g, '').slice(0, 8)
  return `${prefix}-${date}-${random}`
}

async function commentsJsonPath(ctx: ProjectContext): Promise<string> {
  return resolveInside(ctx.root, ctx.dirs.manuscript, 'comments.json')
}

async function readCommentsFile(ctx: ProjectContext): Promise<CommentsFile> {
  const path = await commentsJsonPath(ctx)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return emptyCommentsFile()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `comments.json is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return CommentsFileSchema.parse(parsed)
}

async function writeCommentsFile(ctx: ProjectContext, file: CommentsFile): Promise<void> {
  const validated = CommentsFileSchema.parse(file)
  const path = await commentsJsonPath(ctx)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(validated, null, 2) + '\n', 'utf8')
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

function formatTarget(target: Comment['target']): string {
  if (target.kind === 'section') return `section:${target.path}`
  if (target.kind === 'figure') {
    return `figure:${target.figureId}${target.elementId !== undefined ? `#${target.elementId}` : ''}`
  }
  return 'manuscript'
}

function formatAuthor(author: CommentAuthor): string {
  return author.kind === 'agent' ? `${author.name} (agent)` : author.name
}

function formatComment(comment: Comment): string {
  const status = comment.resolved ? 'resolved' : 'open'
  const detached = comment.detached ? ' detached' : ''
  const lines = [
    `${comment.id} [${status}${detached}] ${formatTarget(comment.target)}`,
    comment.target.kind === 'section' ? `  quote: ${JSON.stringify(comment.target.anchor.quote)}` : null,
    `  ${formatAuthor(comment.author)}: ${comment.body}`,
    ...comment.replies.map((reply) => `    -> ${formatAuthor(reply.author)}: ${reply.body}`)
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

export const listCommentsInput = z.object({
  /** Only comments whose `resolved` flag matches, when given. */
  resolved: z.boolean().optional(),
  /** Only comments targeting this manuscript-relative section path, when given. */
  path: z.string().min(1).optional()
})

export async function listComments(
  ctx: ProjectContext,
  input: z.infer<typeof listCommentsInput>
): Promise<string> {
  const file = await readCommentsFile(ctx)
  const rows = file.comments.filter((comment) => {
    if (input.resolved !== undefined && comment.resolved !== input.resolved) return false
    if (input.path !== undefined) {
      if (comment.target.kind !== 'section' || comment.target.path !== input.path) return false
    }
    return true
  })
  if (rows.length === 0) return 'no comments'
  return rows.map(formatComment).join('\n\n')
}

export const addCommentInput = z.object({
  /** Prose file path relative to manuscript/ — normally "manuscript.md". */
  path: z.string().min(1),
  /** Exact substring to anchor on; the first occurrence is used. */
  quote: z.string().min(1),
  body: z.string().min(1)
})

export async function addComment(
  ctx: ProjectContext,
  input: z.infer<typeof addCommentInput>
): Promise<string> {
  const text = await readFile(resolveInside(ctx.root, ctx.dirs.manuscript, input.path), 'utf8')
  const from = text.indexOf(input.quote)
  if (from === -1) {
    throw new Error(`quote not found in ${input.path}: ${JSON.stringify(input.quote)}`)
  }
  const to = from + input.quote.length
  const anchor = makeAnchor(text, from, to)
  const file = await readCommentsFile(ctx)
  const comment: Comment = {
    id: makeId('c'),
    target: { kind: 'section', path: input.path, anchor },
    body: input.body,
    author: agentAuthor(),
    createdAt: new Date().toISOString(),
    resolved: false,
    detached: false,
    replies: []
  }
  await writeCommentsFile(ctx, { schemaVersion: 1, comments: [...file.comments, comment] })
  return `added ${comment.id} on ${JSON.stringify(anchor.quote)} in ${input.path}`
}

export const replyCommentInput = z.object({
  id: z.string().min(1),
  body: z.string().min(1)
})

export async function replyComment(
  ctx: ProjectContext,
  input: z.infer<typeof replyCommentInput>
): Promise<string> {
  const file = await readCommentsFile(ctx)
  if (!file.comments.some((comment) => comment.id === input.id)) {
    throw new Error(`no comment with id ${input.id}`)
  }
  const reply: Reply = {
    id: makeId('r'),
    body: input.body,
    author: agentAuthor(),
    createdAt: new Date().toISOString()
  }
  const comments = file.comments.map((comment) =>
    comment.id === input.id ? { ...comment, replies: [...comment.replies, reply] } : comment
  )
  await writeCommentsFile(ctx, { schemaVersion: 1, comments })
  return `replied to ${input.id}`
}

export const resolveCommentInput = z.object({
  id: z.string().min(1),
  resolved: z.boolean()
})

export async function resolveComment(
  ctx: ProjectContext,
  input: z.infer<typeof resolveCommentInput>
): Promise<string> {
  const file = await readCommentsFile(ctx)
  if (!file.comments.some((comment) => comment.id === input.id)) {
    throw new Error(`no comment with id ${input.id}`)
  }
  const comments = file.comments.map((comment) =>
    comment.id === input.id ? { ...comment, resolved: input.resolved } : comment
  )
  await writeCommentsFile(ctx, { schemaVersion: 1, comments })
  return `${input.id} marked ${input.resolved ? 'resolved' : 'open'}`
}
