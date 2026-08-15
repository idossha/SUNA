/**
 * Thin IPC glue for the palette's `?` mode: start an 'ai:ask' run, forward
 * its progress/outcome, and hand back a cancel handle. Kept out of
 * CommandPalette.tsx so that component stays about rendering/keyboard
 * handling; this is pure IO with nothing pure enough to unit test (it is a
 * direct pass-through of window.suna, same as terminal/sessions.ts's own
 * `startPty`).
 */

export interface AiAskOutcome {
  text: string | null
  error: string | null
}

export interface AiAskHandle {
  cancel: () => void
}

export async function startAiAsk(
  prompt: string,
  dir: string,
  onProgress: (status: string) => void,
  onDone: (outcome: AiAskOutcome) => void
): Promise<AiAskHandle> {
  const { askId } = await window.suna.invoke('ai:ask', { prompt, dir })
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
