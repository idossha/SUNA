import { AuthorsFileSchema, ManuscriptSchema, emptyAuthorsFile, type AuthorsFile, type Manuscript } from '@suna/core'
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

export type AuthorsCommitResult =
  | { ok: true; authorsFile: AuthorsFile }
  | { ok: false; error: string }

/**
 * The authors/affiliations counterpart of `commitManuscriptPatch`, targeting
 * manuscript/authors.json (ARCHITECTURE §4.3 moved the byline out of
 * manuscript.json — see AuthorsFileSchema). There is no dedicated
 * `authors:update` IPC channel (the foundation's `manuscript:update`
 * read-merge-validate-write only ever touched manuscript.json), so this does
 * the same read → merge → validate → write itself over the generic
 * `fs:read-text` / `fs:write-text` channels the renderer already uses for
 * this file (state/manuscript.ts reads it the same way). Never throws —
 * failures (validation OR transport) come back as `error`, same contract as
 * commitManuscriptPatch.
 */
export async function commitAuthorsPatch(
  rootDir: string,
  patch: Record<string, unknown>
): Promise<AuthorsCommitResult> {
  const path = `${rootDir}/manuscript/authors.json`
  try {
    let current: AuthorsFile
    try {
      const res = await window.suna.invoke('fs:read-text', { path })
      const parsed = AuthorsFileSchema.safeParse(JSON.parse(res.content))
      current = parsed.success ? parsed.data : emptyAuthorsFile()
    } catch {
      current = emptyAuthorsFile()
    }
    const merged = { ...current, ...patch }
    const validated = AuthorsFileSchema.safeParse(merged)
    if (!validated.success) {
      return { ok: false, error: 'Could not save: the result would not be valid.' }
    }
    await window.suna.invoke('fs:write-text', {
      path,
      content: `${JSON.stringify(validated.data, null, 2)}\n`
    })
    useProjectStore.getState().noteFileSaved(path)
    return { ok: true, authorsFile: validated.data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
