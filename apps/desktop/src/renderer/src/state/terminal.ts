import { create } from 'zustand'

/**
 * Terminal panel chrome state (visibility + height). The terminal SESSIONS
 * themselves live at module scope in ../terminal/sessions.ts so shells and
 * scrollback survive panel toggles; this store is only the strip's geometry.
 */
export const TERMINAL_HEIGHT_MIN = 120
export const TERMINAL_HEIGHT_MAX = 640
export const TERMINAL_HEIGHT_DEFAULT = 240

const TERMINAL_HEIGHT_KEY = 'suna.terminalHeight'

function clampHeight(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_HEIGHT_DEFAULT
  return Math.min(TERMINAL_HEIGHT_MAX, Math.max(TERMINAL_HEIGHT_MIN, Math.round(value)))
}

function loadHeight(): number {
  try {
    const raw = window.localStorage.getItem(TERMINAL_HEIGHT_KEY)
    return raw === null ? TERMINAL_HEIGHT_DEFAULT : clampHeight(Number(raw))
  } catch {
    return TERMINAL_HEIGHT_DEFAULT
  }
}

interface TerminalPanelState {
  open: boolean
  /** Panel height in px, clamped to [TERMINAL_HEIGHT_MIN, TERMINAL_HEIGHT_MAX]. */
  heightPx: number
  toggle: () => void
  setOpen: (open: boolean) => void
  setHeight: (px: number) => void
}

export const useTerminalPanelStore = create<TerminalPanelState>((set) => ({
  open: false,
  heightPx: loadHeight(),
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setHeight: (px) => {
    const heightPx = clampHeight(px)
    try {
      window.localStorage.setItem(TERMINAL_HEIGHT_KEY, String(heightPx))
    } catch {
      // persistence is best-effort; the in-memory height still applies
    }
    set({ heightPx })
  }
}))
