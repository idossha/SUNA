import { ManuscriptSchema, type Manuscript } from '@suna/core'
import { useProjectStore } from '../../state/project'

export type CommitResult = { ok: true; manuscript: Manuscript } | { ok: false; error: string }

/**
 * Read → merge → validate → atomic write happens entirely in the main
 * process (services/manuscript.ts re-reads manuscript.json from disk on
 * every call — a stale in-memory copy is never written back here). This
 * helper just does the IPC round trip, parses the response with
 * ManuscriptSchema per the contract note, and bumps the project store's
 * saveBump so every other view (outline, references, sidebar) re-reads.
 * Never throws — failures (validation OR transport) come back as `error`.
 */
export async function commitManuscriptPatch(
  rootDir: string,
  patch: Record<string, unknown>
): Promise<CommitResult> {
  try {
    const res = await window.suna.invoke('manuscript:update', { dir: rootDir, patch })
    const parsed = ManuscriptSchema.safeParse(res.manuscript)
    if (!parsed.success) {
      return { ok: false, error: 'Saved, but the response could not be read.' }
    }
    useProjectStore.getState().noteFileSaved(`${rootDir}/manuscript/manuscript.json`)
    return { ok: true, manuscript: parsed.data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
