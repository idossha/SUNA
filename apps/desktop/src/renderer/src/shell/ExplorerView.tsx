import { useEffect, useRef, useState, type JSX } from 'react'
import type { FsNode } from '@suna/core'
import { useProjectStore } from '../state/project'
import { useExplorerStore, type ExplorerEditing } from '../state/explorer'
import { openFileTab, openInSplit } from '../state/dock'
import './explorer.css'

function parentDirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : path
}

/** A pending create targets this directory (or something inside it). */
function forcesOpen(editing: ExplorerEditing | null, dirPath: string): boolean {
  if (editing === null || editing.kind === 'rename') return false
  return editing.parentPath === dirPath || editing.parentPath.startsWith(`${dirPath}/`)
}

function EditRow({ depth, initial }: { depth: number; initial: string }): JSX.Element {
  const commitEdit = useExplorerStore((s) => s.commitEdit)
  const cancelEdit = useExplorerStore((s) => s.cancelEdit)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.focus()
      // pre-select the basename so typing replaces it, keeping the extension reachable
      const dot = initial.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : initial.length)
    }
  }, [initial])

  return (
    <div className="tree__row tree__row--edit" style={{ paddingLeft: `${8 + depth * 14}px` }}>
      <input
        ref={inputRef}
        className="tree__edit-input"
        defaultValue={initial}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commitEdit(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelEdit()
          }
        }}
        onBlur={cancelEdit}
      />
    </div>
  )
}

interface TreeEntryProps {
  node: FsNode
  depth: number
  editing: ExplorerEditing | null
}

function TreeEntry({ node, depth, editing }: TreeEntryProps): JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const openMenu = useExplorerStore((s) => s.openMenu)
  const indent = { paddingLeft: `${8 + depth * 14}px` }

  const renaming = editing !== null && editing.kind === 'rename' && editing.path === node.path

  if (node.kind === 'file') {
    if (renaming) return <EditRow depth={depth} initial={node.name} />
    return (
      <button
        className="tree__row"
        style={indent}
        // ⌘↵ (or ⌘-click) opens to the side, reusing the split group (feature-plan-4 §1/§5)
        onClick={(e) => (e.metaKey || e.ctrlKey ? openInSplit(node.path, 'right') : openFileTab(node.path))}
        onContextMenu={(e) => {
          e.preventDefault()
          openMenu(node, e.clientX, e.clientY)
        }}
      >
        <span className="tree__name">{node.name}</span>
      </button>
    )
  }

  const effectiveOpen = open || forcesOpen(editing, node.path)
  const creatingHere =
    editing !== null && editing.kind !== 'rename' && editing.parentPath === node.path

  return (
    <div>
      {renaming ? (
        <EditRow depth={depth} initial={node.name} />
      ) : (
        <button
          className="tree__row tree__row--dir"
          style={indent}
          onClick={() => setOpen(!effectiveOpen)}
          onContextMenu={(e) => {
            e.preventDefault()
            openMenu(node, e.clientX, e.clientY)
          }}
        >
          <span className="tree__chevron">{effectiveOpen ? '▾' : '▸'}</span>
          <span className="tree__name">{node.name}</span>
        </button>
      )}
      {effectiveOpen && creatingHere && <EditRow depth={depth + 1} initial="" />}
      {effectiveOpen &&
        node.children.map((child) => (
          <TreeEntry key={child.path} node={child} depth={depth + 1} editing={editing} />
        ))}
    </div>
  )
}

function ExplorerMenu(): JSX.Element | null {
  const menu = useExplorerStore((s) => s.menu)
  const closeMenu = useExplorerStore((s) => s.closeMenu)
  const armDelete = useExplorerStore((s) => s.armDelete)
  const confirmDelete = useExplorerStore((s) => s.confirmDelete)
  const startCreate = useExplorerStore((s) => s.startCreate)
  const startRename = useExplorerStore((s) => s.startRename)

  useEffect(() => {
    if (menu === null) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, closeMenu])

  if (menu === null) return null

  const targetDir = menu.node.kind === 'dir' ? menu.node.path : parentDirOf(menu.node.path)
  const left = Math.min(menu.x, window.innerWidth - 190)
  const top = Math.min(menu.y, window.innerHeight - 150)

  return (
    <>
      <div
        className="ctxmenu-scrim"
        onMouseDown={closeMenu}
        onContextMenu={(e) => {
          e.preventDefault()
          closeMenu()
        }}
      />
      <div className="ctxmenu" style={{ left, top }} role="menu" aria-label={menu.node.name}>
        <button className="ctxmenu__item" onClick={() => startCreate(targetDir, 'create-file')}>
          New File…
        </button>
        <button className="ctxmenu__item" onClick={() => startCreate(targetDir, 'create-dir')}>
          New Folder…
        </button>
        <div className="ctxmenu__sep" />
        <button className="ctxmenu__item" onClick={() => startRename(menu.node)}>
          Rename…
        </button>
        <button
          className={
            menu.confirmingDelete
              ? 'ctxmenu__item ctxmenu__item--danger ctxmenu__item--armed'
              : 'ctxmenu__item ctxmenu__item--danger'
          }
          onClick={() => {
            if (menu.confirmingDelete) void confirmDelete()
            else armDelete()
          }}
        >
          {menu.confirmingDelete ? 'Confirm delete?' : 'Delete'}
        </button>
      </div>
    </>
  )
}

export function ExplorerView(): JSX.Element {
  const tree = useProjectStore((s) => s.tree)
  const rootDir = useProjectStore((s) => s.rootDir)
  const editing = useExplorerStore((s) => s.editing)

  if (!tree || tree.kind !== 'dir') {
    return <p className="sidebar__empty">Open a project to browse its files.</p>
  }

  const creatingAtRoot =
    editing !== null && editing.kind !== 'rename' && editing.parentPath === rootDir

  return (
    <div className="tree">
      {creatingAtRoot && <EditRow depth={0} initial="" />}
      {tree.children.map((child) => (
        <TreeEntry key={child.path} node={child} depth={0} editing={editing} />
      ))}
      <ExplorerMenu />
    </div>
  )
}
