import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_PROJECT_DIRS, SunaProjectManifestSchema, type ProjectDirKey } from '@suna/core'

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
