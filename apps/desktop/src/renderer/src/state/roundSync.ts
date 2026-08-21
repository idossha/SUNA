import { create } from 'zustand'

/**
 * "This round changed on disk — read it again."
 *
 * The comparison view writes replies through the same `review:set-point` IPC
 * the round workspace uses, so after a quote is inserted the round tab is
 * holding a stale copy. Rather than give the comparison a handle into the
 * round tab's state — two surfaces owning one document is how a reply gets
 * clobbered — it bumps a counter here and the round tab re-reads the file it
 * already knows how to read.
 *
 * Per round id, so a bump for round 2 does not re-read round 1.
 */
interface RoundSyncState {
  /** Bump count per round id. */
  ticks: Record<string, number>
  bump: (roundId: string) => void
}

export const useRoundSyncStore = create<RoundSyncState>((set) => ({
  ticks: {},
  bump: (roundId) =>
    set((s) => ({ ticks: { ...s.ticks, [roundId]: (s.ticks[roundId] ?? 0) + 1 } }))
}))

/** Tell any open workspace for this round to re-read it. */
export function roundChangedOnDisk(roundId: string): void {
  useRoundSyncStore.getState().bump(roundId)
}

/** The tick for one round — a dependency to hang a reload effect on. */
export function useRoundTick(roundId: string): number {
  return useRoundSyncStore((s) => s.ticks[roundId] ?? 0)
}
