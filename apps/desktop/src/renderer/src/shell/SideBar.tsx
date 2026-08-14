import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import {
  SIDEBAR_VIEW_LABELS,
  SIDEBAR_WIDTH_DEFAULT,
  useUiStore,
  type SidebarView
} from '../state/ui'
import { useProjectStore } from '../state/project'
import { useExplorerStore } from '../state/explorer'
import { ExplorerView } from './ExplorerView'
import { ManuscriptView } from '../views/ManuscriptView'
import { FiguresView } from '../views/FiguresView'
import { ReferencesView } from '../views/ReferencesView'
import { SourceControlView } from '../views/SourceControlView'
import { AgentView } from '../views/AgentView'
import { NewFileIcon, NewFolderIcon } from './icons'
import '../views/views.css'
import './sidebar.css'

const VIEW_EMPTY_COPY: Record<SidebarView, string> = {
  explorer: 'Open a project to browse its files.',
  manuscript: 'The section outline of your manuscript will live here.',
  figures: 'Figures and their generating scripts will appear here.',
  references: 'Your bibliography (references.bib) will be managed here.',
  git: 'Version history and pending changes will show here.',
  agent: 'Co-writing sessions with your AI collaborator will run here.'
}

const VIEW_COMPONENTS: Record<SidebarView, () => JSX.Element> = {
  explorer: ExplorerView,
  manuscript: ManuscriptView,
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
  // is simply clientX - left, clamped by the store
  const dragRef = useRef<{ pointerId: number; left: number } | null>(null)
  const [resizing, setResizing] = useState(false)

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const aside = asideRef.current
    if (!aside) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, left: aside.getBoundingClientRect().left }
    setResizing(true)
  }

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    useUiStore.getState().setSidebarWidth(event.clientX - drag.left)
  }

  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
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
