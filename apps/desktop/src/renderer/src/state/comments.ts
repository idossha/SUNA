import { create } from 'zustand'
import {
  CommentsFileSchema,
  type Comment,
  type CommentAuthor,
  type CommentsFile,
  type CommentTarget,
  type Reply
} from '@suna/core'
import { locate, makeAnchor } from '../comments/anchor'
import { liveAnchorsForPath } from '../comments/anchorExtension'
import { peekDocSessionText, onDocSaved } from './docSessions'
import { useProjectStore } from './project'
import { useUiStore } from './ui'

/**
 * manuscript/comments.json state, shared by every surface that shows
 * comments: the rail (comments/CommentsRail), and both editors' anchor
 * decorations. Loads/saves through the frozen comments:read/comments:write
 * IPC contract — every mutation re-persists the WHOLE file (main
 * re-validates with CommentsFileSchema before writing, same discipline as
 * manuscript.json).
 */

type QuoteAnchor = { quote: string; prefix: string; suffix: string }

export interface CommentDraft {
  target: CommentTarget
  /** Short human-readable label shown above the compose box, e.g. the quote. */
  preview: string
  /** Identity for the composer (its `key`): a NEW draft remounts the compose
   *  box empty instead of silently attaching old text to a new target. */
  nonce: number
}

