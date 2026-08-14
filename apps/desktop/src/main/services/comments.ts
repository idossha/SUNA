import { readFile } from 'node:fs/promises'
import { CommentsFileSchema, emptyCommentsFile, type CommentsFile } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { commentsJsonPath } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * manuscript/comments.json — sidecar review data shared by the UI and agents.
 * Same discipline as manuscript.json: read fresh, validate, write atomically.
 * A missing file reads as an empty file; it is created on first write.
 */

export async function readCommentsFile(dir: string): Promise<CommentsFile> {
  const file = await commentsJsonPath(assertInsideAllowedRoot(dir))
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return emptyCommentsFile()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    // Never silently discard review threads: surface the corruption instead.
    throw new Error(
      `comments.json is not valid JSON (${file}): ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return CommentsFileSchema.parse(parsed)
}

/** Validates with CommentsFileSchema, then writes atomically (defaults filled in). */
export async function writeCommentsFile(dir: string, file: unknown): Promise<void> {
  const validated = CommentsFileSchema.parse(file)
  const path = await commentsJsonPath(assertInsideAllowedRoot(dir))
  await writeFileAtomic(path, JSON.stringify(validated, null, 2) + '\n')
}
