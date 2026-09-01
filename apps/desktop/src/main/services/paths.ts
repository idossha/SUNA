import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_PROJECT_DIRS,
  SunaProjectManifestSchema,
  documentPaths,
  resolveDocuments,
  synthesizedRegistry,
  type DocumentEntry,
  type ProjectDirKey
} from '@suna/core'

/**
 * Project sub-directories come from suna.json when it names them, otherwise
 * from the defaults. Every service that touches a source of truth resolves
 * its path through here so a renamed manuscript/ or figures/ dir keeps working.
 */
export async function projectSubdir(dir: string, key: ProjectDirKey): Promise<string> {
  const fallback = DEFAULT_PROJECT_DIRS[key]
  try {
    const raw = await readFile(join(dir, 'suna.json'), 'utf8')
    const manifest = SunaProjectManifestSchema.parse(JSON.parse(raw))
    return join(dir, manifest.directories[key] ?? fallback)
  } catch {
    return join(dir, fallback)
  }
}

export async function manuscriptJsonPath(dir: string): Promise<string> {
  return join(await projectSubdir(dir, 'manuscript'), 'manuscript.json')
}

export async function commentsJsonPath(dir: string): Promise<string> {
  return join(await projectSubdir(dir, 'manuscript'), 'comments.json')
}

export async function revisionsJsonPath(dir: string): Promise<string> {
  return join(await projectSubdir(dir, 'manuscript'), 'revisions.json')
}

export async function figureDirPath(dir: string, figureId: string): Promise<string> {
  return join(await projectSubdir(dir, 'figures'), figureId)
}

/* ------------------------------------------------------------------ */
/* The document registry (ARCHITECTURE §4.2, ARCHITECTURE §4.2)                  */
/* ------------------------------------------------------------------ */

/**
 * The manifest's document registry, or the synthesized one-manuscript
 * registry when suna.json declares none. A project written before
 * the registry resolves to exactly the document it always had (ARCHITECTURE §4.2).
 */
export async function projectDocuments(dir: string): Promise<DocumentEntry[]> {
  try {
    const raw = await readFile(join(dir, 'suna.json'), 'utf8')
    return resolveDocuments(SunaProjectManifestSchema.parse(JSON.parse(raw)))
  } catch {
    return synthesizedRegistry()
  }
}

/** One registry entry by id, or null. */
export async function projectDocument(dir: string, documentId: string): Promise<DocumentEntry | null> {
  return (await projectDocuments(dir)).find((d) => d.id === documentId) ?? null
}

/** The project's primary document — always the manuscript. */
export async function projectPrimaryDocument(dir: string): Promise<DocumentEntry> {
  const docs = await projectDocuments(dir)
  return docs.find((d) => d.kind === 'manuscript') ?? docs[0]!
}

/**
 * The directory a document's files live in. Every editable document lives
 * under manuscript/ (ARCHITECTURE §4.2 decision 2), so this is the manuscript dir for
 * every kind; the nesting is in the entry's own `file`/`meta`.
 */
export async function documentDir(dir: string): Promise<string> {
  return projectSubdir(dir, 'manuscript')
}

/**
 * A document's prose or sidecar path.
 *
 * For the primary manuscript this returns byte-identically what
 * `manuscriptJsonPath` returns and what the prose resolution returns today —
 * the acceptance criterion that makes the registry a zero-file migration.
 */
export async function documentFile(
  dir: string,
  doc: DocumentEntry,
  role: 'prose' | 'meta',
  proseOverride?: string
): Promise<string | null> {
  const paths = documentPaths(await documentDir(dir), doc, proseOverride)
  return role === 'prose' ? paths.prose : paths.meta
}

/**
 * `rounds/` is fixed at the project root and is NOT a ProjectDirKey.
 *
 * `SunaProjectManifestSchema.directories` is an exhaustive record whose seven
 * keys every shipped suna.json lists, so widening PROJECT_DIR_KEYS would
 * invalidate every manifest on disk (ARCHITECTURE §4.2). These helpers exist anyway so
 * that this module's invariant — every service that touches a source of truth
 * resolves its path through here — stays literally true, even for the one
 * directory with nothing to look up.
 */
export function roundsDir(dir: string): string {
  return join(dir, 'rounds')
}

export function roundDir(dir: string, roundId: string): string {
  return join(roundsDir(dir), roundId)
}
