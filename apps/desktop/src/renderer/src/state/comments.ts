import { create } from 'zustand'
import {
  CommentsFileSchema,
  type Comment,
  type CommentAuthor,
  type CommentsFile,
  type CommentTarget,
  type Reply
} from '@suna/core'
import { locate } from '../comments/anchor'
import { useProjectStore } from './project'
import { useUiStore } from './ui'

/**
 * manuscript/comments.json state for the Comments sidebar view and the
 * combined manuscript tab's per-section anchor decorations
 * (manuscript/SectionEditor.tsx). Loads/saves through the frozen
 * comments:read / comments:write IPC contract — every mutation re-persists
 * the WHOLE file (main re-validates with CommentsFileSchema before writing,
 * same discipline as manuscript.json).
 */

export type CommentFilter = 'all' | 'open' | 'resolved' | 'mine'

export interface CommentDraft {
  target: CommentTarget
  /** Short human-readable label shown above the compose box, e.g. the quote. */
  preview: string
}

export interface FlashRequest {
  commentId: string
  nonce: number
}

const AUTHOR_NAME_KEY = 'suna.commentAuthorName'
const DEFAULT_AUTHOR_NAME = 'You'

/** Best-effort local identity for human comments; no cross-zone settings dependency. */
export function readLocalAuthorName(): string {
  try {
    const raw = window.localStorage.getItem(AUTHOR_NAME_KEY)
    return raw !== null && raw.trim().length > 0 ? raw : DEFAULT_AUTHOR_NAME
  } catch {
    return DEFAULT_AUTHOR_NAME
  }
}

export function setLocalAuthorName(name: string): void {
  const trimmed = name.trim()
  try {
    window.localStorage.setItem(AUTHOR_NAME_KEY, trimmed.length > 0 ? trimmed : DEFAULT_AUTHOR_NAME)
  } catch {
    // best-effort — the in-memory name for this session still applies
  }
}

function localAuthor(): CommentAuthor {
  return { kind: 'human', name: readLocalAuthorName() }
}

