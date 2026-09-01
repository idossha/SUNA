import { create } from 'zustand'
import type { DocumentEntry, LoggedVersion, Round } from '@suna/core'
import { useProjectStore } from './project'

/**
 * The project's document registry and round ledger, as the renderer sees them
 * (ARCHITECTURE §4.2, §3; document-kinds-ux.md §A.1, §D.1).
 *
 * Read-through-refresh rather than a live subscription: both files change only
 * when the user or an agent does something deliberate, and the project tree
 * watcher already tells us when that happened.
 */

interface DocumentsState {
  documents: DocumentEntry[]
  rounds: Round[]
  /** Logged manuscript versions, oldest first, as archive/index.json lists them. */
  versions: LoggedVersion[]
  /** Registry ids whose prose file is no longer on disk. */
  missing: string[]
  loading: boolean
  error: string | null
  refresh: (rootDir: string | null) => Promise<void>
  remove: (rootDir: string, documentId: string) => Promise<void>
  reset: () => void
}

export const useDocumentsStore = create<DocumentsState>((set) => ({
  documents: [],
  rounds: [],
  versions: [],
  missing: [],
  loading: false,
  error: null,

  refresh: async (rootDir) => {
    if (rootDir === null) {
      set({ documents: [], rounds: [], versions: [], missing: [], loading: false, error: null })
      return
    }
    set({ loading: true, error: null })
    try {
      const [{ documents, missing }, { rounds }, { versions }] = await Promise.all([
        window.suna.invoke('documents:list', { dir: rootDir }),
        window.suna.invoke('round:list', { dir: rootDir }),
        window.suna.invoke('version:list', { dir: rootDir })
      ])
      set({ documents, rounds, versions, missing, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },

  remove: async (rootDir, documentId) => {
    const { documents } = await window.suna.invoke('documents:remove', {
      dir: rootDir,
      documentId
    })
    set((s) => ({ documents, missing: s.missing.filter((id) => id !== documentId) }))
  },

  reset: () =>
    set({ documents: [], rounds: [], versions: [], missing: [], loading: false, error: null })
}))

/** Refresh against whatever project is open. */
export function refreshDocuments(): void {
  void useDocumentsStore.getState().refresh(useProjectStore.getState().rootDir)
}

/** The letters in the registry, in registry order. */
export function lettersOf(documents: readonly DocumentEntry[]): DocumentEntry[] {
  return documents.filter((d) => d.kind === 'cover-letter' && !d.archived)
}

/** Everything that is not the primary manuscript, in registry order. */
export function secondaryDocuments(documents: readonly DocumentEntry[]): DocumentEntry[] {
  return documents.filter((d) => d.kind !== 'manuscript' && !d.archived)
}


/**
 * Keep the registry in step with the folder.
 *
 * `suna.json`, `manuscript/letters/` and `rounds/` are plain files that an
 * agent, the terminal, git or Finder can all change while the app is open, so
 * the panel re-reads on the same watcher the file tree already uses rather
 * than trusting its own last write. Coalesced: the watcher fires in bursts
 * (a git checkout touches many paths) and re-reading twice is pointless.
 *
 * Self-starting at module load, guarded because unit tests import this module
 * with no preload bridge — the same shape state/project.ts uses.
 */
let pending: ReturnType<typeof setTimeout> | null = null

function scheduleRefresh(): void {
  if (pending !== null) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    refreshDocuments()
  }, 180)
}

if (typeof window !== 'undefined' && typeof window.suna?.onProjectTreeChanged === 'function') {
  window.suna.onProjectTreeChanged(({ dir }) => {
    if (useProjectStore.getState().rootDir !== dir) return
    scheduleRefresh()
  })
}

if (typeof window !== 'undefined' && typeof window.suna?.onProjectManifestChanged === 'function') {
  // suna.json itself carries the registry, and it is excluded from some tree
  // pushes, so the manifest watch is a second, narrower trigger.
  window.suna.onProjectManifestChanged(({ dir }) => {
    if (useProjectStore.getState().rootDir !== dir) return
    scheduleRefresh()
  })
}
