import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  DEFAULT_PROJECT_DIRS,
  SunaProjectManifestSchema,
  resolveDocuments,
  synthesizedRegistry,
  type DocumentEntry,
  type ProjectDirKey
} from '@suna/core'

/**
 * Everything a manuscript verb needs to know about the project on disk.
 * Built fresh per tool call so external edits to suna.json take effect
 * without restarting the server.
 */
export interface ProjectContext {
  /** Absolute project root. */
  root: string
  /** Project name from suna.json, or null when no valid manifest exists. */
  name: string | null
  /** Active publisher profile id from suna.json, or null. */
  activeProfileId: string | null
  /** Directory names keyed by role (manuscript, figures, …). */
  dirs: Record<ProjectDirKey, string>
  /**
   * The document registry (ARCHITECTURE §4.2) — the declared one, or the synthesized
   * one-manuscript registry for a project written before it existed.
   */
  documents: DocumentEntry[]
}

/**
 * Read suna.json best-effort. The file verbs must work WITHOUT the app
 * running — and even without a manifest — so a missing or invalid
 * manifest falls back to the default directory layout.
 */
export async function loadProjectContext(rootDir: string): Promise<ProjectContext> {
  const root = resolve(rootDir)
  let name: string | null = null
  let activeProfileId: string | null = null
  let dirs: Record<ProjectDirKey, string> = { ...DEFAULT_PROJECT_DIRS }
  let documents: DocumentEntry[] = synthesizedRegistry()
  try {
    const raw: unknown = JSON.parse(await readFile(resolve(root, 'suna.json'), 'utf8'))
    const parsed = SunaProjectManifestSchema.safeParse(raw)
    if (parsed.success) {
      name = parsed.data.name
      activeProfileId = parsed.data.activeProfileId
      dirs = { ...DEFAULT_PROJECT_DIRS, ...parsed.data.directories }
      documents = resolveDocuments(parsed.data)
    }
  } catch {
    // no manifest — file verbs still operate on the default layout
  }
  return { root, name, activeProfileId, dirs, documents }
}

/**
 * Resolve path segments against the project root and refuse anything that
 * escapes it (`..`, absolute segments). Every verb that touches the file
 * system goes through this.
 */
export function resolveInside(root: string, ...segments: string[]): string {
  const abs = resolve(root, ...segments)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes the project root: ${segments.join('/')}`)
  }
  return abs
}
