import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  CommentsFileSchema,
  emptyCommentsFile,
  locate,
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

// There is deliberately NO resolve verb: resolving a thread is a human
// judgment made in the app. Agents reply on the thread; the human resolves.

/**
 * Re-anchor comments across an in-place text edit.
 *
 * A human's comment points at a span of prose. When an agent rewrites that
 * prose — which is the whole point of the ✦ AI action on a comment card —
 * the stored quote stops existing, `locate()` returns null, and the comment
 * the agent was answering silently falls into the rail's "detached" bucket.
 * That is exactly backwards: the comment is more relevant after the edit,
 * not less.
 *
 * So instead of letting the edit orphan them, we map every comment's located
 * range through the edit and re-derive its anchor from the NEW text:
 *
 *  - span entirely before the edit  → unchanged offsets
 *  - span entirely after the edit   → shifted by the length delta
 *  - span overlapping the edit      → widened to cover the replacement, so a
 *    comment on rewritten prose now quotes the rewrite
 *
 * A comment that was already detached before the edit stays detached (there
 * was no range to map), and one whose span the edit deleted outright falls
 * back to the line that took its place — never to nothing.
 *
 * Failures here are swallowed by the caller: an edit that succeeded on disk
 * must not be reported as failed because the sidecar could not be updated.
 */
export async function reanchorAfterEdit(
  ctx: ProjectContext,
  path: string,
  before: string,
  after: string,
  at: number,
  removedLength: number,
  insertedLength: number
): Promise<void> {
  const file = await readCommentsFile(ctx)
  const editEnd = at + removedLength
  const delta = insertedLength - removedLength
  let changed = false

  const comments = file.comments.map((comment): Comment => {
    if (comment.target.kind !== 'section' || comment.target.path !== path) return comment
    const range = locate(before, comment.target.anchor)
    if (range === null) return comment // already detached — nothing to map

    let from: number
    let to: number
    if (range.to <= at) {
      ;[from, to] = [range.from, range.to]
    } else if (range.from >= editEnd) {
      ;[from, to] = [range.from + delta, range.to + delta]
    } else {
      // overlap: cover the replacement plus whatever of the span survived
      from = Math.min(range.from, at)
      to = Math.max(range.to, editEnd) + delta
    }
    if (to <= from) {
      // the edit deleted the whole span — hold the position by anchoring to
      // the line that now occupies it rather than dropping to detached
      const lineStart = after.lastIndexOf('\n', Math.max(0, from - 1)) + 1
      const lineEndRaw = after.indexOf('\n', from)
      const lineEnd = lineEndRaw === -1 ? after.length : lineEndRaw
      if (lineEnd <= lineStart) {
        if (comment.detached) return comment
        changed = true
        return { ...comment, detached: true }
      }
      from = lineStart
      to = lineEnd
    }
    from = Math.max(0, Math.min(from, after.length))
    to = Math.max(from, Math.min(to, after.length))

    const anchor = makeAnchor(after, from, to)
    const old = comment.target.anchor
    if (
      !comment.detached &&
      anchor.quote === old.quote &&
      anchor.prefix === old.prefix &&
      anchor.suffix === old.suffix
    ) {
      return comment
    }
    changed = true
    return { ...comment, detached: false, target: { ...comment.target, anchor } }
  })

  if (!changed) return
  await writeCommentsFile(ctx, { schemaVersion: 1, comments })
}

/**
 * Re-tighten every comment on `path` against freshly written text.
 *
 * The counterpart to `reanchorAfterEdit` for a whole-file overwrite, where
 * there is no edit range to map through: each anchor is re-located (the
 * fuzzy tier survives rewrapped or lightly reworded prose) and its
 * quote/prefix/suffix refreshed from where it landed, so the sidecar never
 * holds a stale anchor. Comments whose quote genuinely no longer exists are
 * marked detached — and stay in the file, interactive in the rail.
 */
export async function retightenAnchors(
  ctx: ProjectContext,
  path: string,
  text: string
): Promise<void> {
  const file = await readCommentsFile(ctx)
  let changed = false
  const comments = file.comments.map((comment): Comment => {
    if (comment.target.kind !== 'section' || comment.target.path !== path) return comment
    const range = locate(text, comment.target.anchor)
    if (range === null) {
      if (comment.detached) return comment
      changed = true
      return { ...comment, detached: true }
    }
    const anchor = makeAnchor(text, range.from, range.to)
    const old = comment.target.anchor
    if (
      !comment.detached &&
      anchor.quote === old.quote &&
      anchor.prefix === old.prefix &&
      anchor.suffix === old.suffix
    ) {
      return comment
    }
    changed = true
    return { ...comment, detached: false, target: { ...comment.target, anchor } }
  })
  if (!changed) return
  await writeCommentsFile(ctx, { schemaVersion: 1, comments })
}
