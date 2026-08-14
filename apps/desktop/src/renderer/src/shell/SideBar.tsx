import type { JSX } from 'react'
import { SIDEBAR_VIEW_LABELS, useUiStore, type SidebarView } from '../state/ui'
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
  const rootDir = useProjectStore((s) => s.rootDir)
  const startCreate = useExplorerStore((s) => s.startCreate)

  // The agent is usable without a project; every other view needs one.
  const showEmpty = rootDir === null && activeView !== 'agent'
  const ViewBody = VIEW_COMPONENTS[activeView]

  return (
    <aside className="sidebar">
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
    </aside>
  )
}
