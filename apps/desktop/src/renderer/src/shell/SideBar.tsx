import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import {
  resolveSidebarDrag,
  SIDEBAR_VIEW_LABELS,
  SIDEBAR_WIDTH_DEFAULT,
  useUiStore,
  type SidebarView
} from '../state/ui'
import { useProjectStore } from '../state/project'
import { useExplorerStore } from '../state/explorer'
import { ExplorerView } from './ExplorerView'
import { DocumentsView } from '../documents/DocumentsView'
import { FiguresView } from '../views/FiguresView'
import { ReferencesView } from '../views/ReferencesView'
import { SourceControlView } from '../views/SourceControlView'
import { AgentView } from '../views/AgentView'
import { NewFileIcon, NewFolderIcon } from './icons'
import '../views/views.css'
import './sidebar.css'

const VIEW_EMPTY_COPY: Record<SidebarView, string> = {
  explorer: 'Open a project to browse its files.',
  manuscript: 'Your manuscript, letters and rounds will live here.',
  figures: 'Figures and their generating scripts will appear here.',
  references: 'Your bibliography (references.bib) will be managed here.',
  git: 'Version history and pending changes will show here.',
  agent: 'Co-writing sessions with your AI collaborator will run here.'
}

const VIEW_COMPONENTS: Record<SidebarView, () => JSX.Element> = {
  explorer: ExplorerView,
  manuscript: DocumentsView,
  figures: FiguresView,
  references: ReferencesView,
  git: SourceControlView,
  agent: AgentView
}

export function SideBar(): JSX.Element {
  const activeView = useUiStore((s) => s.activeView)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const rootDir = useProjectStore((s) => s.rootDir)
  const startCreate = useExplorerStore((s) => s.startCreate)

  const asideRef = useRef<HTMLElement>(null)
  // pointer-capture drag state: the aside's left edge is fixed, so width
  // is simply clientX - left, clamped by the store.
  //
  // `width0` is the width the drag STARTED from. A drag that ends in a
  // collapse passes through the clamp floor on the way — 400 -> 250 -> 180 ->
  // collapse — and every intermediate step persists, so without the snapshot
  // the gesture documented to preserve the user's width destroys it and the
  // panel comes back at 180.
  const dragRef = useRef<{ pointerId: number; left: number; width0: number } | null>(null)
  const [resizing, setResizing] = useState(false)

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const aside = asideRef.current
    if (!aside) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      left: aside.getBoundingClientRect().left,
      width0: useUiStore.getState().sidebarWidth
    }
    setResizing(true)
  }

  // Dragging past the collapse threshold hides the panel instead of parking
  // at the minimum width, and restores the width the drag started from so
  // showing it again gives back the width the user chose. The drag needs no
  // cleanup in that case: the handle unmounts with the panel it belongs to.
  const applyDrag = (px: number, width0: number): void => {
    const drag = resolveSidebarDrag(px)
    const ui = useUiStore.getState()
    if (!drag.collapse) {
      ui.setSidebarWidth(drag.width)
      return
    }
    // Restore the width the drag started from before hiding, so showing the
    // panel again returns the user's chosen width rather than the clamp floor
    // the pointer swept through on its way here.
    ui.setSidebarWidth(width0)
    ui.setSidebarVisible(false)
  }

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applyDrag(event.clientX - drag.left, drag.width0)
  }

  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag?.pointerId !== event.pointerId) return
    // Commit where the pointer was released: a fast drag can have its last
    // pointermove events coalesced away, which used to leave the sidebar
    // parked short of where the user let go.
    applyDrag(event.clientX - drag.left, drag.width0)
    dragRef.current = null
    setResizing(false)
  }

  // The agent is usable without a project; every other view needs one.
  const showEmpty = rootDir === null && activeView !== 'agent'
  const ViewBody = VIEW_COMPONENTS[activeView]

  return (
    <aside ref={asideRef} className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar__header">
        <span>{SIDEBAR_VIEW_LABELS[activeView]}</span>
        {activeView === 'explorer' && rootDir !== null && (
          <span className="sidebar__actions">
            <button
              className="sidebar__action"
              title="New file at project root"
              onClick={() => startCreate(rootDir, 'create-file')}
            >
              <NewFileIcon />
            </button>
            <button
              className="sidebar__action"
              title="New folder at project root"
              onClick={() => startCreate(rootDir, 'create-dir')}
            >
              <NewFolderIcon />
            </button>
          </span>
        )}
      </div>
      <div className="sidebar__body">
        {showEmpty ? (
          <p className="sidebar__empty">{VIEW_EMPTY_COPY[activeView]}</p>
        ) : (
          <ViewBody />
        )}
      </div>
      <div
        className={`sidebar__resize${resizing ? ' sidebar__resize--active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize · double-click to reset"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={() => useUiStore.getState().setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
      />
    </aside>
  )
}
