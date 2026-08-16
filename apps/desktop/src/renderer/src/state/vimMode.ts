import { create } from 'zustand'

/**
 * The vim mode of the editor that last reported one — 'normal', 'insert',
 * 'visual line', … — and null when no mounted editor has vim installed.
 *
 * It exists so the status bar can show the mode without importing CodeMirror:
 * editor/codemirror.ts publishes here from the vim plugin's own
 * 'vim-mode-change' event (and on focus), shell/StatusBar.tsx subscribes.
 *
 * Publishing is OWNER-AWARE rather than a bare last-writer setter. dockview
 * keeps hidden panels mounted, so several vim editors exist at once; a plain
 * setter meant that closing any one of them pushed `null` and blanked the chip
 * while another editor was still in normal mode — leaving the user typing
 * motions into a manuscript with nothing on screen saying vim was on. A `null`
 * from a non-current owner is therefore ignored.
 */
interface VimModeState {
  /** Which editor `mode` belongs to. Opaque token, compared by identity. */
  owner: object | null
  mode: string | null
  setMode: (owner: object, mode: string | null) => void
}

export const useVimModeStore = create<VimModeState>((set, get) => ({
  owner: null,
  mode: null,
  setMode: (owner, mode) => {
    if (mode !== null) {
      set({ owner, mode })
      return
    }
    // Only the editor currently on the chip may clear it.
    if (get().owner === owner) set({ owner: null, mode: null })
  }
}))
