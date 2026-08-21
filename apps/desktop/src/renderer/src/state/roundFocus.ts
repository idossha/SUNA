import { create } from 'zustand'
import type { PointStatus } from '@suna/core'

/**
 * Which reviewer point the round workspace is looking at, and how.
 *
 * It lives outside the tab because two surfaces drive it: the sidebar's
 * point-by-point outline (which stands in for the manuscript outline while a
 * round is selected) and the round tab's own list. An outline that could not
 * move the tab's selection would be a decorative list of the points.
 */
export type RoundMode = 'focus' | 'scroll'

/**
 * A pane of the round workspace. There are exactly two and there will never
 * be more: the feature is reading one reviewer's point beside another's, and
 * a third column of 820px cards does not fit a laptop screen — so the cap is
 * in the type rather than in a length check somewhere.
 *
 * `a` is the pane that is always there. `b` appears only while `split` is on.
 */
export type RoundPane = 'a' | 'b'

/**
 * Which points the round workspace shows. `all` is not a status: it is the
 * absence of a filter, and it is the default, because a response is answered
 * against the whole set of points and hiding some of them is a temporary
 * working choice rather than a property of the round.
 *
 * `done` covers `rebutted` too. Both are closed outcomes — the point has an
 * answer and a decision — and a rebutted point that matched no filter at all
 * would simply vanish from a filtered workspace.
 */
export type PointFilter = 'all' | 'unaddressed' | 'drafted' | 'done'

/** Does a point in this state survive the filter? */
export function matchesPointFilter(status: PointStatus, filter: PointFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'done') return status === 'done' || status === 'rebutted'
  return status === filter
}

interface RoundFocusState {
  roundId: string | null
  /**
   * The point each pane is parked on. Per-pane rather than one selection,
   * because the whole point of the second pane is that it stays on a
   * different point while you work in the first.
   */
  points: Record<RoundPane, string | null>
  /**
   * The pane a selection made ELSEWHERE lands in — the sidebar outline is
   * one list driving two panes, and without this it could only ever drive
   * the left one. Clicking anywhere inside a pane makes it the active one,
   * so "click the pane, then click the point" is the whole interaction.
   */
  activePane: RoundPane
  /** Is the second pane showing? Toggled from the round header. */
  split: boolean
  mode: RoundMode
  filter: PointFilter
  /**
   * Bumped per pane on every explicit request, so re-picking the same point
   * re-scrolls to it — and so a pick aimed at one pane never scrolls the
   * other.
   */
  nonces: Record<RoundPane, number>
  /** Pick a point and scroll to it. Defaults to whichever pane is active. */
  focus: (roundId: string, pointId: string, pane?: RoundPane) => void
  /**
   * Report which point the reader has scrolled to, WITHOUT bumping the nonce.
   * Scroll-spy and scroll-to are the same state read in two directions, and a
   * spy that bumped the nonce would re-scroll the pane it was reading — the
   * feedback loop that makes an outline fight the mouse wheel.
   */
  mark: (roundId: string, pointId: string, pane?: RoundPane) => void
  setActivePane: (pane: RoundPane) => void
  /**
   * Show or hide the second pane. Opening it seeds pane B with whatever pane
   * A is on: an empty second pane in Focus mode is a blank half-screen, and
   * the first thing anyone does is pick the point they wanted to compare
   * against anyway.
   */
  setSplit: (split: boolean) => void
  toggleSplit: () => void
  setMode: (mode: RoundMode) => void
  setFilter: (filter: PointFilter) => void
}

export const useRoundFocusStore = create<RoundFocusState>((set) => ({
  roundId: null,
  points: { a: null, b: null },
  activePane: 'a',
  split: false,
  // Continuous is the default: opening a round should read like the
  // manuscript does — every point in one scroll — rather than dropping you
  // into a single card with no sense of how much is left.
  mode: 'scroll',
  filter: 'all',
  nonces: { a: 0, b: 0 },
  focus: (roundId, pointId, pane) =>
    set((s) => {
      const target = pane ?? s.activePane
      return {
        roundId,
        // Moving to a different round leaves the other pane pointing at a
        // point that is not in this round's reports; clearing it is the only
        // honest answer, and the pane says "choose a point" instead.
        points: { ...panesFor(s, roundId), [target]: pointId },
        activePane: target,
        nonces: { ...s.nonces, [target]: s.nonces[target] + 1 }
      }
    }),
  mark: (roundId, pointId, pane) =>
    set((s) => {
      const target = pane ?? s.activePane
      if (s.roundId === roundId && s.points[target] === pointId) return s
      return {
        roundId,
        points: { ...panesFor(s, roundId), [target]: pointId }
      }
    }),
  setActivePane: (activePane) => set({ activePane }),
  setSplit: (split) =>
    set((s) => ({
      split,
      activePane: split ? s.activePane : 'a',
      points: split && s.points.b === null ? { ...s.points, b: s.points.a } : s.points,
      nonces: split ? { ...s.nonces, b: s.nonces.b + 1 } : s.nonces
    })),
  toggleSplit: () => {
    const { split, setSplit } = useRoundFocusStore.getState()
    setSplit(!split)
  },
  setMode: (mode) => set({ mode }),
  setFilter: (filter) => set({ filter })
}))

/** The pane selections to build on: kept for the same round, dropped for a new one. */
function panesFor(
  s: Pick<RoundFocusState, 'roundId' | 'points'>,
  roundId: string
): Record<RoundPane, string | null> {
  return s.roundId === roundId ? s.points : { a: null, b: null }
}

export function focusRoundPoint(roundId: string, pointId: string, pane?: RoundPane): void {
  useRoundFocusStore.getState().focus(roundId, pointId, pane)
}

export function markRoundPoint(roundId: string, pointId: string, pane?: RoundPane): void {
  useRoundFocusStore.getState().mark(roundId, pointId, pane)
}

/** Show or hide the round workspace's second pane. */
export function toggleRoundSplit(): void {
  useRoundFocusStore.getState().toggleSplit()
}
