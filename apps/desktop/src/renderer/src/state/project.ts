import { create } from 'zustand'
import type { FsNode, SunaProjectManifest } from '@suna/core'
import { useUiStore } from './ui'
import { openFileTab } from './dock'

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

async function openStarterSection(rootDir: string): Promise<void> {
  openFileTab(`${rootDir}/manuscript/sections/01-introduction.md`)
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
      set({ rootDir: path, manifest })
      useUiStore.getState().setStatusNote(`Created project “${manifest.name}”`)
      await get().refreshTree()
      await openStarterSection(path)
    } catch (error) {
      reportError('Could not create project', error)
    }
  },

  openExampleProject: async () => {
    try {
      const { dir, manifest } = await window.suna.invoke('project:open-example', {})
      set({ rootDir: dir, manifest })
      useUiStore.getState().setStatusNote(`Opened example project “${manifest.name}”`)
      await get().refreshTree()
      await openStarterSection(dir)
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
      const { manifest } = await window.suna.invoke('project:open', { dir: path })
      set({ rootDir: path, manifest })
      useUiStore.getState().setStatusNote(`Opened project “${manifest.name}”`)
      await get().refreshTree()
      await openStarterSection(path)
    } catch (error) {
      reportError('Could not open project', error)
    }
  }
}))
