/**
 * Thin IPC glue for 'ai:ask' runs: start one, forward its progress/outcome,
 * and hand back a cancel handle. Kept out of CommandPalette.tsx so that
 * component stays about rendering/keyboard handling; this is pure IO with
 * nothing pure enough to unit test (it is a direct pass-through of
 * window.suna, same as terminal/sessions.ts's own `startPty`).
 *
 * Two callers: the palette's `?` prefix (no options — the plain read-only
 * ask), and ai/directedActions.ts (DECISIONS 2026-08-17), which passes the
 * directed-action options through to the extended 'ai:ask' contract.
 */

import type { AiEffort, AiModel } from '@suna/core'
import { flushDirtySessions } from '../state/docSessions'
import { captureAiBaseline } from '../state/revisions'

export interface AiAskOutcome {
  text: string | null
  error: string | null
}

export interface AiAskHandle {
  cancel: () => void
}

/** Directed-action extensions (ARCHITECTURE §15.6); all claude-spawn-only. */
export interface AiAskRunOptions {
  /** Joined into one --allowed-tools argv element by main. */
  allowedTools?: string[]
  /** Append --mcp-config <dir>/.mcp.json when that file exists on disk. */
  useMcp?: boolean
  /** Deliver the prompt over stdin: no argv limit, and absent from `ps`. */
  viaStdin?: boolean
  /** One line naming this run in the AI-diff review bar (ARCHITECTURE §5.6). */
  label?: string
  /** Per-task model tier. Omit to use the project's setting. */
  model?: AiModel
  /** Per-task reasoning effort. Omit to use the project's setting. */
  effort?: AiEffort
}

export async function startAiAsk(
  prompt: string,
  dir: string,
  onProgress: (status: string) => void,
  onDone: (outcome: AiAskOutcome) => void,
  options?: AiAskRunOptions
): Promise<AiAskHandle> {
  // The agent reads from disk, so anything the author has typed but not saved
  // would be invisible to it — and a whole-file write would then erase it.
  // ARCHITECTURE §15.3.
  await flushDirtySessions(dir)
  // Snapshot the manuscript AFTER that flush, so the diff the author reviews
  // afterwards is against what they could actually see. A run that changes
  // nothing leaves a baseline identical to the file, which renders as no
  // hunks — harmless, and cleared by the first review action.
  await captureAiBaseline(options?.label ?? 'AI edit')
  const { askId } = await window.suna.invoke('ai:ask', {
    prompt,
    dir,
    allowedTools: options?.allowedTools,
    useMcp: options?.useMcp,
    viaStdin: options?.viaStdin,
    // Absent means "use the project/global setting"; present is a per-task
    // choice the user made for this one run.
    model: options?.model,
    effort: options?.effort
  })
  const offProgress = window.suna.onAiAskProgress(askId, onProgress)
  const offDone = window.suna.onAiAskDone(askId, (outcome) => {
    offProgress()
    offDone()
    onDone(outcome)
  })
  return {
    cancel: () => {
      void window.suna.invoke('ai:cancel', { askId }).catch(() => {})
    }
  }
}
