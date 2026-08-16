import { create } from 'zustand'
import { openManuscriptTab } from './dock'
import { useProjectStore } from './project'

export const SIDEBAR_VIEWS = ['explorer', 'manuscript', 'figures', 'references', 'git', 'agent'] as const

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
/**
 * Dragging the resize handle narrower than this collapses the panel. It sits
 * BELOW SIDEBAR_WIDTH_MIN on purpose: the minimum is the narrowest the panel
 * is allowed to render at, so without a separate, lower threshold a drag to
 * the left edge just parks at the minimum and can never hide anything.
 */
export const SIDEBAR_COLLAPSE_AT = 120

const SIDEBAR_WIDTH_KEY = 'suna.sidebarWidth'
const SIDEBAR_VISIBLE_KEY = 'suna.sidebarVisible'
const RAIL_VISIBLE_KEY = 'suna.activityBarVisible'

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

/**
 * Only the two strings this module writes are data; anything else degrades to
 * `fallback`, the same way `clampSidebarWidth` sends a malformed width to the
 * default. `raw === 'true'` would send 'True', '1' or '' to FALSE — i.e. to
 * hidden, on the one flag whose false value is the trap-door state.
 */
function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return fallback
  } catch {
    return fallback
  }
}

export type SidebarDrag = { collapse: true } | { collapse: false; width: number }

/**
 * What a resize drag to `px` means. Pure, so the collapse threshold is
 * testable without a pointer: SideBar.tsx is the only caller.
 */
export function resolveSidebarDrag(px: number): SidebarDrag {
  if (!Number.isFinite(px)) return { collapse: false, width: SIDEBAR_WIDTH_DEFAULT }
  if (px < SIDEBAR_COLLAPSE_AT) return { collapse: true }
  return { collapse: false, width: clampSidebarWidth(px) }
}

/**
 * The one invariant behind the three-state left nav: the rail is the only way
 * to pick a view, so a visible panel with no rail is a dead end. Showing the
 * panel therefore always shows the rail, and hiding the rail always hides the
 * panel — leaving exactly three reachable states (rail + panel, rail only,
 * neither). Every visibility change goes through here, which is also where
 * both flags are persisted.
 *
 * The hidden state survives a restart, so the app can start with no left
 * chrome at all: TitleBar.tsx's toggle button is the way back and must stay
 * unconditional.
 */
function commitChrome(
  sidebarVisible: boolean,
  railVisible: boolean
): { sidebarVisible: boolean; railVisible: boolean } {
  const next = { sidebarVisible, railVisible: railVisible || sidebarVisible }
  try {
    window.localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(next.sidebarVisible))
    window.localStorage.setItem(RAIL_VISIBLE_KEY, String(next.railVisible))
  } catch {
    // persistence is best-effort; the in-memory state still applies
  }
  return next
}

function loadChrome(): { sidebarVisible: boolean; railVisible: boolean } {
  const sidebarVisible = loadFlag(SIDEBAR_VISIBLE_KEY, true)
  return { sidebarVisible, railVisible: sidebarVisible || loadFlag(RAIL_VISIBLE_KEY, true) }
}

interface UiState {
  activeView: SidebarView
  sidebarVisible: boolean
  /** Activity rail visibility. Never false while `sidebarVisible` is true — see commitChrome. */
  railVisible: boolean
  /** Sidebar width in px, clamped to [SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX]. */
  sidebarWidth: number
  statusNote: string | null
  setActiveView: (view: SidebarView) => void
  setSidebarVisible: (visible: boolean) => void
  setRailVisible: (visible: boolean) => void
  /** Panel only. */
  toggleSidebar: () => void
  /** Panel and rail together. */
  toggleLeftNav: () => void
  setSidebarWidth: (px: number) => void
  setStatusNote: (note: string | null) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  activeView: 'explorer',
  ...loadChrome(),
  sidebarWidth: loadSidebarWidth(),
  statusNote: null,
  setActiveView: (view) => {
    const wasActive = get().activeView === view
    // clicking the active view toggles the sidebar, like VS Code
    set(
      wasActive
        ? (s) => commitChrome(!s.sidebarVisible, s.railVisible)
        : { activeView: view, ...commitChrome(true, true) }
    )
    // Activating the Manuscript view (not merely toggling it while it's
    // already active, per the branch above) opens or focuses the combined
    // manuscript tab directly (feature-plan-7 §2) — the sidebar still shows
    // the outline + metadata summary alongside it. A side effect, so it runs
    // after the state update rather than inside the `set` updater itself.
    if (!wasActive && view === 'manuscript') {
      const { rootDir } = useProjectStore.getState()
      if (rootDir !== null) openManuscriptTab(rootDir)
    }
  },
  setSidebarVisible: (visible) => set((s) => commitChrome(visible, s.railVisible)),
  setRailVisible: (visible) => set((s) => commitChrome(visible ? s.sidebarVisible : false, visible)),
  toggleSidebar: () => set((s) => commitChrome(!s.sidebarVisible, s.railVisible)),
  toggleLeftNav: () => set((s) => commitChrome(!s.railVisible, !s.railVisible)),
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
