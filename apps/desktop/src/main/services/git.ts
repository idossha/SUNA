import { execFile } from 'node:child_process'
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
  /**
   * The index and the working tree, separately — the same split VS Code and
   * GitHub Desktop show. One path can appear in BOTH (staged edit, then edited
   * again), which is exactly why a single merged list could not express it.
   */
  staged: GitChange[]
  unstaged: GitChange[]
}

export interface GitLogEntry {
  hash: string
  subject: string
  author: string
  date: string
}

/**
 * Run git with cwd pinned to an allowed root; surface stderr in failures.
 * `env` is merged over the inherited environment (see git-remote.ts, which
 * uses it to keep credential prompts from hanging a windowless process).
 */
export async function runGit(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<string> {
  try {
    const { stdout } = await run('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      env: env === undefined ? process.env : { ...process.env, ...env }
    })
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
  const notARepo: GitStatusResult = { isRepo: false, branch: null, staged: [], unstaged: [] }

  let toplevel: string
  try {
    toplevel = (await runGit(abs, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return notARepo
  }
  const [realTop, realDir] = await Promise.all([
    realpath(toplevel).catch(() => resolve(toplevel)),
    realpath(abs).catch(() => abs)
  ])
  if (realTop !== realDir) return notARepo

  const branch = (await runGit(abs, ['branch', '--show-current']).catch(() => '')).trim()
  const statusOut = await runGit(abs, ['status', '--porcelain=v1', '-z'])
  const { staged, unstaged } = parsePorcelainZ(statusOut)
  return { isRepo: true, branch: branch === '' ? null : branch, staged, unstaged }
}

/**
 * Split `git status --porcelain=v1 -z` into index-side and worktree-side
 * entries. Column X is the index, column Y the working tree; `??` is
 * untracked, and the conflict pairs (UU/AA/DD/AU/UA/DU/UD) are neither —
 * they are one unresolved thing, listed once on the worktree side.
 */
export function parsePorcelainZ(out: string): { staged: GitChange[]; unstaged: GitChange[] } {
  const staged: GitChange[] = []
  const unstaged: GitChange[] = []
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
    if (x === '?' || y === '?') {
      unstaged.push({ path, status: 'untracked' })
      continue
    }
    if (isConflict(x, y)) {
      unstaged.push({ path, status: 'conflicted' })
      continue
    }
    if (x !== ' ') staged.push({ path, status: classifyLetter(x) })
    if (y !== ' ') unstaged.push({ path, status: classifyLetter(y) })
  }
  return { staged, unstaged }
}

function isConflict(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

/** One porcelain column letter, for one side of the change. */
function classifyLetter(letter: string): GitChangeStatus {
  if (letter === '?') return 'untracked'
  if (letter === 'U') return 'conflicted'
  if (letter === 'R') return 'renamed'
  if (letter === 'A' || letter === 'C') return 'added'
  if (letter === 'D') return 'deleted'
  return 'modified'
}

export async function gitLog(dir: string, limit: number): Promise<{ entries: GitLogEntry[] }> {
  const abs = assertInsideAllowedRoot(dir)
  let out: string
  try {
    out = await runGit(abs, ['log', '-n', String(limit), `--pretty=format:${LOG_FORMAT}`])
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

/**
 * Commit the index. `amend` replaces the previous commit instead of adding
 * one — the fix for a message typed too fast, and safe exactly while that
 * commit has not been pushed, which is why the UI only offers it then.
 */
export async function gitCommit(
  dir: string,
  message: string,
  stageAll: boolean,
  amend = false
): Promise<{ hash: string }> {
  const abs = assertInsideAllowedRoot(dir)
  if (stageAll) await runGit(abs, ['add', '-A'])
  await runGit(abs, ['commit', ...(amend ? ['--amend'] : []), '-m', message])
  const hash = (await runGit(abs, ['rev-parse', 'HEAD'])).trim()
  return { hash }
}

export interface UndoCommitResult {
  /** Subject of the commit that was undone, to name it in the confirmation. */
  subject: string
  /** True when the undone commit was already on the remote. */
  wasPushed: boolean
}

/**
 * Take the last commit apart, leaving its changes staged.
 *
 * `reset --soft` touches no file in the working tree, so this is recoverable
 * in the only sense that matters: nothing the user wrote is lost, and
 * committing again puts it back. It is refused once the commit is on the
 * remote, where undoing it locally only creates a divergence the next push
 * cannot resolve.
 */
export async function gitUndoCommit(dir: string): Promise<UndoCommitResult> {
  const abs = assertInsideAllowedRoot(dir)
  const subject = (await runGit(abs, ['log', '-1', '--pretty=format:%s']).catch(() => '')).trim()
  const head = (await runGit(abs, ['rev-parse', 'HEAD'])).trim()

  // Reachable from any remote-tracking ref means the server has it.
  const remoteContains = (
    await runGit(abs, ['branch', '--remotes', '--contains', head]).catch(() => '')
  ).trim()
  if (remoteContains !== '') {
    throw new Error(
      'That commit is already on the remote, so undoing it here would put this copy out of step with everyone else’s. Make a new commit that changes it back instead.'
    )
  }

  const parents = (await runGit(abs, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' ')
  if (parents.length < 2) {
    // The very first commit has no parent to reset onto.
    await runGit(abs, ['update-ref', '-d', 'HEAD'])
    return { subject, wasPushed: false }
  }
  await runGit(abs, ['reset', '--soft', 'HEAD~1'])
  return { subject, wasPushed: false }
}

/** The last commit's message, for pre-filling an amend. */
export async function gitLastCommitMessage(dir: string): Promise<{ message: string }> {
  const abs = assertInsideAllowedRoot(dir)
  const message = await runGit(abs, ['log', '-1', '--pretty=format:%B']).catch(() => '')
  return { message: message.replace(/\n+$/, '') }
}

export type DiffSide = 'staged' | 'unstaged' | 'both'

/**
 * The diff for one file, on the side the user clicked. The index and the
 * working tree are genuinely different diffs — showing their concatenation
 * (what this did before staging existed) would misreport a file that is
 * staged and then edited again.
 */
export async function gitDiffFile(
  dir: string,
  path: string,
  side: DiffSide = 'both'
): Promise<{ diff: string }> {
  const abs = assertInsideAllowedRoot(dir)
  const rel = assertRepoPath(abs, path)
  const staged =
    side === 'unstaged' ? '' : await runGit(abs, ['diff', '--cached', '--', rel]).catch(() => '')
  let unstaged =
    side === 'staged' ? '' : await runGit(abs, ['diff', '--', rel]).catch(() => '')
  // An untracked file has no diff at all; show it as wholly added, as VS Code
  // does, rather than the blank panel git's own `diff` would produce.
  if (unstaged === '' && staged === '' && side !== 'staged') {
    unstaged = await diffAgainstNothing(abs, rel)
  }
  return { diff: staged + unstaged }
}

/**
 * `git diff --no-index` exits 1 *because* the files differ, and the diff we
 * want is on stdout of that "failure" — so this calls execFile directly
 * rather than runGit, which turns a non-zero exit into an error and drops the
 * output with it.
 */
async function diffAgainstNothing(cwd: string, rel: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['diff', '--no-index', '--', '/dev/null', rel], {
      cwd,
      maxBuffer: MAX_BUFFER
    })
    return stdout
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout
    return typeof stdout === 'string' ? stdout : ''
  }
}

/**
 * Validate one path the renderer wants to act on and return it repo-relative.
 * Two things are refused: anything that resolves outside the project (a
 * `../../` escape), and anything git would read as an option — every call site
 * also passes `--`, but a leading dash should never get that far.
 */
export function assertRepoPath(repoDir: string, path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') throw new Error('empty path')
  if (trimmed.startsWith('-')) throw new Error(`path may not start with "-": ${path}`)
  const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(repoDir, trimmed)
  assertInsideAllowedRoot(abs)
  const root = resolve(repoDir)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path is outside the repository: ${path}`)
  }
  const rel = relative(root, abs)
  return rel === '' ? '.' : rel
}

function repoPaths(dir: string, paths: string[]): { abs: string; rels: string[] } {
  const abs = assertInsideAllowedRoot(dir)
  if (paths.length === 0) throw new Error('no paths given')
  return { abs, rels: paths.map((path) => assertRepoPath(abs, path)) }
}

/** Stage exactly these paths (`git add`), tracked or not, deletions included. */
export async function gitStage(dir: string, paths: string[]): Promise<void> {
  const { abs, rels } = repoPaths(dir, paths)
  await runGit(abs, ['add', '--', ...rels])
}

/**
 * Unstage exactly these paths, leaving the working tree untouched.
 * Before the first commit there is no HEAD to reset against, so a file staged
 * into an empty index is removed from it with `rm --cached` instead.
 */
export async function gitUnstage(dir: string, paths: string[]): Promise<void> {
  const { abs, rels } = repoPaths(dir, paths)
  const hasCommits = await runGit(abs, ['rev-parse', '--verify', 'HEAD']).then(
    () => true,
    () => false
  )
  if (hasCommits) await runGit(abs, ['reset', '-q', 'HEAD', '--', ...rels])
  else await runGit(abs, ['rm', '-q', '--cached', '-r', '--', ...rels])
}

/* ---- hunk-level staging -------------------------------------------------- */

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` line, as git wrote it. */
  header: string
  /** Header line plus its body — a patch body, minus the file header. */
  text: string
}

export interface ParsedDiff {
  /** Everything before the first `@@`: `diff --git`, index, ---/+++ lines. */
  fileHeader: string
  hunks: DiffHunk[]
}

/**
 * Split one file's unified diff into its file header and its hunks, so a
 * single hunk can be re-emitted as a patch of its own. This is what makes
 * partial staging possible without a diff library: `git apply` will take a
 * patch consisting of the original header and any subset of its hunks.
 *
 * Only the FIRST file's diff is parsed — every caller asks for one path.
 */
export function parseDiffHunks(diff: string): ParsedDiff {
  const lines = diff.split('\n')
  const header: string[] = []
  const hunks: DiffHunk[] = []
  let current: string[] | null = null

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current !== null) hunks.push(toHunk(current))
      current = [line]
      continue
    }
    if (current === null) {
      if (line !== '') header.push(line)
      continue
    }
    // A second file's header ends this file's diff; we only ever ask for one.
    if (line.startsWith('diff --git ')) break
    current.push(line)
  }
  if (current !== null) hunks.push(toHunk(current))
  return { fileHeader: header.length === 0 ? '' : `${header.join('\n')}\n`, hunks }
}

function toHunk(lines: string[]): DiffHunk {
  // Trailing blank lines belong to no hunk; git apply rejects a patch that
  // ends in a stray empty context line.
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return { header: lines[0] ?? '', text: `${lines.join('\n')}\n` }
}

export type HunkAction = 'stage' | 'unstage' | 'discard'

/**
 * Apply exactly one hunk of one file, the way VS Code's "Stage selected
 * ranges" does: re-diff the file NOW, take hunk `index` of that fresh diff,
 * and hand git a patch containing only it.
 *
 * Re-diffing rather than trusting a patch from the renderer matters twice
 * over: the renderer never gets to hand the main process arbitrary patch text,
 * and a hunk index that no longer exists (the file moved on since the view
 * rendered) fails loudly instead of applying somewhere unintended.
 */
export async function gitApplyHunk(
  dir: string,
  path: string,
  index: number,
  action: HunkAction
): Promise<void> {
  const abs = assertInsideAllowedRoot(dir)
  const rel = assertRepoPath(abs, path)
  const side: DiffSide = action === 'unstage' ? 'staged' : 'unstaged'
  const { diff } = await gitDiffFile(abs, rel, side)
  const parsed = parseDiffHunks(diff)
  const hunk = parsed.hunks[index]
  if (hunk === undefined || parsed.fileHeader === '') {
    throw new Error('That change is no longer there — the file moved on. Refreshing.')
  }

  // stage: add to the index. unstage: reverse it out of the index.
  // discard: reverse it out of the working tree.
  const args = ['apply', '--unidiff-zero']
  if (action !== 'discard') args.push('--cached')
  if (action !== 'stage') args.push('--reverse')

  const patch = `${parsed.fileHeader}${hunk.text}`
  const file = join(await mkdtemp(join(tmpdir(), 'suna-hunk-')), 'hunk.patch')
  try {
    await writeFile(file, patch, 'utf8')
    await runGit(abs, [...args, '--', file])
  } finally {
    await rm(dirname(file), { recursive: true, force: true }).catch(() => undefined)
  }
}

export interface DiscardResult {
  /** Paths whose working-tree changes were thrown away. */
  reverted: string[]
  /** Untracked paths deleted from disk. */
  deleted: string[]
}

/**
 * Throw away working-tree changes for these paths — the one destructive
 * operation in this file. Tracked files are restored from the index (so a
 * staged version survives, as in VS Code); untracked files are deleted, which
 * is unrecoverable and therefore only happens when `deleteUntracked` is set by
 * a caller that has confirmed it with the user.
 */
export async function gitDiscard(
  dir: string,
  paths: string[],
  deleteUntracked: boolean
): Promise<DiscardResult> {
  const { abs, rels } = repoPaths(dir, paths)
  const status = await gitStatus(abs)
  const untracked = new Set(
    status.unstaged.filter((c) => c.status === 'untracked').map((c) => c.path)
  )
  const toDelete = rels.filter((rel) => untracked.has(rel))
  const toRevert = rels.filter((rel) => !untracked.has(rel))

  if (toRevert.length > 0) await runGit(abs, ['restore', '--worktree', '--', ...toRevert])
  if (toDelete.length > 0 && deleteUntracked) {
    await runGit(abs, ['clean', '-q', '-f', '-d', '--', ...toDelete])
  }
  return { reverted: toRevert, deleted: deleteUntracked ? toDelete : [] }
}

export interface GitInitResult {
  /** False when the tree was empty, or when the first commit failed. */
  committed: boolean
  /** Why the first commit did not happen; the repo exists either way. */
  warning: string | null
}

/**
 * git init -b main, plus an initial commit when the tree is non-empty.
 * The commit is best-effort — it fails when git has no user.name/user.email —
 * but the reason is returned rather than only logged, because that is exactly
 * the case the UI has to explain to a first-time user.
 */
export async function gitInit(dir: string): Promise<GitInitResult> {
  const abs = assertInsideAllowedRoot(dir)
  await runGit(abs, ['init', '-b', 'main'])
  const entries = (await readdir(abs)).filter((name) => name !== '.git')
  if (entries.length === 0) return { committed: false, warning: null }
  try {
    await runGit(abs, ['add', '-A'])
    await runGit(abs, ['commit', '-m', 'Initial commit'])
    return { committed: true, warning: null }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn('git initial commit failed (repo initialized without one):', error)
    return { committed: false, warning: explainCommitFailure(detail) }
  }
}

/** Name the fixable cause of a failed commit; git identity is the usual one. */
export function explainCommitFailure(detail: string): string {
  if (/please tell me who you are|empty ident name|unable to auto-detect email/i.test(detail)) {
    return `git does not know who you are yet, so it could not record the commit. Set your identity (see SSH setup below), then commit again.\n\n${detail.trim()}`
  }
  return detail.trim()
}
