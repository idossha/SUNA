import { create } from 'zustand'
import type { FsNode, ResponseOf } from '@suna/core'
import { useProjectStore } from './project'
import { useUiStore } from './ui'
import { openFileTab, retargetPanels } from './dock'
import { moveNote } from '../shell/explorer-dnd'

export type ExplorerEditing =
  | { kind: 'rename'; path: string; name: string; isDir: boolean }
  | { kind: 'create-file' | 'create-dir'; parentPath: string }

export interface ExplorerMenu {
  x: number
  y: number
  node: FsNode
  confirmingDelete: boolean
  /**
   * Paths the menu's actions apply to. Right-clicking INSIDE the selection
   * acts on the whole selection; right-clicking outside it acts on the one
   * row (and selects it), which is what every file manager does.
   */
  targets: string[]
}

/** One visible row of the flattened tree — what arrow keys step through. */
export interface ExplorerRow {
  node: FsNode
  depth: number
}

interface ExplorerState {
  menu: ExplorerMenu | null
  editing: ExplorerEditing | null
  /** Expanded directory paths. Explicit rather than per-row component state so
   *  the keyboard can drive it and it survives a tree refresh. */
  expanded: ReadonlySet<string>
  /** The project whose default expansion has been seeded, so a switch re-seeds. */
  seededFor: string | null
  /** Selected paths, in click order. */
  selection: readonly string[]
  /** Range-select origin: shift-click/shift-arrow extends from here. */
  anchor: string | null
  /** The row the keyboard is on. Usually the last-clicked row. */
  focusPath: string | null

  openMenu: (node: FsNode, x: number, y: number) => void
  closeMenu: () => void
  armDelete: () => void
  confirmDelete: () => Promise<void>
  startCreate: (parentPath: string, kind: 'create-file' | 'create-dir') => void
  startRename: (node: FsNode) => void
  cancelEdit: () => void
  commitEdit: (name: string) => Promise<void>
  /** Drop handler's other half: batch-move `paths` into `targetDir`. */
  moveInto: (paths: readonly string[], targetDir: string) => Promise<void>

  seedExpansion: (rootDir: string, paths: string[]) => void
  toggleExpanded: (path: string, open?: boolean) => void
  /** Click on a row. `additive` = ⌘/Ctrl (toggle), `range` = shift (extend). */
  selectRow: (path: string, rows: readonly ExplorerRow[], modifiers: { additive?: boolean; range?: boolean }) => void
  setFocus: (path: string | null) => void
  clearSelection: () => void
  selectAll: (rows: readonly ExplorerRow[]) => void
  openSelection: (rows: readonly ExplorerRow[]) => void
}

function reportError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  useUiStore.getState().setStatusNote(`${prefix}: ${message}`)
}

