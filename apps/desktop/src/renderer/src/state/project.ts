import { create } from 'zustand'
import type { FsNode, MigrationOutcome, SunaProjectManifest } from '@suna/core'
import { useUiStore } from './ui'
import { closeProjectTabs, openManuscriptTab } from './dock'
import { useCommentsStore } from './comments'

interface ProjectState {
  rootDir: string | null
  manifest: SunaProjectManifest | null
  tree: FsNode | null
  /** Incremented after any successful file save; sidebar views re-read on it. */
  saveBump: number
  createProject: () => Promise<void>
  openProject: () => Promise<void>
  openExampleProject: () => Promise<void>
  refreshTree: () => Promise<void>
  noteFileSaved: (path: string) => void
}

function reportError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  useUiStore.getState().setStatusNote(`${prefix}: ${message}`)
}

function migrationStatusNote(name: string, migration: MigrationOutcome): string {
  if (migration.error !== null) {
    return `Opened project "${name}" — could not migrate to the flat manuscript layout, project left untouched: ${migration.error}`
  }
  if (migration.migrated) {
    return `Opened project "${name}" (migrated to the flat manuscript layout)`
  }
  return `Opened project "${name}"`
}

/**
 * Re-point every project-scoped piece of state at (`dir`, `manifest`),
 * shared by every switch path below (feature-plan-7 §3): the create/open/
 * open-example store actions and the exported `openProjectAt`.
 *
 * - project store: rootDir + manifest swap first, so everything below (and
 *   every subscriber outside this module) sees the new project.
 * - open tabs: closeProjectTabs(previousRoot) closes editors/canvas/
 *   dataview/pdf/image tabs and the manuscript tab pointing at the project
 *   that is no longer open, so no stale editor survives the switch.
 * - file tree: refreshTree() re-lists the new root.
 * - comments: useCommentsStore.load(dir) re-reads manuscript/comments.json
 *   for the new root (its own store keys everything off `rootDir`, so a
 *   stale load for the old project would otherwise linger until some other
 *   view happened to call load() again).
 *
 * Reference-PDF resolution (state/referencePdfs.ts) and settings resolution
 * (state/settings.ts) are NOT called here — both already subscribe to this
 * store's `rootDir`/`manifest` and re-run themselves the instant `set` below
 * fires, which is why they need no explicit call from any switch path.
 */
async function adoptProject(dir: string, manifest: SunaProjectManifest): Promise<void> {
  const previousRoot = useProjectStore.getState().rootDir
  useProjectStore.setState({ rootDir: dir, manifest })
  if (previousRoot !== null && previousRoot !== dir) closeProjectTabs(previousRoot)
  await useProjectStore.getState().refreshTree()
  void useCommentsStore.getState().load(dir)
}

/**
 * THE project-switching entry point (feature-plan-7 §3). Every surface that
 * opens an EXISTING project by path — the title-bar Project menu's Recent
 * projects list, the welcome screen's recent-projects list, "Open project…"
 * — should call this rather than hand-rolling `project:open` + `setState`,
 * so switching always fully re-points the app (see adoptProject above)
 * instead of leaving some other zone's state pointed at the old directory.
 *
 * Throws on failure, same as `window.suna.invoke` — callers decide how to
 * surface it (a status note, an inline row error, …). On success it always
 * leaves a status note itself, since a background migration just ran and a
 * silent success would hide that from the user.
 *
 * It also opens the manuscript, exactly like create/open-example do: the
 * switch has just closed every tab scoped to the previous project, so landing
 * the user on an empty dock would read as "the switch broke something".
 */
export async function openProjectAt(dir: string): Promise<SunaProjectManifest> {
  const { manifest, migration } = await window.suna.invoke('project:open', { dir })
  await adoptProject(dir, manifest)
  useUiStore.getState().setStatusNote(migrationStatusNote(manifest.name, migration))
  openManuscriptTab(dir)
  return manifest
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  rootDir: null,
  manifest: null,
  tree: null,
  saveBump: 0,

  noteFileSaved: () => {
    set((s) => ({ saveBump: s.saveBump + 1 }))
  },

  refreshTree: async () => {
    const { rootDir } = get()
    if (!rootDir) return
    try {
      const { root } = await window.suna.invoke('fs:list', { dir: rootDir })
      set({ tree: root })
    } catch (error) {
      reportError('Could not list project files', error)
    }
  },

  createProject: async () => {
    try {
      const { path } = await window.suna.invoke('dialog:pick-directory', {
        title: 'Choose an empty folder for the new project',
        allowCreate: true
      })
      if (!path) return
      const name = path.split('/').pop() ?? 'untitled'
      const manifest = await window.suna.invoke('project:create', {
        dir: path,
        name
      })
      await adoptProject(path, manifest)
      useUiStore.getState().setStatusNote(`Created project "${manifest.name}"`)
      openManuscriptTab(path)
    } catch (error) {
      reportError('Could not create project', error)
    }
  },

  openExampleProject: async () => {
    try {
      const { dir, manifest, migration } = await window.suna.invoke('project:open-example', {})
      await adoptProject(dir, manifest)
      useUiStore
        .getState()
        .setStatusNote(`${migrationStatusNote(manifest.name, migration)} (example)`)
      openManuscriptTab(dir)
    } catch (error) {
      reportError('Could not open the example project', error)
    }
  },

  openProject: async () => {
    try {
      const { path } = await window.suna.invoke('dialog:pick-directory', {
        title: 'Open a SUNA project folder',
        allowCreate: false
      })
      if (!path) return
      await openProjectAt(path)
    } catch (error) {
      reportError('Could not open project', error)
    }
  }
}))