let nextDraftNonce = 1

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
        // buffer truth first: an open editor's live text outranks disk
        const buffered = peekDocSessionText(`${rootDir}/manuscript/${path}`)
        if (buffered !== null) {
          textCache.set(path, buffered)
        } else {
          try {
            const { content } = await window.suna.invoke('fs:read-text', {
              path: `${rootDir}/manuscript/${path}`
            })
            textCache.set(path, content)
          } catch {
            textCache.set(path, null)
          }
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

/** Serialized snapshot of what was last read from / written to disk — damps
 *  the recomputeDetached→persist→watcher reload cycle to one bounce. */
let lastPersisted: string | null = null

/** A watcher event arrived while a draft/reply was being composed; run the
 *  deferred reload once composing ends instead of dropping the event. */
let reloadPending = false

function runPendingReload(): void {
  if (!reloadPending) return
  reloadPending = false
  const s = useCommentsStore.getState()
  if (s.rootDir !== null) void s.load(s.rootDir)
}

/**
 * Whole-file write with a merge-by-id pass against the file on disk first:
 * a comment an EXTERNAL writer added since our last read (an agent's
 * add_comment over MCP) is preserved — appended — instead of silently
 * erased, unless it is in `removedIds` (a deliberate local delete).
 */
async function persist(
  rootDir: string,
  comments: readonly Comment[],
  removedIds: readonly string[] = []
): Promise<void> {
  const merged = [...comments]
  try {
    const res = await window.suna.invoke('comments:read', { dir: rootDir })
    const fresh = CommentsFileSchema.parse(res.file)
    const known = new Set(comments.map((c) => c.id))
    const removed = new Set(removedIds)
    for (const external of fresh.comments) {
      if (!known.has(external.id) && !removed.has(external.id)) merged.push(external)
    }
  } catch {
    // unreadable/missing sidecar — write what we have
  }
  const file: CommentsFile = { schemaVersion: 1, comments: merged }
  await window.suna.invoke('comments:write', { dir: rootDir, file })
  lastPersisted = JSON.stringify(file)
  if (merged.length !== comments.length && useCommentsStore.getState().rootDir === rootDir) {
    // adopt the preserved external comments into memory too
    useCommentsStore.setState({ comments: merged })
  }
}

interface CommentsState {
  rootDir: string | null
  comments: Comment[]
  loaded: boolean
  loading: boolean
  error: string | null
  draft: CommentDraft | null
  flashRequest: FlashRequest | null
  /** The rail's focused thread (also drives the editor's active highlight). */
  activeId: string | null
  /** True while a reply/draft textarea has focus — guards external reloads. */
  composing: boolean

  load: (rootDir: string) => Promise<void>
  startDraft: (target: CommentTarget, preview: string) => void
  cancelDraft: () => void
  requestFlash: (commentId: string) => void
  setActive: (id: string | null) => void
  setComposing: (composing: boolean) => void
  add: (target: CommentTarget, body: string) => Promise<Comment | null>
  reply: (id: string, body: string) => Promise<void>
  /** `refreshedAnchor`: the live range's anchor, snapshotted BEFORE the mark
   *  disappears on resolve (flux PAP-9) — reopening then re-anchors exactly. */
  resolve: (id: string, resolved: boolean, refreshedAnchor?: QuoteAnchor) => Promise<void>
  remove: (id: string) => Promise<boolean>
  /** Delete now + app-shell Undo toast (no confirm — the flux pattern). */
  removeWithUndo: (id: string) => Promise<void>
  /** Reinsert an exact comment at its original index (the Undo action). */
  restore: (comment: Comment, index: number) => Promise<void>
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  rootDir: null,
  comments: [],
  loaded: false,
  loading: false,
  error: null,
  draft: null,
  flashRequest: null,
  activeId: null,
  composing: false,

  startDraft: (target, preview) => {
    nextDraftNonce += 1
    set({ draft: { target, preview, nonce: nextDraftNonce } })
    // the composer lives in the rail — summon it (locked decision: auto-open)
    useUiStore.getState().setCommentsRailVisible(true)
  },
  cancelDraft: () => {
    set({ draft: null })
    runPendingReload()
  },
  setActive: (id) => set({ activeId: id }),
  setComposing: (composing) => {
    set({ composing })
    if (!composing) runPendingReload()
  },

  requestFlash: (commentId) =>
    set((s) => ({ flashRequest: { commentId, nonce: (s.flashRequest?.nonce ?? 0) + 1 } })),

  load: async (rootDir) => {
    if (get().loading && get().rootDir === rootDir) return
    const sameProject = get().rootDir === rootDir && get().loaded
    set({ rootDir, loading: true, error: null })
    let file: CommentsFile
    try {
      const res = await window.suna.invoke('comments:read', { dir: rootDir })
      file = CommentsFileSchema.parse(res.file)
    } catch (error) {
      set({ loaded: true, loading: false, error: errorMessage(error) })
      return
    }
    // A reload that finds exactly what we last read/wrote (our own persist
    // echoing back through the watcher) settles without another full pass —
    // but anchor maintenance still runs: the PROSE may be what changed, and
    // `detached` must track it even when comments.json itself is unchanged.
    const raw = JSON.stringify(file)
    if (sameProject && raw === lastPersisted) {
      const rechecked = await recomputeDetached(rootDir, file.comments)
      if (get().rootDir !== rootDir) return
      if (rechecked.changed) {
        set({ comments: rechecked.comments, loading: false })
        try {
          await persist(rootDir, rechecked.comments)
        } catch {
          // best-effort; the next reload retries
        }
      } else {
        set({ loading: false })
      }
      return
    }
    lastPersisted = raw
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

  resolve: async (id, resolved, refreshedAnchor) => {
    const rootDir = get().rootDir
    if (rootDir === null) return
    const prev = get().comments
    const next = prev.map((c) => {
      if (c.id !== id) return c
      if (refreshedAnchor !== undefined && c.target.kind === 'section') {
        return { ...c, resolved, target: { ...c.target, anchor: refreshedAnchor } }
      }
      return { ...c, resolved }
    })
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
    if (rootDir === null) return false
    const prev = get().comments
    const next = prev.filter((c) => c.id !== id)
    set({ comments: next, activeId: get().activeId === id ? null : get().activeId })
    try {
      await persist(rootDir, next, [id])
      return true
    } catch (error) {
      set({ comments: prev })
      useUiStore.getState().setStatusNote(`Could not delete comment: ${errorMessage(error)}`)
      return false
    }
  },

  removeWithUndo: async (id) => {
    // capture the project at DELETE time: an Undo clicked after a project
    // switch must never insert the comment into the new project's sidecar
    const rootDirAtDelete = get().rootDir
    const index = get().comments.findIndex((c) => c.id === id)
    const comment = get().comments[index]
    if (comment === undefined) return
    const removed = await get().remove(id)
    if (!removed) return
    useUiStore.getState().pushToast('Comment deleted', {
      action: {
        label: 'Undo',
        run: () => {
          if (get().rootDir !== rootDirAtDelete) return
          void get().restore(comment, index)
        }
      }
    })
  },

  restore: async (comment, index) => {
    const rootDir = get().rootDir
    if (rootDir === null) return
    const prev = get().comments
    if (prev.some((c) => c.id === comment.id)) return // already back (double Undo)
    const next = [...prev]
    next.splice(Math.min(Math.max(index, 0), next.length), 0, comment)
    set({ comments: next })
    try {
      await persist(rootDir, next)
    } catch (error) {
      set({ comments: prev })
      useUiStore.getState().setStatusNote(`Could not restore comment: ${errorMessage(error)}`)
    }
  }
}))

