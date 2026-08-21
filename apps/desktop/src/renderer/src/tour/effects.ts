/**
 * The interpreter for the tour's `TourEffect` / `TourCue` descriptors
 * (tour/steps.ts). Everything that touches a store or the dock lives here so
 * the step list itself stays plain data.
 */
import {
  activePanelComponent,
  openFileTab,
  openManuscriptTab,
  openSettingsTab
} from '../state/dock'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { scanFigures } from '../views/figures-scan'
import type { SidebarView, TourCue, TourEffect } from './steps'

/**
 * Show a sidebar view without the activity bar's toggle behaviour:
 * `setActiveView` on the ALREADY-active view hides the panel (VS Code
 * convention), which for a tour step means the thing it points at disappears
 * the moment you step back onto that step.
 */
function showView(view: SidebarView): void {
  const ui = useUiStore.getState()
  if (ui.activeView === view) {
    ui.setRailVisible(true)
    ui.setSidebarVisible(true)
    return
  }
  ui.setActiveView(view)
}

export function applyEffect(effect: TourEffect): void {
  switch (effect.kind) {
    case 'chrome': {
      const ui = useUiStore.getState()
      ui.setRailVisible(true)
      ui.setSidebarVisible(true)
      return
    }
    case 'view':
      showView(effect.view)
      return
    case 'manuscript': {
      const { rootDir } = useProjectStore.getState()
      if (rootDir !== null) openManuscriptTab(rootDir)
      return
    }
    case 'figure': {
      // Only reached when the user pressed Next instead of clicking a figure.
      // If the tree has not loaded there is nothing to open and the card
      // falls back to its no-target layout — a missing anchor is never fatal.
      const hit = scanFigures(useProjectStore.getState().tree)[0]
      if (hit !== undefined) openFileTab(hit.svgPath)
      return
    }
    case 'settings':
      openSettingsTab()
      return
    case 'comments':
      useUiStore.getState().setCommentsRailVisible(effect.visible)
      return
  }
}

export function applyEffects(effects: readonly TourEffect[] | undefined): void {
  for (const effect of effects ?? []) applyEffect(effect)
}

/** Has the user done the thing this step invited them to do? */
export function isCueSatisfied(cue: TourCue): boolean {
  switch (cue.kind) {
    case 'view': {
      const ui = useUiStore.getState()
      return ui.activeView === cue.view && ui.sidebarVisible
    }
    case 'panel':
      return activePanelComponent() === cue.component
    case 'comments':
      return useUiStore.getState().commentsRailVisible
  }
}