function makeId(prefix: 'c' | 'r'): string {
  const date = new Date().toISOString().slice(0, 10)
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(16).slice(2, 10)
  return `${prefix}-${date}-${random}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Filter predicate shared by the sidebar's filter chips and their counts. */
export function filteredComments(
  comments: readonly Comment[],
  filter: CommentFilter,
  authorName: string
): Comment[] {
  switch (filter) {
    case 'open':
      return comments.filter((c) => !c.resolved)
    case 'resolved':
      return comments.filter((c) => c.resolved)
    case 'mine':
      return comments.filter((c) => c.author.kind === 'human' && c.author.name === authorName)
    default:
      return [...comments]
  }
}

/** Derived path -> comments map the section editors use for their anchor decorations. */
export function commentsByPath(comments: readonly Comment[]): Map<string, Comment[]> {
  const map = new Map<string, Comment[]>()
  for (const comment of comments) {
    if (comment.target.kind !== 'section') continue
    const path = comment.target.path
    const list = map.get(path)
    if (list) list.push(comment)
    else map.set(path, [comment])
  }
  return map
}

/**
 * Re-locate every section-target comment against its saved file text and
 * flip `detached` to match — never removes a comment, per the anchoring
 * rule. Returns the (possibly unchanged) list plus whether anything flipped.
 */
async function recomputeDetached(
  rootDir: string,
  comments: readonly Comment[]
): Promise<{ comments: Comment[]; changed: boolean }> {
  const textCache = new Map<string, string | null>()
  let changed = false
  const next = await Promise.all(
    comments.map(async (comment): Promise<Comment> => {
      if (comment.target.kind !== 'section') return comment
      const path = comment.target.path
      if (!textCache.has(path)) {
        try {
          const { content } = await window.suna.invoke('fs:read-text', {
            path: `${rootDir}/manuscript/${path}`
          })
          textCache.set(path, content)
        } catch {
          textCache.set(path, null)
        }
      }
      const text = textCache.get(path) ?? null
      const detached = text === null ? true : locate(text, comment.target.anchor) === null
      if (detached === comment.detached) return comment
      changed = true
      return { ...comment, detached }
    })
  )
  return { comments: next, changed }
}

async function persist(rootDir: string, comments: readonly Comment[]): Promise<void> {
  const file: CommentsFile = { schemaVersion: 1, comments: [...comments] }
  await window.suna.invoke('comments:write', { dir: rootDir, file })
}

interface CommentsState {
  rootDir: string | null
  comments: Comment[]
  loaded: boolean
  loading: boolean
  error: string | null
  filter: CommentFilter
  draft: CommentDraft | null
  flashRequest: FlashRequest | null

  load: (rootDir: string) => Promise<void>
  setFilter: (filter: CommentFilter) => void
  startDraft: (target: CommentTarget, preview: string) => void
  cancelDraft: () => void
  requestFlash: (commentId: string) => void
  add: (target: CommentTarget, body: string) => Promise<Comment | null>
  reply: (id: string, body: string) => Promise<void>
  resolve: (id: string, resolved: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  rootDir: null,
  comments: [],
  loaded: false,
  loading: false,
  error: null,
  filter: 'all',
  draft: null,
  flashRequest: null,

  setFilter: (filter) => set({ filter }),

  startDraft: (target, preview) => set({ draft: { target, preview } }),
  cancelDraft: () => set({ draft: null }),

  requestFlash: (commentId) =>
    set((s) => ({ flashRequest: { commentId, nonce: (s.flashRequest?.nonce ?? 0) + 1 } })),

  load: async (rootDir) => {
    if (get().loading && get().rootDir === rootDir) return
    set({ rootDir, loading: true, error: null })
    let file: CommentsFile
    try {
      const res = await window.suna.invoke('comments:read', { dir: rootDir })
      file = CommentsFileSchema.parse(res.file)
    } catch (error) {
      set({ loaded: true, loading: false, error: errorMessage(error) })
      return
    }
    const { comments, changed } = await recomputeDetached(rootDir, file.comments)
    // the project may have switched while this was in flight
    if (get().rootDir !== rootDir) return
    set({ comments, loaded: true, loading: false, error: null })
    if (changed) {
      try {
        await persist(rootDir, comments)
      } catch {
        // best-effort re-anchor persistence; the next load retries
      }
    }
  },

  add: async (target, body) => {
    const rootDir = get().rootDir
    const trimmed = body.trim()
    if (rootDir === null || trimmed.length === 0) return null
    const comment: Comment = {
      id: makeId('c'),
      target,
      body: trimmed,
      author: localAuthor(),
      createdAt: new Date().toISOString(),
      resolved: false,
      detached: false,
      replies: []
    }
    const next = [...get().comments, comment]
    set({ comments: next })
    try {
      await persist(rootDir, next)
      useProjectStore.getState().noteFileSaved(`${rootDir}/manuscript/comments.json`)
      return comment
    } catch (error) {
      set({ comments: get().comments.filter((c) => c.id !== comment.id) })
      useUiStore.getState().setStatusNote(`Could not save comment: ${errorMessage(error)}`)
      return null
    }
  },

  reply: async (id, body) => {
    const rootDir = get().rootDir
    const trimmed = body.trim()
    if (rootDir === null || trimmed.length === 0) return
    const reply: Reply = {
      id: makeId('r'),
      body: trimmed,
      author: localAuthor(),
      createdAt: new Date().toISOString()
    }
    const prev = get().comments
    const next = prev.map((c) => (c.id === id ? { ...c, replies: [...c.replies, reply] } : c))
    set({ comments: next })
    try {
      await persist(rootDir, next)
    } catch (error) {
      set({ comments: prev })
      useUiStore.getState().setStatusNote(`Could not save reply: ${errorMessage(error)}`)
    }
  },

  resolve: async (id, resolved) => {
    const rootDir = get().rootDir
    if (rootDir === null) return
    const prev = get().comments
    const next = prev.map((c) => (c.id === id ? { ...c, resolved } : c))
    set({ comments: next })
    try {
      await persist(rootDir, next)
    } catch (error) {
      set({ comments: prev })
      useUiStore.getState().setStatusNote(`Could not update comment: ${errorMessage(error)}`)
    }
  },

  remove: async (id) => {
    const rootDir = get().rootDir
    if (rootDir === null) return
    const prev = get().comments
    const next = prev.filter((c) => c.id !== id)
    set({ comments: next })
    try {
      await persist(rootDir, next)
    } catch (error) {
      set({ comments: prev })
      useUiStore.getState().setStatusNote(`Could not delete comment: ${errorMessage(error)}`)
    }
  }
}))
