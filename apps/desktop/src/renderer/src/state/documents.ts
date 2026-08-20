import { create } from 'zustand'
import type { DocumentEntry, Round } from '@suna/core'
import { useProjectStore } from './project'

/**
 * The project's document registry and round ledger, as the renderer sees them
 * (feature-plan-12 §1, §3; document-kinds-ux.md §A.1, §D.1).
 *
 * Read-through-refresh rather than a live subscription: both files change only
 * when the user or an agent does something deliberate, and the project tree
 * watcher already tells us when that happened.
 */

interface DocumentsState {
  documents: DocumentEntry[]
  rounds: Round[]
  loading: boolean
  error: string | null
  refresh: (rootDir: string | null) => Promise<void>
  reset: () => void
}

export const useDocumentsStore = create<DocumentsState>((set) => ({
  documents: [],
  rounds: [],
  loading: false,
  error: null,

  refresh: async (rootDir) => {
    if (rootDir === null) {
      set({ documents: [], rounds: [], loading: false, error: null })
      return
    }
    set({ loading: true, error: null })
    try {
      const [{ documents }, { rounds }] = await Promise.all([
        window.suna.invoke('documents:list', { dir: rootDir }),
        window.suna.invoke('round:list', { dir: rootDir })
      ])
      set({ documents, rounds, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },

  reset: () => set({ documents: [], rounds: [], loading: false, error: null })
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
