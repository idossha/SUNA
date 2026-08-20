import { create } from 'zustand'

/**
 * Progress/cancel state for directed AI action runs (feature-plan-8 §2c),
 * keyed 'comment:<id>' / 'figure:<figureId>' / 'repair'. A store rather than
 * component state because the surfaces that display a run unmount freely
 * mid-run — dockview detaches hidden panels and ThreadCard unmounts on
 * deactivate — while the CLI child process keeps going; the run's note and
 * cancel handle must survive that.
 */

export interface AiActionRun {
  status: 'busy'
  /** Latest progress line from the CLI adapter (e.g. "Thinking…"). */
  note: string
  /** Kills the underlying child process; safe to call more than once. */
  cancel: () => void
}

interface AiActionsState {
  runs: Record<string, AiActionRun>
  /**
   * Finished answers that are a PROPOSAL rather than a change — the reviewer
   * reply drafts, whose text lands in the author's box only once they accept
   * it. Kept here, beside the runs, for the same reason the runs are: the
   * card that asked for the draft unmounts freely while the CLI works, and a
   * proposal held in component state would be lost by whichever scroll or
   * mode switch happened to unmount it.
   */
  proposals: Record<string, string>
  start: (key: string, note: string, cancel: () => void) => void
  progress: (key: string, note: string) => void
  finish: (key: string) => void
  propose: (key: string, text: string) => void
  clearProposal: (key: string) => void
}

export const useAiActionsStore = create<AiActionsState>((set) => ({
  runs: {},
  proposals: {},

  start: (key, note, cancel) =>
    set((s) => ({ runs: { ...s.runs, [key]: { status: 'busy', note, cancel } } })),

  // The done event can race a last synthetic progress tick — a tick landing
  // after finish() must not resurrect a run that already ended.
  progress: (key, note) =>
    set((s) => {
      const run = s.runs[key]
      if (run === undefined) return s
      return { runs: { ...s.runs, [key]: { ...run, note } } }
    }),

  finish: (key) =>
    set((s) => {
      if (s.runs[key] === undefined) return s
      const runs = { ...s.runs }
      delete runs[key]
      return { runs }
    }),

  propose: (key, text) => set((s) => ({ proposals: { ...s.proposals, [key]: text } })),

  clearProposal: (key) =>
    set((s) => {
      if (s.proposals[key] === undefined) return s
      const proposals = { ...s.proposals }
      delete proposals[key]
      return { proposals }
    })
}))

/** Key spellings shared by the runner and every surface that reads a run. */
export const commentRunKey = (commentId: string): string => `comment:${commentId}`
export const figureRunKey = (figureId: string): string => `figure:${figureId}`
export const REPAIR_RUN_KEY = 'repair'
export const pointRunKey = (pointId: string): string => `point:${pointId}`
