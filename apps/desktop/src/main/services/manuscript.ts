import { readFile } from 'node:fs/promises'
import { ManuscriptSchema } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { manuscriptJsonPath } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * manuscript.json is the source of truth and an agent may be editing it at the
 * same time as the UI. Every update therefore re-reads the file from disk,
 * merges the caller's patch onto that fresh object, validates it, and writes
 * atomically — a stale in-memory copy is never written back.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge patch semantics:
 * - plain object + plain object → merged key by key (recursively)
 * - arrays, scalars and null → replace the base value wholesale
 * - `undefined` in the patch → leave the base value untouched (use null to
 *   clear a nullable field)
 */
export function deepMergePatch(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch
  const source = isPlainObject(base) ? base : {}
  const out: Record<string, unknown> = { ...source }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = deepMergePatch(source[key], value)
  }
  return out
}

async function readManuscriptJson(file: string): Promise<unknown> {
  const raw = await readFile(file, 'utf8')
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(
      `manuscript.json is not valid JSON (${file}): ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** The manuscript as it exists on disk, validated. */
export async function readManuscript(dir: string): Promise<Record<string, unknown>> {
  const file = await manuscriptJsonPath(assertInsideAllowedRoot(dir))
  const current = await readManuscriptJson(file)
  ManuscriptSchema.parse(current)
  return current as Record<string, unknown>
}

/**
 * Read → merge → validate → atomic write. Throws (leaving the file untouched)
 * when the patch is not an object or the merged document fails
 * ManuscriptSchema. Returns the merged document; unknown top-level keys already
 * present in the file are preserved rather than stripped by validation.
 */
export async function updateManuscript(
  dir: string,
  patch: unknown
): Promise<Record<string, unknown>> {
  if (patch !== undefined && !isPlainObject(patch)) {
    throw new Error('manuscript patch must be an object')
  }
  const file = await manuscriptJsonPath(assertInsideAllowedRoot(dir))
  const current = await readManuscriptJson(file)
  const merged = deepMergePatch(current, patch ?? {})
  if (!isPlainObject(merged)) throw new Error('merged manuscript is not an object')
  // Validate before writing: an invalid patch must never reach the file.
  ManuscriptSchema.parse(merged)
  await writeFileAtomic(file, JSON.stringify(merged, null, 2) + '\n')
  return merged
}