/* ---- module-scope wiring --------------------------------------------------- */

if (typeof window !== 'undefined' && typeof window.suna?.onProjectTreeChanged === 'function') {
  // Deferred a microtask, same as state/docSessions: this module is part of
  // the project → comments → docSessions import cycle, and module-evaluation
  // side effects that touch cyclic bindings TDZ-crash the renderer.
  queueMicrotask(() => {
  // External writers (an agent's add_comment/resolve_comment over MCP, git)
  // refresh the store in place — but NEVER while the human is composing a
  // draft or reply, so in-progress work cannot be clobbered (the flux guard,
  // extended to replies). The same-content reload settles via lastPersisted.
  window.suna.onProjectTreeChanged(({ dir }) => {
    const s = useCommentsStore.getState()
    if (s.rootDir !== dir || !s.loaded || s.loading) return
    if (s.draft !== null || s.composing) {
      // never clobber in-progress composing — but don't DROP the event
      // either: reload once the composer closes
      reloadPending = true
      return
    }
    void s.load(dir)
  })

  // Save-time anchor maintenance: after the shared doc session writes a
  // prose file, re-locate every comment against the SAVED text — flip
  // `detached` to the truth and re-tighten drifted quote/prefix/suffix from
  // the located range, so the sidecar never holds a stale anchor. Persisted
  // only when something actually changed.
  onDocSaved((savedPath, text) => {
    const s = useCommentsStore.getState()
    const rootDir = s.rootDir
    if (rootDir === null || !s.loaded) return
    // Prefer the editor's LIVE mapped ranges: a quote the user edited still
    // has a correct mark tracking it, while locate() against the saved text
    // would wrongly flip the comment to detached. locate() is the fallback
    // for paths with no attached view.
    const liveByPath = new Map<string, Map<string, { from: number; to: number }>>()
    const liveFor = (path: string): Map<string, { from: number; to: number }> => {
      let map = liveByPath.get(path)
      if (map === undefined) {
        map = new Map()
        for (const anchor of liveAnchorsForPath(path) ?? []) {
          map.set(anchor.id, { from: anchor.from, to: anchor.to })
        }
        liveByPath.set(path, map)
      }
      return map
    }
    let changed = false
    const next = s.comments.map((comment): Comment => {
      if (comment.target.kind !== 'section') return comment
      if (`${rootDir}/manuscript/${comment.target.path}` !== savedPath) return comment
      const live = liveFor(comment.target.path).get(comment.id)
      const range =
        live !== undefined && live.from >= 0 && live.to <= text.length && live.from < live.to
          ? live
          : locate(text, comment.target.anchor)
      if (range === null) {
        if (comment.detached) return comment
        changed = true
        return { ...comment, detached: true }
      }
      const fresh = makeAnchor(text, range.from, range.to)
      const anchor = comment.target.anchor
      const drifted =
        fresh.quote !== anchor.quote ||
        fresh.prefix !== anchor.prefix ||
        fresh.suffix !== anchor.suffix
      if (!drifted && !comment.detached) return comment
      changed = true
      return { ...comment, detached: false, target: { ...comment.target, anchor: fresh } }
    })
    if (!changed) return
    useCommentsStore.setState({ comments: next })
    void persist(rootDir, next).catch(() => undefined)
  })
  })
}
