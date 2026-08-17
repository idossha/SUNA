import { create } from 'zustand'

/**
 * Which files are currently open in the dock, and which one is frontmost.
 *
 * The explorer needs this reactively to mark rows as open (nav-bar item 3),
 * but dockview's api is a plain module-level object in state/dock.ts, not a
 * store — so dock.ts feeds this store from dockview's own panel events and
 * everything else just subscribes.
 *
 * Keyed by PATH: openFileTab uses the file path as the panel id, so a panel id
 * that looks like an absolute path is a file tab. Panels with synthetic ids
 * (`manuscript:…`, `settings`, `onboarding:create`) are not files and are
 * deliberately absent — the explorer has no row to mark for them.
 */
interface OpenTabsState {
  /** Paths of every open file tab. */
  paths: ReadonlySet<string>
  /** Path of the frontmost file tab, or null when a non-file tab is active. */
  activePath: string | null
  /**
   * rootDirs with an open combined Manuscript tab (`manuscript:<rootDir>`).
   * The Explorer ORs these into the manuscript.md row's open/active marker —
   * that tab IS a window onto the same file (shared doc session), and
   * without this the row gave no hint a second surface already holds it.
   */
  manuscriptRoots: ReadonlySet<string>
  /** rootDir of the frontmost Manuscript tab, or null. */
  activeManuscriptRoot: string | null
  setOpenTabs: (
    paths: ReadonlySet<string>,
    activePath: string | null,
    manuscriptRoots: ReadonlySet<string>,
    activeManuscriptRoot: string | null
  ) => void
}

export const useOpenTabsStore = create<OpenTabsState>((set) => ({
  paths: new Set<string>(),
  activePath: null,
  manuscriptRoots: new Set<string>(),
  activeManuscriptRoot: null,
  setOpenTabs: (paths, activePath, manuscriptRoots, activeManuscriptRoot) =>
    set({ paths, activePath, manuscriptRoots, activeManuscriptRoot })
}))

/** A panel id is a file tab when it is an absolute path (see the note above). */
export function isFilePanelId(id: string): boolean {
  return id.startsWith('/')
}
