import { execFile } from 'node:child_process'
import { readdir, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import { assertInsideAllowedRoot } from './roots'

const run = promisify(execFile)
const MAX_BUFFER = 16 * 1024 * 1024
/** %x1f — unit separator; cannot appear in %s/%an, making it a safe field delimiter. */
const LOG_FORMAT = '%H%x1f%s%x1f%an%x1f%aI'
const LOG_SEP = '\u001f'

export type GitChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'

export interface GitChange {
  path: string
  status: GitChangeStatus
}

export interface GitStatusResult {
  isRepo: boolean
  branch: string | null
  changes: GitChange[]
}

export interface GitLogEntry {
  hash: string
  subject: string
  author: string
  date: string
}

/** Run git with cwd pinned to an allowed root; surface stderr in failures. */
async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: MAX_BUFFER })
    return stdout
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr
    const detail =
      typeof stderr === 'string' && stderr.trim() !== ''
        ? stderr.trim()
        : error instanceof Error
          ? error.message
          : String(error)
    throw new Error(`git ${args[0] ?? ''} failed: ${detail}`)
  }
}

/**
 * Status for `dir`, but only when `dir` IS the repository toplevel.
 * A project nested inside another repository (e.g. a folder inside a big
 * monorepo checkout) reports isRepo:false so we never operate on the outer repo.
 */
export async function gitStatus(dir: string): Promise<GitStatusResult> {
  const abs = assertInsideAllowedRoot(dir)
  const notARepo: GitStatusResult = { isRepo: false, branch: null, changes: [] }

  let toplevel: string
  try {
    toplevel = (await git(abs, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return notARepo
  }
  const [realTop, realDir] = await Promise.all([
    realpath(toplevel).catch(() => resolve(toplevel)),
    realpath(abs).catch(() => abs)
  ])
  if (realTop !== realDir) return notARepo

  const branch = (await git(abs, ['branch', '--show-current']).catch(() => '')).trim()
  const statusOut = await git(abs, ['status', '--porcelain=v1', '-z'])
  return {
    isRepo: true,
    branch: branch === '' ? null : branch,
    changes: parsePorcelainZ(statusOut)
  }
}

function parsePorcelainZ(out: string): GitChange[] {
  const changes: GitChange[] = []
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === undefined || token.length < 4) continue
    const x = token[0] ?? ' '
    const y = token[1] ?? ' '
    const path = token.slice(3)
    // In -z format a rename/copy entry is followed by a NUL-separated origin path.
    if (x === 'R' || x === 'C') i += 1
    if (x === '!') continue // ignored entries (only with --ignored)
    changes.push({ path, status: classifyStatus(x, y) })
  }
  return changes
}

function classifyStatus(x: string, y: string): GitChangeStatus {
  if (x === '?' || y === '?') return 'untracked'
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
    return 'conflicted'
  }
  if (x === 'R' || y === 'R') return 'renamed'
  if (x === 'A' || x === 'C') return 'added'
  if (x === 'D' || y === 'D') return 'deleted'
  return 'modified'
}

export async function gitLog(dir: string, limit: number): Promise<{ entries: GitLogEntry[] }> {
  const abs = assertInsideAllowedRoot(dir)
  let out: string
  try {
    out = await git(abs, ['log', '-n', String(limit), `--pretty=format:${LOG_FORMAT}`])
  } catch {
    // not a repo, or a repo with no commits yet
    return { entries: [] }
  }
  const entries: GitLogEntry[] = []
  for (const line of out.split('\n')) {
    if (!line.includes(LOG_SEP)) continue
    const [hash = '', subject = '', author = '', date = ''] = line.split(LOG_SEP)
    if (hash !== '') entries.push({ hash, subject, author, date })
  }
  return { entries }
}

export async function gitCommit(
  dir: string,
  message: string,
  stageAll: boolean
): Promise<{ hash: string }> {
  const abs = assertInsideAllowedRoot(dir)
  if (stageAll) await git(abs, ['add', '-A'])
  await git(abs, ['commit', '-m', message])
  const hash = (await git(abs, ['rev-parse', 'HEAD'])).trim()
  return { hash }
}

/** Unstaged plus staged diff for one file, so both edits and staged changes show. */
export async function gitDiffFile(dir: string, path: string): Promise<{ diff: string }> {
  const abs = assertInsideAllowedRoot(dir)
  if (isAbsolute(path)) assertInsideAllowedRoot(path)
  const staged = await git(abs, ['diff', '--cached', '--', path]).catch(() => '')
  const unstaged = await git(abs, ['diff', '--', path]).catch(() => '')
  return { diff: staged + unstaged }
}

/** git init -b main, plus an initial commit when the tree is non-empty (best-effort). */
export async function gitInit(dir: string): Promise<void> {
  const abs = assertInsideAllowedRoot(dir)
  await git(abs, ['init', '-b', 'main'])
  const entries = (await readdir(abs)).filter((name) => name !== '.git')
  if (entries.length === 0) return
  try {
    await git(abs, ['add', '-A'])
    await git(abs, ['commit', '-m', 'Initial commit'])
  } catch (error) {
    console.warn('git initial commit failed (repo initialized without one):', error)
  }
}
