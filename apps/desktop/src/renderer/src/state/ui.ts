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

export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 560
export const SIDEBAR_WIDTH_DEFAULT = 272

const SIDEBAR_WIDTH_KEY = 'suna.sidebarWidth'

function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)))
}

function loadSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
    return raw === null ? SIDEBAR_WIDTH_DEFAULT : clampSidebarWidth(Number(raw))
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

interface UiState {
  activeView: SidebarView
  sidebarVisible: boolean
  /** Sidebar width in px, clamped to [SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX]. */
  sidebarWidth: number
  statusNote: string | null
  setActiveView: (view: SidebarView) => void
  setSidebarWidth: (px: number) => void
  setStatusNote: (note: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'explorer',
  sidebarVisible: true,
  sidebarWidth: loadSidebarWidth(),
  statusNote: null,
  setActiveView: (view) =>
    set((s) =>
      // clicking the active view toggles the sidebar, like VS Code
      s.activeView === view
        ? { sidebarVisible: !s.sidebarVisible }
        : { activeView: view, sidebarVisible: true }
    ),
  setSidebarWidth: (px) => {
    const width = clampSidebarWidth(px)
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
    } catch {
      // persistence is best-effort; the in-memory width still applies
    }
    set({ sidebarWidth: width })
  },
  setStatusNote: (note) => set({ statusNote: note })
}))
