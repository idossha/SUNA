import type { JSX } from 'react'
import { SIDEBAR_VIEWS, SIDEBAR_VIEW_LABELS, useUiStore } from '../state/ui'
import { VIEW_ICONS } from './icons'

export function ActivityBar(): JSX.Element {
  const activeView = useUiStore((s) => s.activeView)
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const setActiveView = useUiStore((s) => s.setActiveView)

  return (
    <nav className="activitybar" aria-label="Views">
      {SIDEBAR_VIEWS.map((view) => {
        const IconComponent = VIEW_ICONS[view]
        return (
          <button
            key={view}
            className="activitybar__item"
            aria-pressed={activeView === view && sidebarVisible}
            title={SIDEBAR_VIEW_LABELS[view]}
            onClick={() => setActiveView(view)}
          >
            <IconComponent />
          </button>
        )
      })}
      <div className="activitybar__spacer" />
    </nav>
  )
}
