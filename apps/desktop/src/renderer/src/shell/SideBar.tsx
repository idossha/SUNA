import type { JSX } from 'react'
import { SIDEBAR_VIEW_LABELS, useUiStore, type SidebarView } from '../state/ui'
import { ExplorerView } from './ExplorerView'

const VIEW_EMPTY_COPY: Record<SidebarView, string> = {
  explorer: 'Open a project to browse its files.',
  manuscript: 'The section outline of your manuscript will live here.',
  figures: 'Figures and their generating scripts will appear here.',
  references: 'Your bibliography (references.bib) will be managed here.',
  git: 'Version history and pending changes will show here.',
  agent: 'Co-writing sessions with your AI collaborator will run here.'
}

export function SideBar(): JSX.Element {
  const activeView = useUiStore((s) => s.activeView)

  return (
    <aside className="sidebar">
      <div className="sidebar__header">{SIDEBAR_VIEW_LABELS[activeView]}</div>
      <div className="sidebar__body">
        {activeView === 'explorer' ? (
          <ExplorerView />
        ) : (
          <p className="sidebar__empty">{VIEW_EMPTY_COPY[activeView]}</p>
        )}
      </div>
    </aside>
  )
}
