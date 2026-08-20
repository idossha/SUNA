import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  VersionArchiveSchema,
  LoggedVersionSchema,
  emptyVersionArchive,
  formatVersionId,
  workingVersion,
  VERSION_AREAS,
  type VersionArea,
  type LoggedVersion,
  type VersionArchive
} from '@suna/core'
import { writeFileAtomic } from './atomic'
import { projectSubdir } from './paths'

/**
 * Logged versions on disk (see packages/core/src/versions.ts for the model).
 *
 * "Log version" copies the manuscript end-to-end — every file under
 * `manuscript/` except the archive itself — plus the work behind it: `code/`,
 * `analysis/` and `figures/`. Each area lands in its own subdirectory of
 * `manuscript/archive/v<stage>.<minor>/`, every copy is hashed, and the whole
 * thing is recorded in `manuscript/archive/index.json`.
 *
 * A copy rather than a git tag on purpose: the tree is routinely dirty when a
 * draft goes out, so `git show` cannot answer "what did they actually read",
 * and the archive has to be readable by someone who never opens this app.
 */

/** The archive directory is fixed under the manuscript dir, wherever that is. */
export async function archiveDir(rootDir: string): Promise<string> {
  return join(await projectSubdir(rootDir, 'manuscript'), 'archive')
}

export async function versionDir(rootDir: string, versionId: string): Promise<string> {
  return join(await archiveDir(rootDir), versionId)
}

async function indexPath(rootDir: string): Promise<string> {
  return join(await archiveDir(rootDir), 'index.json')
}

export async function readVersionArchive(rootDir: string): Promise<VersionArchive> {
  try {
    const raw = await readFile(await indexPath(rootDir), 'utf8')
    return VersionArchiveSchema.parse(JSON.parse(raw))
  } catch {
    return emptyVersionArchive()
  }
}

export async function listVersions(rootDir: string): Promise<LoggedVersion[]> {
  return (await readVersionArchive(rootDir)).versions
}

const IGNORED = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  '__pycache__',
  '.venv',
  '.ipynb_checkpoints',
  '.mypy_cache',
  '.pytest_cache'
])

/**
 * Every file under one area directory, area-relative, with `archive/` and the
 * usual build/VCS noise pruned. Paths use forward slashes so what is recorded
 * reads the same on every platform.
 */
async function collectFiles(dir: string, base: string): Promise<string[]> {
  const out: string[] = []
  let entries: string[]
  try {
    entries = await readdir(dir, { encoding: 'utf8' })
  } catch {
    return out
  }
  for (const name of entries.sort()) {
    const full = join(dir, name)
    const rel = relative(base, full).split(sep).join('/')
    if (rel === 'archive' || rel.startsWith('archive/')) continue
    if (IGNORED.has(name)) continue
    const info = await stat(full).catch(() => null)
    if (info === null) continue
    if (info.isDirectory()) out.push(...(await collectFiles(full, base)))
    else if (info.isFile()) out.push(rel)
  }
  return out
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export interface LogVersionInput {
  rootDir: string
  /**
   * Which stage this version belongs to. Omitted means "the stage we are
   * already in" — the common case, since most logs are another draft rather
   * than a submission.
   */
  stage?: number
  note?: string
  createdAt?: string
}

export async function logVersion(input: LogVersionInput): Promise<LoggedVersion> {
  const { rootDir } = input
  const manuscriptDir = await projectSubdir(rootDir, 'manuscript')
  const archive = await readVersionArchive(rootDir)
  const number = workingVersion(archive.versions, input.stage)
  const id = formatVersionId(number)
  if (archive.versions.some((v) => v.id === id)) {
    throw new Error(`version ${id} is already logged`)
  }

  const areaDirs = new Map<VersionArea, string>()
  for (const area of VERSION_AREAS) {
    areaDirs.set(area, area === 'manuscript' ? manuscriptDir : await projectSubdir(rootDir, area))
  }

  const files: string[] = []
  const areas: VersionArea[] = []
  const sources: string[] = []
  for (const area of VERSION_AREAS) {
    const dir = areaDirs.get(area)!
    const found = await collectFiles(dir, dir)
    if (found.length === 0) continue
    areas.push(area)
    for (const rel of found) {
      files.push(`${area}/${rel}`)
      sources.push(join(dir, ...rel.split('/')))
    }
  }
  if (files.length === 0) throw new Error('nothing to log: the project has no manuscript files')

  const target = join(await archiveDir(rootDir), id)
  const hashes: string[] = []
  for (const [i, rel] of files.entries()) {
    const dest = join(target, ...rel.split('/'))
    await mkdir(join(dest, '..'), { recursive: true })
    await copyFile(sources[i]!, dest)
    hashes.push(await sha256(dest))
  }

  const version = LoggedVersionSchema.parse({
    schemaVersion: 2,
    id,
    stage: number.stage,
    minor: number.minor,
    createdAt: input.createdAt ?? new Date().toISOString(),
    note: input.note ?? '',
    areas,
    files,
    hashes
  })

  // The record lands twice: beside the copy, so a folder read on its own is
  // self-describing, and in the index the app reads.
  await writeFileAtomic(join(target, 'version.json'), `${JSON.stringify(version, null, 2)}\n`)
  await writeFileAtomic(
    await indexPath(rootDir),
    `${JSON.stringify(
      VersionArchiveSchema.parse({ ...archive, versions: [...archive.versions, version] }),
      null,
      2
    )}\n`
  )
  return version
}

/**
 * Read one file out of a logged version. Read-only by construction: there is
 * no write counterpart anywhere in the app, and the relative path is checked
 * so a caller cannot climb out of the version directory.
 */
export async function readVersionFile(
  rootDir: string,
  versionId: string,
  relPath: string
): Promise<string> {
  const dir = await versionDir(rootDir, versionId)
  const parts = relPath.split('/')
  // Rejected by segment as well as by the resolved path: `a/../b` resolves
  // back inside and is harmless, but a caller writing it is confused about
  // what this function is for.
  if (parts.some((p) => p === '..' || p === '')) {
    throw new Error(`path escapes version ${versionId}`)
  }
  const full = join(dir, ...parts)
  const rel = relative(dir, full)
  if (rel.startsWith('..') || rel === '') throw new Error(`path escapes version ${versionId}`)
  return readFile(full, 'utf8')
}
