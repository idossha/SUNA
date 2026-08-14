import { create } from 'zustand'
import type { FsNode } from '@suna/core'
import { useProjectStore } from './project'
import { useUiStore } from './ui'
import { openFileTab } from './dock'

export type ExplorerEditing =
  | { kind: 'rename'; path: string; name: string; isDir: boolean }
  | { kind: 'create-file' | 'create-dir'; parentPath: string }

export interface ExplorerMenu {
  x: number
  y: number
  node: FsNode
  confirmingDelete: boolean
}

interface ExplorerState {
  menu: ExplorerMenu | null
  editing: ExplorerEditing | null
  openMenu: (node: FsNode, x: number, y: number) => void
  closeMenu: () => void
  armDelete: () => void
  confirmDelete: () => Promise<void>
  startCreate: (parentPath: string, kind: 'create-file' | 'create-dir') => void
  startRename: (node: FsNode) => void
  cancelEdit: () => void
  commitEdit: (name: string) => Promise<void>
}

function reportError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  useUiStore.getState().setStatusNote(`${prefix}: ${message}`)
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  menu: null,
  editing: null,

  openMenu: (node, x, y) => set({ menu: { node, x, y, confirmingDelete: false } }),

  closeMenu: () => set({ menu: null }),

  armDelete: () =>
    set((s) => (s.menu ? { menu: { ...s.menu, confirmingDelete: true } } : {})),

  confirmDelete: async () => {
    const { menu } = get()
    if (!menu) return
    set({ menu: null })
    try {
      await window.suna.invoke('fs:delete', { path: menu.node.path })
      await useProjectStore.getState().refreshTree()
      useUiStore.getState().setStatusNote(`Moved ${menu.node.name} to the trash`)
    } catch (error) {
      reportError(`Could not delete ${menu.node.name}`, error)
    }
  },

  startCreate: (parentPath, kind) => set({ editing: { kind, parentPath }, menu: null }),

  startRename: (node) =>
    set({
      editing: { kind: 'rename', path: node.path, name: node.name, isDir: node.kind === 'dir' },
      menu: null
    }),

  cancelEdit: () => set({ editing: null }),

  commitEdit: async (name) => {
    const { editing } = get()
    if (!editing) return
    const trimmed = name.trim()
    if (trimmed === '' || (editing.kind === 'rename' && trimmed === editing.name)) {
      set({ editing: null })
      return
    }
    if (trimmed.includes('/')) {
      useUiStore.getState().setStatusNote('Names cannot contain "/"')
      return
    }
    set({ editing: null })
    try {
      if (editing.kind === 'rename') {
        const { path } = await window.suna.invoke('fs:rename', {
          path: editing.path,
          newName: trimmed
        })
        await useProjectStore.getState().refreshTree()
        if (!editing.isDir) openFileTab(path)
      } else if (editing.kind === 'create-file') {
        const path = `${editing.parentPath}/${trimmed}`
        await window.suna.invoke('fs:create-file', { path, content: '' })
        await useProjectStore.getState().refreshTree()
        openFileTab(path)
      } else {
        await window.suna.invoke('fs:mkdir', { path: `${editing.parentPath}/${trimmed}` })
        await useProjectStore.getState().refreshTree()
      }
    } catch (error) {
      reportError(`Could not ${editing.kind === 'rename' ? 'rename' : 'create'} ${trimmed}`, error)
    }
  }
}))
