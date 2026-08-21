import type { JSX } from 'react'
import { formatShortcut } from '../palette/shortcuts'
import { SIDEBAR_VIEWS, SIDEBAR_VIEW_LABELS, useUiStore } from '../state/ui'
import { VIEW_ICONS } from './icons'

const TOGGLE_HINT = `${formatShortcut('Mod-Shift-KeyB')} to toggle`

export function ActivityBar(): JSX.Element {
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)

  return (
    <nav className="activitybar" aria-label="Views">
      {SIDEBAR_VIEWS.map((view) => {
        const IconComponent = VIEW_ICONS[view]
        return (
          <button
            key={view}
            className="activitybar__item"
            // Stable hook for the guided tour (tour/steps.ts) and e2e probes:
            // the icons carry no text, so there is nothing else to aim at.
            data-view={view}
            // Tracks the active VIEW, not the panel: the highlight has to say
            // which view comes back when the panel is shown again.
            aria-pressed={activeView === view}
            title={`${SIDEBAR_VIEW_LABELS[view]} (${TOGGLE_HINT})`}
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
