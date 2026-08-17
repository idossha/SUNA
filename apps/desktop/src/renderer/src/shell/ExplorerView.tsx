import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { flushSync } from 'react-dom'
import type { ProjectDirKey } from '@suna/core'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { useUiStore } from '../state/ui'
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
import {
  dropTargetDir,
  EXPLORER_DRAG_MIME,
  namesInDir,
  parseDragPayload,
  pathsToMove,
  resolveDrop,
  type DropResolution
} from './explorer-dnd'
import {
  OS_ACTION_SHORTCUTS,
  openWithOs,
  osActionLabels,
  revealInOs
} from './os-actions'
import { formatShortcut, matchesShortcut } from '../palette/shortcuts'
import { FILE_ICONS, FolderIcon, FolderOpenIcon, PROJECT_DIR_ICONS, TreeChevronIcon } from './icons'
import './explorer.css'

/** Platform wording is fixed for the process; resolve it once. */
const osLabels = osActionLabels(window.suna.platform)

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

/**
 * Pointer and drag handlers for a row. They live in ExplorerView, not in
 * TreeRow, because all of them share one deferred-collapse and one
 * dragged-paths ref across every row in the tree.
 */
interface RowGestures {
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>, row: ExplorerRow) => void
  onMouseUp: (event: ReactMouseEvent<HTMLDivElement>, row: ExplorerRow) => void
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, row: ExplorerRow) => void
  onDragEnter: (event: ReactDragEvent<HTMLDivElement>, row: ExplorerRow) => void
  onDragOver: (event: ReactDragEvent<HTMLDivElement>, row: ExplorerRow) => void
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop: (event: ReactDragEvent<HTMLDivElement>, row: ExplorerRow) => void
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
  /** This row is the directory the drag in flight would land in. */
  droptarget: boolean
  gestures: RowGestures
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
  droptarget,
  gestures,
  semantic
}: TreeRowProps): JSX.Element {
  const { node, depth } = row
  const openMenu = useExplorerStore((s) => s.openMenu)
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
    isActive ? 'tree__row--active' : '',
    droptarget ? 'tree__row--droptarget' : ''
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
      draggable
      onDragStart={(e) => gestures.onDragStart(e, row)}
      onDragEnter={(e) => gestures.onDragEnter(e, row)}
      onDragOver={(e) => gestures.onDragOver(e, row)}
      onDragLeave={gestures.onDragLeave}
      onDrop={(e) => gestures.onDrop(e, row)}
      onMouseDown={(e) => gestures.onMouseDown(e, row)}
      onMouseUp={(e) => gestures.onMouseUp(e, row)}
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
  // Clamp against the menu's REAL size: 7 items + 2 separators, and a widest
  // row of "Reveal in Finder ⌘⌥R". Sized for 5 items these constants let the
  // Delete row render past the bottom edge, where it cannot be clicked.
  const left = Math.min(menu.x, window.innerWidth - 240)
  const top = Math.min(menu.y, window.innerHeight - 240)

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
        <div className="ctxmenu__sep" />
        {/* Single-target for the same reason Rename is: N rows would mean N
            Finder windows and N app launches. */}
        <button
          className="ctxmenu__item"
          data-action="reveal-in-os"
          disabled={multi}
          onClick={() => {
            closeMenu()
            void revealInOs(menu.node.path)
          }}
        >
          <span>{osLabels.reveal}</span>
          <span className="ctxmenu__accel">{formatShortcut(OS_ACTION_SHORTCUTS.reveal)}</span>
        </button>
        <button
          className="ctxmenu__item"
          data-action="open-with-os"
          disabled={multi}
          onClick={() => {
            closeMenu()
            void openWithOs(menu.node.path)
          }}
        >
          <span>{osLabels.open}</span>
          <span className="ctxmenu__accel">{formatShortcut(OS_ACTION_SHORTCUTS.open)}</span>
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

  /** Directory the drag in flight would land in, or null when nothing is
   *  hovered or the hovered target is refused. Mirrored in a ref so a handler
   *  can tell "already painted" from "needs painting" without re-rendering. */
  const [dropDir, setDropDir] = useState<string | null>(null)
  const dropDirRef = useRef<string | null>(null)
  /**
   * Paths the current drag carries. Held in a ref rather than read back from
   * the DataTransfer because `getData` is unreadable during `dragover` — only
   * the type list is exposed there, which is what EXPLORER_DRAG_MIME is for.
   */
  const draggedRef = useRef<readonly string[]>([])
  /** A selection collapse a plain mousedown deferred; see onRowMouseDown. */
  const pendingCollapseRef = useRef<string | null>(null)
  /** The status note a refused hover put up, so it can be taken down again. */
  const dragNoteRef = useRef<string | null>(null)

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

    // ⌥⌘R / ⌥⌘O are matched on event.code through the shared matcher, NOT in
    // the switch below: ⌥ is a layout modifier on macOS (⌥R types ®), so
    // event.key is not the letter here, and matchesShortcut also rejects the
    // extra-modifier chords a hand-rolled check would let through. Both act on
    // the focused row alone — like Rename…, they take one target, and N rows
    // would mean N Finder windows.
    if (current) {
      if (matchesShortcut(event, OS_ACTION_SHORTCUTS.reveal)) {
        event.preventDefault()
        void revealInOs(current.node.path)
        return
      }
      if (matchesShortcut(event, OS_ACTION_SHORTCUTS.open)) {
        event.preventDefault()
        void openWithOs(current.node.path)
        return
      }
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

  /* ---- drag and drop (feature-plan-9 §2) ---------------------------------- */

  /** What a drop over `overPath` (null = the empty area, i.e. the root) does. */
  const resolveOver = (
    overPath: string | null,
    overIsDir: boolean,
    dragged: readonly string[]
  ): DropResolution => {
    if (rootDir === null) return { targetDir: null, allowed: false, reason: null }
    const targetDir = dropTargetDir(overPath, overIsDir, rootDir)
    return resolveDrop({
      dragged,
      overPath,
      overIsDir,
      rootDir,
      namesInTarget: namesInDir(tree, targetDir)
    })
  }

  /**
   * Paint (or unpaint) the resolved drop target. React classes `dragover` as a
   * CONTINUOUS event, so a plain setState lands a scheduler tick later — after
   * the dragover it answers has already returned. Feedback that trails the
   * pointer is wrong for a user and invisible to a driver reading the DOM in
   * the same turn it dispatched the event, so the one paint is flushed on the
   * spot. The ref guard keeps that to the frames where it actually changes.
   */
  const paintDropTarget = (next: string | null): void => {
    if (dropDirRef.current === next) return
    dropDirRef.current = next
    flushSync(() => setDropDir(next))
  }

  /**
   * Take down the note a refused hover put up — but only while it is still
   * ours: anything written since (a save, an error) belongs to somebody else
   * and outranks a drag that is over.
   */
  const clearDragNote = (): void => {
    const mine = dragNoteRef.current
    if (mine === null) return
    dragNoteRef.current = null
    const ui = useUiStore.getState()
    if (ui.statusNote === mine) ui.setStatusNote(null)
  }

  /** Undo everything a drag painted or said. */
  const endDrag = (): void => {
    draggedRef.current = []
    paintDropTarget(null)
    clearDragNote()
  }

  const onRowMouseDown = (event: ReactMouseEvent<HTMLDivElement>, row: ExplorerRow): void => {
    if (event.button !== 0) return
    const path = row.node.path
    const additive = event.metaKey || event.ctrlKey
    const range = event.shiftKey
    const store = useExplorerStore.getState()
    pendingCollapseRef.current = null
    // Finder/VS Code semantics: pressing on a row that is ALREADY part of a
    // multi-selection must not collapse it, or the drag this press begins
    // would carry one row instead of the several under the pointer. The
    // collapse is deferred to mouseup, where a plain click still gets it and
    // a dragstart cancels it. Modifier clicks are unchanged.
    if (!additive && !range && store.selection.length > 1 && store.selection.includes(path)) {
      pendingCollapseRef.current = path
      return
    }
    store.selectRow(path, rows, { additive, range })
  }

  const onRowMouseUp = (event: ReactMouseEvent<HTMLDivElement>, row: ExplorerRow): void => {
    const pending = pendingCollapseRef.current
    pendingCollapseRef.current = null
    if (event.button !== 0 || pending !== row.node.path) return
    // mouseup lands before click, so the row this collapses onto is the row
    // the click then opens.
    useExplorerStore.getState().selectRow(row.node.path, rows, {})
  }

  const onRowDragStart = (event: ReactDragEvent<HTMLDivElement>, row: ExplorerRow): void => {
    const path = row.node.path
    const store = useExplorerStore.getState()
    // The drag takes the whole selection, so the deferred collapse is off.
    pendingCollapseRef.current = null
    let paths: readonly string[] = store.selection
    if (!paths.includes(path)) {
      store.selectRow(path, rows, {})
      paths = [path]
    }
    draggedRef.current = [...paths]
    event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(paths))
    // A text/plain fallback of the same paths, so the payload is legible to
    // anything that only speaks text (a terminal, a text field).
    event.dataTransfer.setData('text/plain', paths.join('\n'))
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDragOverTarget = (
    event: ReactDragEvent<HTMLDivElement>,
    row: ExplorerRow | null
  ): void => {
    if (!event.dataTransfer.types.includes(EXPLORER_DRAG_MIME)) return
    // A row answers for itself; without this the container underneath would
    // re-resolve the same pointer as a drop on the project root.
    if (row !== null) event.stopPropagation()
    event.preventDefault()
    const resolution = resolveOver(
      row?.node.path ?? null,
      row?.node.kind === 'dir',
      draggedRef.current
    )
    event.dataTransfer.dropEffect = resolution.allowed ? 'move' : 'none'
    paintDropTarget(resolution.allowed ? resolution.targetDir : null)
    // dropEffect 'none' cancels the drag outright — no drop event ever fires —
    // so a refusal with something to say has to say it here, while the pointer
    // is still over the target being refused.
    if (!resolution.allowed && resolution.reason !== null) {
      if (dragNoteRef.current !== resolution.reason) {
        useUiStore.getState().setStatusNote(resolution.reason)
        dragNoteRef.current = resolution.reason
      }
    } else {
      clearDragNote()
    }
  }

  const onDragLeaveTarget = (event: ReactDragEvent<HTMLDivElement>): void => {
    // dragleave fires on every row boundary crossed; only a pointer that has
    // actually left the tree should unpaint it.
    const related = event.relatedTarget as Node | null
    if (related !== null && listRef.current?.contains(related) === true) return
    paintDropTarget(null)
  }

  const onDropTarget = (event: ReactDragEvent<HTMLDivElement>, row: ExplorerRow | null): void => {
    if (!event.dataTransfer.types.includes(EXPLORER_DRAG_MIME)) return
    if (row !== null) event.stopPropagation()
    event.preventDefault()
    // At drop time the DataTransfer is readable, and it — not the ref dragover
    // had to make do with — is the payload of record.
    const dragged =
      parseDragPayload(event.dataTransfer.getData(EXPLORER_DRAG_MIME)) ?? draggedRef.current
    const resolution = resolveOver(row?.node.path ?? null, row?.node.kind === 'dir', dragged)
    endDrag()
    if (!resolution.allowed || resolution.targetDir === null) return
    void useExplorerStore
      .getState()
      .moveInto(pathsToMove(dragged, resolution.targetDir), resolution.targetDir)
  }

  const gestures: RowGestures = {
    onMouseDown: onRowMouseDown,
    onMouseUp: onRowMouseUp,
    onDragStart: onRowDragStart,
    // dragenter shares dragover's handler: the HTML spec has dragenter
    // participating in drop-target selection, and cancelling only dragover
    // leaves the target up to engine behaviour no driver here exercises.
    onDragEnter: onDragOverTarget,
    onDragOver: onDragOverTarget,
    onDragLeave: onDragLeaveTarget,
    onDrop: onDropTarget
  }

  return (
    <div
      ref={listRef}
      className={dropDir !== null && dropDir === rootDir ? 'tree tree--droptarget' : 'tree'}
      role="tree"
      aria-multiselectable
      tabIndex={0}
      onKeyDown={onKeyDown}
      // The container handles the empty area below the last row (rows stop
      // their own drag events from reaching it), which is the project-root
      // drop. dragend bubbles here from the source row, so one handler clears
      // a drag that ended anywhere — including a cancelled one.
      onDragEnter={(e) => onDragOverTarget(e, null)}
      onDragOver={(e) => onDragOverTarget(e, null)}
      onDragLeave={onDragLeaveTarget}
      onDrop={(e) => onDropTarget(e, null)}
      onDragEnd={endDrag}
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
              droptarget={dropDir !== null && dropDir === path}
              gestures={gestures}
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
