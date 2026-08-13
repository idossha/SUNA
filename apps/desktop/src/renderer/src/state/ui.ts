import { create } from 'zustand'

export const SIDEBAR_VIEWS = [
  'explorer',
  'manuscript',
  'figures',
  'references',
  'git',
  'agent'
] as const

export type SidebarView = (typeof SIDEBAR_VIEWS)[number]

export const SIDEBAR_VIEW_LABELS: Record<SidebarView, string> = {
  explorer: 'Explorer',
  manuscript: 'Manuscript',
  figures: 'Figures',
  references: 'References',
  git: 'Source Control',
  agent: 'Agent'
}

interface UiState {
  activeView: SidebarView
  sidebarVisible: boolean
  statusNote: string | null
  setActiveView: (view: SidebarView) => void
  setStatusNote: (note: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'explorer',
  sidebarVisible: true,
  statusNote: null,
  setActiveView: (view) =>
    set((s) =>
      // clicking the active view toggles the sidebar, like VS Code
      s.activeView === view
        ? { sidebarVisible: !s.sidebarVisible }
        : { activeView: view, sidebarVisible: true }
    ),
  setStatusNote: (note) => set({ statusNote: note })
}))
