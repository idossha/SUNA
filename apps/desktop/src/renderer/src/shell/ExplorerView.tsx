import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { ProjectDirKey } from '@suna/core'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { useExplorerStore, type ExplorerEditing, type ExplorerRow } from '../state/explorer'
import { useOpenTabsStore } from '../state/openTabs'
import { openFileTab, openInSplit } from '../state/dock'
import {
  defaultExpanded,
  forcesOpen,
  hasChildren,
  iconKindForFile,
  parentDirOf,
  rowPaddingLeft,
  semanticDirs,
  visibleRows
} from './explorer-rows'
import { FILE_ICONS, FolderIcon, FolderOpenIcon, PROJECT_DIR_ICONS, TreeChevronIcon } from './icons'
import './explorer.css'

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
    <div className="tree__row tree__row--edit" style={{ paddingLeft: `${rowPaddingLeft(depth)}px` }}>
      {/* Empty stand-ins for the chevron and icon columns. rowPaddingLeft
          alone only aligns the row's left EDGE; a TreeRow puts 40px of icon
          columns before .tree__name, so without these the input's text starts
          40px left of every sibling filename and the row visibly jumps on F2.
          The input's own 6px of border+padding is the remaining offset. */}
      <span className="tree__chevron" aria-hidden="true" />
      <span className="tree__icon" aria-hidden="true" />
      <input
        ref={inputRef}
        className="tree__edit-input"
        defaultValue={initial}
        spellCheck={false}
        onKeyDown={(e) => {
          // the tree's own key handling must not see keys meant for this input
          e.stopPropagation()
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

interface TreeRowProps {
  row: ExplorerRow
  rows: readonly ExplorerRow[]
  editing: ExplorerEditing | null
  selected: boolean
  focused: boolean
  isOpen: boolean
  isActive: boolean
  expanded: boolean
  /** Set when this row is one of the directories suna.json declares. */
  semantic: ProjectDirKey | undefined
}

function TreeRow({
  row,
  rows,
  editing,
  selected,
  focused,
  isOpen,
  isActive,
  expanded,
  semantic
}: TreeRowProps): JSX.Element {
  const { node, depth } = row
  const openMenu = useExplorerStore((s) => s.openMenu)
  const selectRow = useExplorerStore((s) => s.selectRow)
  const toggleExpanded = useExplorerStore((s) => s.toggleExpanded)
  const openSelection = useExplorerStore((s) => s.openSelection)

  const renaming = editing !== null && editing.kind === 'rename' && editing.path === node.path
  if (renaming) return <EditRow depth={depth} initial={node.name} />

  const isDir = node.kind === 'dir'
  // An empty directory has nothing to expand: no chevron, no aria-expanded.
  const expandable = isDir && hasChildren(node)
  const RowIcon = isDir
    ? semantic !== undefined
      ? PROJECT_DIR_ICONS[semantic]
      : expandable && expanded
        ? FolderOpenIcon
        : FolderIcon
    : FILE_ICONS[iconKindForFile(node.name)]
  const className = [
    'tree__row',
    isDir ? 'tree__row--dir' : 'tree__row--file',
    semantic !== undefined ? 'tree__row--semantic' : '',
    isDir && !expandable ? 'tree__row--empty' : '',
    selected ? 'tree__row--selected' : '',
    focused ? 'tree__row--focused' : '',
    isOpen ? 'tree__row--open' : '',
    isActive ? 'tree__row--active' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      style={{ paddingLeft: `${rowPaddingLeft(depth)}px` }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={expandable ? expanded : undefined}
      aria-level={depth + 1}
      title={isOpen ? `${node.name} — open${isActive ? ' (active tab)' : ''}` : node.name}
      data-path={node.path}
      data-open={isOpen || undefined}
      data-active={isActive || undefined}
      onMouseDown={(e) => {
        const additive = e.metaKey || e.ctrlKey
        const range = e.shiftKey
        selectRow(node.path, rows, { additive, range })
      }}
      onClick={(e) => {
        // ⌘/ctrl-click is "add to selection" here, so opening to the side moves
        // to ⌥-click; a plain click opens a file or toggles a folder.
        if (e.metaKey || e.ctrlKey || e.shiftKey) return
        if (isDir) toggleExpanded(node.path)
        else if (e.altKey) openInSplit(node.path, 'right')
        else openFileTab(node.path)
      }}
      onDoubleClick={() => {
        if (!isDir) openSelection(rows)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(node, e.clientX, e.clientY)
      }}
    >
      {/* The chevron stays inside the row's single click target: a nested
          button here would put a second tab stop inside every treeitem. */}
      <span
        className={expandable && expanded ? 'tree__chevron tree__chevron--open' : 'tree__chevron'}
        aria-hidden="true"
      >
        {expandable && <TreeChevronIcon />}
      </span>
      <span className="tree__icon" aria-hidden="true">
        <RowIcon />
      </span>
      <span className="tree__name">{node.name}</span>
      {/* Open/active are announced through the row's title, not from inside
          its accessible name. */}
      {isOpen && <span className="tree__open-dot" aria-hidden="true" />}
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
  const count = menu.targets.length
  const multi = count > 1
  const left = Math.min(menu.x, window.innerWidth - 190)
  const top = Math.min(menu.y, window.innerHeight - 170)

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
      <div
        className="ctxmenu"
        style={{ left, top }}
        role="menu"
        aria-label={multi ? `${count} items` : menu.node.name}
      >
        <button className="ctxmenu__item" onClick={() => startCreate(targetDir, 'create-file')}>
          New File…
        </button>
        <button className="ctxmenu__item" onClick={() => startCreate(targetDir, 'create-dir')}>
          New Folder…
        </button>
        <div className="ctxmenu__sep" />
        {/* Rename takes one name and one path: meaningless for a multi-selection. */}
        <button
          className="ctxmenu__item"
          disabled={multi}
          onClick={() => startRename(menu.node)}
        >
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
          {menu.confirmingDelete
            ? multi
              ? `Delete ${count} items?`
              : 'Confirm delete?'
            : multi
              ? `Delete ${count} items`
              : 'Delete'}
        </button>
      </div>
    </>
  )
}

export function ExplorerView(): JSX.Element {
  const tree = useProjectStore((s) => s.tree)
  const rootDir = useProjectStore((s) => s.rootDir)
  const manifest = useProjectStore((s) => s.manifest)
  const editing = useExplorerStore((s) => s.editing)
  const expanded = useExplorerStore((s) => s.expanded)
  const seededFor = useExplorerStore((s) => s.seededFor)
  const selection = useExplorerStore((s) => s.selection)
  const focusPath = useExplorerStore((s) => s.focusPath)
  const seedExpansion = useExplorerStore((s) => s.seedExpansion)
  const openPaths = useOpenTabsStore((s) => s.paths)
  const activePath = useOpenTabsStore((s) => s.activePath)
  const manuscriptRoots = useOpenTabsStore((s) => s.manuscriptRoots)
  const activeManuscriptRoot = useOpenTabsStore((s) => s.activeManuscriptRoot)
  const listRef = useRef<HTMLDivElement>(null)

  // The combined Manuscript tab is a window onto the prose file (shared doc
  // session), so its row shows the open/active marker too — without this,
  // clicking manuscript.md looked like opening a fresh, unrelated buffer.
  const manuscriptFileName = useManuscriptStore(
    (s) => s.manuscript?.manuscriptFile ?? 'manuscript.md'
  )
  const manuscriptProsePath = useMemo(() => {
    if (rootDir === null || !manuscriptRoots.has(rootDir)) return null
    const manuscriptDir = manifest?.directories.manuscript ?? 'manuscript'
    return `${rootDir}/${manuscriptDir}/${manuscriptFileName}`
  }, [rootDir, manuscriptRoots, manifest, manuscriptFileName])

  // Seed the default expansion once per project, so switching projects does
  // not inherit the previous one's collapsed folders.
  useEffect(() => {
    if (tree === null || rootDir === null || seededFor === rootDir) return
    seedExpansion(rootDir, defaultExpanded(tree))
  }, [tree, rootDir, seededFor, seedExpansion])

  const rows = useMemo(
    () => (tree === null ? [] : visibleRows(tree, expanded, editing)),
    [tree, expanded, editing]
  )

  const semantic = useMemo(
    () => semanticDirs(rootDir, manifest?.directories),
    [rootDir, manifest]
  )

  // keep the keyboard-focused row on screen
  useEffect(() => {
    if (focusPath === null) return
    listRef.current
      ?.querySelector(`[data-path="${CSS.escape(focusPath)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusPath])

  const selectionSet = useMemo(() => new Set(selection), [selection])

  if (!tree || tree.kind !== 'dir') {
    return <p className="sidebar__empty">Open a project to browse its files.</p>
  }

  const creatingAtRoot =
    editing !== null && editing.kind !== 'rename' && editing.parentPath === rootDir

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const store = useExplorerStore.getState()
    if (store.editing !== null) return
    const index = rows.findIndex((r) => r.node.path === store.focusPath)
    const current = index === -1 ? null : rows[index]

    const moveTo = (nextIndex: number): void => {
      const next = rows[nextIndex]
      if (!next) return
      event.preventDefault()
      store.selectRow(next.node.path, rows, { range: event.shiftKey })
    }

    switch (event.key) {
      case 'ArrowDown':
        moveTo(index === -1 ? 0 : index + 1)
        return
      case 'ArrowUp':
        moveTo(index === -1 ? rows.length - 1 : index - 1)
        return
      case 'Home':
        moveTo(0)
        return
      case 'End':
        moveTo(rows.length - 1)
        return
      case 'ArrowRight':
        if (!current) return
        event.preventDefault()
        // closed folder → open it; open folder → step into its first child
        if (current.node.kind === 'dir' && !expanded.has(current.node.path)) {
          store.toggleExpanded(current.node.path, true)
        } else if (current.node.kind === 'dir') {
          moveTo(index + 1)
        }
        return
      case 'ArrowLeft': {
        if (!current) return
        event.preventDefault()
        // open folder → close it; anything else → jump to the parent folder
        if (current.node.kind === 'dir' && expanded.has(current.node.path)) {
          store.toggleExpanded(current.node.path, false)
          return
        }
        const parent = parentDirOf(current.node.path)
        const parentIndex = rows.findIndex((r) => r.node.path === parent)
        if (parentIndex !== -1) moveTo(parentIndex)
        return
      }
      case 'Enter':
        event.preventDefault()
        if (current?.node.kind === 'dir') store.toggleExpanded(current.node.path)
        else store.openSelection(rows)
        return
      case 'Escape':
        event.preventDefault()
        store.clearSelection()
        return
      case 'a':
      case 'A':
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          store.selectAll(rows)
        }
        return
      case 'F2':
        if (current) {
          event.preventDefault()
          store.startRename(current.node)
        }
        return
      case 'Backspace':
      case 'Delete': {
        // Route through the menu's arm/confirm so deletion always takes two
        // deliberate actions, whether it starts from the keyboard or a click.
        if (!current || store.selection.length === 0) return
        event.preventDefault()
        const rect = listRef.current?.getBoundingClientRect()
        store.openMenu(current.node, (rect?.left ?? 0) + 40, (rect?.top ?? 0) + 40)
        store.armDelete()
        return
      }
      default:
    }
  }

  return (
    <div
      ref={listRef}
      className="tree"
      role="tree"
      aria-multiselectable
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {creatingAtRoot && <EditRow depth={0} initial="" />}
      {rows.map((row) => {
        const path = row.node.path
        const creatingHere =
          editing !== null && editing.kind !== 'rename' && editing.parentPath === path
        return (
          // A Fragment, not a wrapper div: role="treeitem" rows must be
          // direct children of role="tree".
          <Fragment key={path}>
            <TreeRow
              row={row}
              rows={rows}
              editing={editing}
              selected={selectionSet.has(path)}
              focused={focusPath === path}
              isOpen={openPaths.has(path) || path === manuscriptProsePath}
              isActive={
                activePath === path ||
                (path === manuscriptProsePath && activeManuscriptRoot === rootDir)
              }
              expanded={expanded.has(path) || forcesOpen(editing, path)}
              semantic={semantic.get(path)}
            />
            {creatingHere && <EditRow depth={row.depth + 1} initial="" />}
          </Fragment>
        )
      })}
      <ExplorerMenu />
    </div>
  )
}