/** Paths between two rows inclusive, in visible order. */
function rangeBetween(rows: readonly ExplorerRow[], from: string, to: string): string[] {
  const a = rows.findIndex((r) => r.node.path === from)
  const b = rows.findIndex((r) => r.node.path === to)
  if (a === -1 || b === -1) return [to]
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return rows.slice(lo, hi + 1).map((r) => r.node.path)
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  menu: null,
  editing: null,
  expanded: new Set<string>(),
  seededFor: null,
  selection: [],
  anchor: null,
  focusPath: null,

  openMenu: (node, x, y) => {
    const { selection } = get()
    // right-click inside the selection keeps it; outside it, the row becomes
    // the selection so the menu can never act on rows the user cannot see.
    const inSelection = selection.includes(node.path)
    const targets = inSelection ? [...selection] : [node.path]
    set({
      menu: { node, x, y, confirmingDelete: false, targets },
      selection: targets,
      anchor: inSelection ? get().anchor : node.path,
      focusPath: node.path
    })
  },

  closeMenu: () => set({ menu: null }),

  armDelete: () => set((s) => (s.menu ? { menu: { ...s.menu, confirmingDelete: true } } : {})),

  confirmDelete: async () => {
    const { menu } = get()
    if (!menu) return
    set({ menu: null })
    const targets = menu.targets
    const failures: string[] = []
    for (const path of targets) {
      try {
        await window.suna.invoke('fs:delete', { path })
      } catch (error) {
        failures.push(`${path.split('/').pop() ?? path} (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    set({ selection: [], anchor: null })
    await useProjectStore.getState().refreshTree()
    const moved = targets.length - failures.length
    if (failures.length > 0) {
      useUiStore
        .getState()
        .setStatusNote(`Moved ${moved} to the trash; could not delete ${failures.join(', ')}`)
    } else {
      useUiStore
        .getState()
        .setStatusNote(
          moved === 1
            ? `Moved ${targets[0]?.split('/').pop() ?? ''} to the trash`
            : `Moved ${moved} items to the trash`
        )
    }
  },

  startCreate: (parentPath, kind) => {
    // a create inside a collapsed folder must reveal it, or the input row
    // renders into a subtree nobody can see
    set((s) => ({ editing: { kind, parentPath }, menu: null, expanded: new Set(s.expanded).add(parentPath) }))
  },

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
        // Before this, a rename orphaned its open tab: the panel kept the old
        // path and quietly stopped matching anything on disk
        // (feature-plan-9 measurement 5). Retarget FIRST, so the openFileTab
        // below focuses the tab that already holds the file instead of
        // opening a second one beside the dead one.
        retargetPanels(editing.path, path)
        await useProjectStore.getState().refreshTree()
        set({ selection: [path], anchor: path, focusPath: path })
        if (!editing.isDir) openFileTab(path)
      } else if (editing.kind === 'create-file') {
        const path = `${editing.parentPath}/${trimmed}`
        await window.suna.invoke('fs:create-file', { path, content: '' })
        await useProjectStore.getState().refreshTree()
        set({ selection: [path], anchor: path, focusPath: path })
        openFileTab(path)
      } else {
        const path = `${editing.parentPath}/${trimmed}`
        await window.suna.invoke('fs:mkdir', { path })
        await useProjectStore.getState().refreshTree()
        set({ selection: [path], anchor: path, focusPath: path })
      }
    } catch (error) {
      reportError(`Could not ${editing.kind === 'rename' ? 'rename' : 'create'} ${trimmed}`, error)
    }
  },

  /**
   * One drop is one `fs:move` call and one status note (feature-plan-9 §2).
   * The tree is NOT re-listed here: main watches the project directory and
   * pushes a refresh, which is the same route an agent's or the terminal's
   * writes take. What this does own is everything the watcher cannot know —
   * the open tabs that must follow the files, and the selection, which lands
   * on the moved rows at their NEW paths so the drop's result stays in hand.
   *
   * The missing refreshTree() is deliberate, not an oversight: confirmDelete
   * and commitEdit in this store still call it by hand, while a drop waits for
   * the tree watch (projectTreeWatch.ts, TREE_DEBOUNCE_MS = 150) to push the
   * re-list — a route verified working, and an explicit re-list here would only
   * race that push.
   */
  moveInto: async (paths, targetDir) => {
    if (paths.length === 0) return
    let result: ResponseOf<'fs:move'>
    try {
      result = await window.suna.invoke('fs:move', { paths: [...paths], targetDir })
    } catch (error) {
      reportError(`Could not move into ${targetDir.split('/').pop() ?? targetDir}`, error)
      return
    }
    for (const entry of result.moved) retargetPanels(entry.from, entry.to)
    if (result.moved.length > 0) {
      const landed = result.moved.map((entry) => entry.to)
      // Reveal the target for the same reason startCreate does: rows selected
      // inside a collapsed folder are rows nobody can see.
      set((s) => ({
        expanded: new Set(s.expanded).add(targetDir),
        selection: landed,
        anchor: landed[0] ?? null,
        focusPath: landed[landed.length - 1] ?? null
      }))
    }
    const note = moveNote(result.moved, result.failed, targetDir)
    if (note !== null) useUiStore.getState().setStatusNote(note)
  },

  seedExpansion: (rootDir, paths) => set({ expanded: new Set(paths), seededFor: rootDir }),

  toggleExpanded: (path, open) =>
    set((s) => {
      const next = new Set(s.expanded)
      const shouldOpen = open ?? !next.has(path)
      if (shouldOpen) next.add(path)
      else next.delete(path)
      return { expanded: next }
    }),

  selectRow: (path, rows, modifiers) => {
    const { selection, anchor } = get()
    if (modifiers.range && anchor !== null) {
      set({ selection: rangeBetween(rows, anchor, path), focusPath: path })
      return
    }
    if (modifiers.additive) {
      const next = selection.includes(path)
        ? selection.filter((p) => p !== path)
        : [...selection, path]
      set({ selection: next, anchor: path, focusPath: path })
      return
    }
    set({ selection: [path], anchor: path, focusPath: path })
  },

  setFocus: (path) => set({ focusPath: path }),

  clearSelection: () => set({ selection: [], anchor: null }),

  selectAll: (rows) => {
    const paths = rows.map((r) => r.node.path)
    set({ selection: paths, anchor: paths[0] ?? null, focusPath: paths[paths.length - 1] ?? null })
  },

  /** Open every selected FILE, in visible order; directories are skipped. */
  openSelection: (rows) => {
    const selected = new Set(get().selection)
    for (const row of rows) {
      if (row.node.kind === 'file' && selected.has(row.node.path)) openFileTab(row.node.path)
    }
  }
}))
