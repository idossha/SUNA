/**
 * Thin IPC glue for 'ai:ask' runs: start one, forward its progress/outcome,
 * and hand back a cancel handle. Kept out of CommandPalette.tsx so that
 * component stays about rendering/keyboard handling; this is pure IO with
 * nothing pure enough to unit test (it is a direct pass-through of
 * window.suna, same as terminal/sessions.ts's own `startPty`).
 *
 * Two callers: the palette's `?` prefix (no options — the plain read-only
 * ask), and ai/directedActions.ts (feature-plan-8 §2c), which passes the
 * directed-action options through to the extended 'ai:ask' contract.
 */

import { flushDirtySessions } from '../state/docSessions'

export interface AiAskOutcome {
  text: string | null
  error: string | null
}

export interface AiAskHandle {
  cancel: () => void
}

/** Directed-action extensions (feature-plan-8 §2a); all claude-spawn-only. */
export interface AiAskRunOptions {
  /** Joined into one --allowed-tools argv element by main. */
  allowedTools?: string[]
  /** Append --mcp-config <dir>/.mcp.json when that file exists on disk. */
  useMcp?: boolean
  /** Deliver the prompt over stdin: no argv limit, and absent from `ps`. */
  viaStdin?: boolean
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
  // feature-plan-11 §11d.
  await flushDirtySessions(dir)
  const { askId } = await window.suna.invoke('ai:ask', {
    prompt,
    dir,
    allowedTools: options?.allowedTools,
    useMcp: options?.useMcp,
    viaStdin: options?.viaStdin
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
