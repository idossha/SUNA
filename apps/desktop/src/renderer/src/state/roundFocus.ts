import { create } from 'zustand'

/**
 * Which reviewer point the round workspace is looking at, and how.
 *
 * It lives outside the tab because two surfaces drive it: the sidebar's
 * point-by-point outline (which stands in for the manuscript outline while a
 * round is selected) and the round tab's own list. An outline that could not
 * move the tab's selection would be a decorative list of the points.
 */
export type RoundMode = 'focus' | 'scroll'

interface RoundFocusState {
  roundId: string | null
  pointId: string | null
  mode: RoundMode
  /** Bumped on every request, so re-picking the same point re-scrolls to it. */
  nonce: number
  focus: (roundId: string, pointId: string) => void
  /**
   * Report which point the reader has scrolled to, WITHOUT bumping the nonce.
   * Scroll-spy and scroll-to are the same state read in two directions, and a
   * spy that bumped the nonce would re-scroll the pane it was reading — the
   * feedback loop that makes an outline fight the mouse wheel.
   */
  mark: (roundId: string, pointId: string) => void
  setMode: (mode: RoundMode) => void
}

export const useRoundFocusStore = create<RoundFocusState>((set) => ({
  roundId: null,
  pointId: null,
  // Continuous is the default: opening a round should read like the
  // manuscript does — every point in one scroll — rather than dropping you
  // into a single card with no sense of how much is left.
  mode: 'scroll',
  nonce: 0,
  focus: (roundId, pointId) => set((s) => ({ roundId, pointId, nonce: s.nonce + 1 })),
  mark: (roundId, pointId) =>
    set((s) => (s.roundId === roundId && s.pointId === pointId ? s : { roundId, pointId })),
  setMode: (mode) => set({ mode })
}))

export function focusRoundPoint(roundId: string, pointId: string): void {
  useRoundFocusStore.getState().focus(roundId, pointId)
}

export function markRoundPoint(roundId: string, pointId: string): void {
  useRoundFocusStore.getState().mark(roundId, pointId)
}
