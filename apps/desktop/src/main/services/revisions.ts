import { readFile } from 'node:fs/promises'
import { RevisionsFileSchema, emptyRevisionsFile, type RevisionsFile } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { revisionsJsonPath } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * manuscript/revisions.json — the AI-diff baseline (ARCHITECTURE §5.6).
 * Same discipline as comments.json: read fresh, validate, write atomically,
 * a missing file reads as empty and is created on first write.
 */

export async function readRevisionsFile(dir: string): Promise<RevisionsFile> {
  const file = await revisionsJsonPath(assertInsideAllowedRoot(dir))
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return emptyRevisionsFile()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    // A corrupt baseline must not be papered over: without it the review view
    // would silently show "no AI changes" over prose the AI did rewrite.
    throw new Error(
      `revisions.json is not valid JSON (${file}): ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return RevisionsFileSchema.parse(parsed)
}

/** Validates with RevisionsFileSchema, then writes atomically. */
export async function writeRevisionsFile(dir: string, file: unknown): Promise<void> {
  const validated = RevisionsFileSchema.parse(file)
  const path = await revisionsJsonPath(assertInsideAllowedRoot(dir))
  await writeFileAtomic(path, JSON.stringify(validated, null, 2) + '\n')
}
