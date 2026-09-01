import { create } from 'zustand'
import {
  emptyRevisionsFile,
  revisionFor,
  RevisionsFileSchema,
  type Revision,
  type RevisionsFile
} from '@suna/core'
import { useProjectStore } from './project'
import { useManuscriptStore } from './manuscript'
import { useUiStore } from './ui'

/**
 * The AI-diff baseline (ARCHITECTURE §5.6), backed by
 * manuscript/revisions.json.
 *
 * A revision is opened when an AI run starts, holding the manuscript's text
 * from just before it. The review view derives its red/green hunks by diffing
 * that text against the live buffer — nothing about the hunks is stored, so
 * they stay correct however much the author edits around them.
 *
 * Closing a revision is what "I have reviewed this" means. Accepting all
 * drops it (the new text simply IS the manuscript now); rejecting all restores
 * the base into the buffer; accepting one hunk advances the base past that
 * hunk; rejecting one hunk edits the buffer back, after which the hunk stops
 * existing because base and buffer agree there.
 */

function makeId(): string {
  const date = new Date().toISOString().slice(0, 10)
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(16).slice(2, 10)
  return `rev-${date}-${random}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface RevisionsState {
  rootDir: string | null
  file: RevisionsFile
  loaded: boolean
  load: (dir: string) => Promise<void>
  /** Open (or extend) the baseline for `path`; no-op without a project. */
  open: (path: string, label: string, base: string) => Promise<void>
  /** Drop the baseline for `path` — "reviewed". */
  close: (path: string) => Promise<void>
  /** Replace the baseline for `path` (accepting a single hunk advances it). */
  setBase: (path: string, base: string) => Promise<void>
}

export const useRevisionsStore = create<RevisionsState>((set, get) => ({
  rootDir: null,
  file: emptyRevisionsFile(),
  loaded: false,

  load: async (dir) => {
    try {
      const { file } = await window.suna.invoke('revisions:read', { dir })
      if (useProjectStore.getState().rootDir !== dir) return
      set({ rootDir: dir, file: RevisionsFileSchema.parse(file), loaded: true })
    } catch (error) {
      // A corrupt or unreadable baseline must not take the editor down; it
      // means "no diff to show", and the note says why.
      set({ rootDir: dir, file: emptyRevisionsFile(), loaded: true })
      useUiStore.getState().setStatusNote(`Could not read revisions.json: ${errorMessage(error)}`)
    }
  },

  open: async (path, label, base) => {
    const dir = useProjectStore.getState().rootDir
    if (dir === null) return
    const current = get().file
    const existing = revisionFor(current, path)
    // A second run before the author reviewed the first keeps the OLDER base:
    // "everything the AI changed since I last looked" is the useful baseline,
    // and overwriting it here would silently hide the first run's changes.
    const next: RevisionsFile = existing
      ? {
          ...current,
          revisions: current.revisions.map((r) =>
            r.path === path ? { ...r, at: new Date().toISOString(), author: { kind: 'ai', label } } : r
          )
        }
      : {
          ...current,
          revisions: [
            ...current.revisions,
            { id: makeId(), path, author: { kind: 'ai', label }, at: new Date().toISOString(), base }
          ]
        }
    await persist(dir, next, set)
  },

  close: async (path) => {
    const dir = useProjectStore.getState().rootDir
    if (dir === null) return
    const current = get().file
    if (revisionFor(current, path) === null) return
    await persist(dir, { ...current, revisions: current.revisions.filter((r) => r.path !== path) }, set)
  },

  setBase: async (path, base) => {
    const dir = useProjectStore.getState().rootDir
    if (dir === null) return
    const current = get().file
    if (revisionFor(current, path) === null) return
    await persist(
      dir,
      { ...current, revisions: current.revisions.map((r) => (r.path === path ? { ...r, base } : r)) },
      set
    )
  }
}))

async function persist(
  dir: string,
  next: RevisionsFile,
  set: (partial: Partial<RevisionsState>) => void
): Promise<void> {
  // Optimistic: the review view is redrawn from this immediately, and a failed
  // write is reported rather than silently leaving the UI ahead of the file.
  set({ file: next })
  try {
    await window.suna.invoke('revisions:write', { dir, file: next })
  } catch (error) {
    useUiStore.getState().setStatusNote(`Could not save revisions.json: ${errorMessage(error)}`)
  }
}

/** The open baseline for a manuscript-relative path, or null. */
export function useRevision(path: string | null): Revision | null {
  return useRevisionsStore((s) => (path === null ? null : revisionFor(s.file, path)))
}

/** Non-reactive read, for the editor extension's initial state. */
export function peekRevision(path: string): Revision | null {
  return revisionFor(useRevisionsStore.getState().file, path)
}

/**
 * Snapshot the manuscript before an AI run so its edits become reviewable.
 *
 * Called from the single ai:ask choke point, AFTER dirty buffers are flushed,
 * so the baseline is what the author could actually see. Best-effort by
 * design: a project that cannot be read still runs the agent, it just has no
 * diff to show afterwards — never the other way round.
 */
export async function captureAiBaseline(label: string): Promise<void> {
  const rootDir = useProjectStore.getState().rootDir
  if (rootDir === null) return
  const manuscript = useManuscriptStore.getState().manuscript
  const file = manuscript?.manuscriptFile
  if (file === undefined || file === '') return
  try {
    const { content } = await window.suna.invoke('fs:read-text', {
      path: `${rootDir}/manuscript/${file}`
    })
    await useRevisionsStore.getState().open(file, label, content)
  } catch {
    // no manuscript to baseline (a figure-only project, a fresh scaffold)
  }
}

/* ---- module-scope wiring --------------------------------------------------- */

if (typeof window !== 'undefined' && typeof window.suna?.onProjectTreeChanged === 'function') {
  // Deferred a microtask for the same reason state/comments does it: this
  // module sits in the project import cycle.
  queueMicrotask(() => {
    useProjectStore.subscribe((s, prev) => {
      if (s.rootDir === prev.rootDir) return
      if (s.rootDir === null) {
        useRevisionsStore.setState({ rootDir: null, file: emptyRevisionsFile(), loaded: false })
        return
      }
      void useRevisionsStore.getState().load(s.rootDir)
    })
  })
}
