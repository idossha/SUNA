import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runGit } from './git'
import { conflictedPaths } from './git-branch'
import { explainPushFailure, gitRemote, remoteEnv } from './git-remote'
import { assertInsideAllowedRoot } from './roots'

/* ---------------------------------------------------------------------------
   Fetch, pull, and the conflicted state in between.

   Nothing in the app fetched before this file existed, which made every
   "2 to push / 1 behind" count a reading of whatever the remote looked like
   the last time someone ran git in a terminal. A count nobody refreshes is
   worse than no count, so fetching is now both an explicit button and the
   thing the panel does quietly when it opens.
   --------------------------------------------------------------------------- */

export interface GitFetchResult {
  /** False when there is no remote to fetch from — not an error. */
  fetched: boolean
  ahead: number
  behind: number
  upstream: string | null
  /** Populated when the fetch failed; the counts are then the stale ones. */
  error: string | null
}

/**
 * Update remote-tracking refs, then re-read the drift.
 *
 * `--prune` matters for a manuscript repo: a co-author's merged branch that
 * was deleted on the server would otherwise linger in the timeline forever,
 * looking like work nobody finished.
 */
export async function gitFetch(dir: string): Promise<GitFetchResult> {
  const abs = assertInsideAllowedRoot(dir)
  const before = await gitRemote(abs)
  if (before.url === null) {
    return { fetched: false, ahead: before.ahead, behind: before.behind, upstream: null, error: null }
  }
  let error: string | null = null
  try {
    await runGit(abs, ['fetch', '--prune', 'origin'], await remoteEnv(before.url))
  } catch (err) {
    error = explainPushFailure(err instanceof Error ? err.message : String(err))
  }
  const after = await gitRemote(abs)
  return {
    fetched: error === null,
    ahead: after.ahead,
    behind: after.behind,
    upstream: after.upstream,
    error
  }
}

export type PullMode = 'rebase' | 'merge'

export interface GitPullResult {
  /** False when the pull stopped on conflicts — see `conflicted`. */
  clean: boolean
  /** True when there was nothing to bring down. */
  alreadyUpToDate: boolean
  mode: PullMode
  conflicted: string[]
  output: string
}

/**
 * Bring the remote's commits down.
 *
 * Rebase is the default because a manuscript's history is read by people, and
 * a merge commit per pull turns "what changed in the discussion" into a thing
 * you have to squint past. Merge stays available for anyone who wants the
 * exact record of when the branches met.
 *
 * A conflict is a result, not an exception: the working tree is now a valid
 * mid-pull state that the conflict panel resolves, and aborting it on the
 * user's behalf would throw away the incoming work they asked for.
 */
export async function gitPull(dir: string, mode: PullMode = 'rebase'): Promise<GitPullResult> {
  const abs = assertInsideAllowedRoot(dir)
  const info = await gitRemote(abs)
  if (info.url === null) throw new Error('This repository has no remote yet — add one first.')
  if (info.branch === null) throw new Error('HEAD is detached; check out a branch before pulling.')

  const args =
    info.upstream === null
      ? ['pull', mode === 'rebase' ? '--rebase' : '--no-rebase', 'origin', info.branch]
      : ['pull', mode === 'rebase' ? '--rebase' : '--no-rebase']

  try {
    const output = await runGit(abs, args, await remoteEnv(info.url))
    return {
      clean: true,
      alreadyUpToDate: /already up to date|current branch .* is up to date/i.test(output),
      mode,
      conflicted: [],
      output
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const conflicted = await conflictedPaths(abs)
    if (conflicted.length > 0) {
      return { clean: false, alreadyUpToDate: false, mode, conflicted, output: detail }
    }
    throw new Error(explainPullFailure(detail))
  }
}

/** Turn git's pull stderr into the one sentence that says what to do next. */
export function explainPullFailure(detail: string): string {
  const text = detail.trim()
  if (/would be overwritten by merge|local changes to the following files/i.test(text)) {
    return `Your uncommitted changes touch the same files as the incoming ones. Commit or discard them first, then pull again.\n\n${text}`
  }
  if (/refusing to merge unrelated histories/i.test(text)) {
    return `The remote's history has nothing in common with this one — usually a repository that was initialized separately on both sides.\n\n${text}`
  }
  if (/permission denied \(publickey|could not read from remote repository/i.test(text)) {
    return `Could not authenticate with the remote. Check the SSH or GitHub sign-in status below, then pull again.\n\n${text}`
  }
  return text
}

/* ---- the mid-operation state -------------------------------------------- */

export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'none'

export interface GitConflictState {
  operation: GitOperation
  paths: string[]
  /**
   * The branch or commit being brought in, when git recorded one — 'origin/main'
   * during a pull, a branch name during a merge.
   */
  incoming: string | null
}

/**
 * Which multi-step operation the repository is in the middle of, if any.
 *
 * Read from `.git`'s own marker files rather than parsed out of status text,
 * because those markers are what git itself branches on and they do not
 * change wording between versions or locales.
 */
export async function gitConflictState(dir: string): Promise<GitConflictState> {
  const abs = assertInsideAllowedRoot(dir)
  const gitDir = (await runGit(abs, ['rev-parse', '--git-dir']).catch(() => '')).trim()
  if (gitDir === '') return { operation: 'none', paths: [], incoming: null }
  const root = gitDir.startsWith('/') ? gitDir : join(abs, gitDir)

  const exists = async (name: string): Promise<boolean> =>
    readFile(join(root, name), 'utf8').then(
      () => true,
      () => false
    )
  const read = async (name: string): Promise<string | null> =>
    readFile(join(root, name), 'utf8').then(
      (text) => {
        const value = text.trim()
        return value === '' ? null : value
      },
      () => null
    )

  let operation: GitOperation = 'none'
  let incoming: string | null = null
  if ((await exists('rebase-merge/interactive')) || (await exists('rebase-merge/msgnum'))) {
    operation = 'rebase'
    incoming = await read('rebase-merge/head-name')
  } else if (await exists('rebase-apply/applying')) {
    operation = 'rebase'
  } else if (await exists('MERGE_HEAD')) {
    operation = 'merge'
    incoming = await read('MERGE_MSG')
  } else if (await exists('CHERRY_PICK_HEAD')) {
    operation = 'cherry-pick'
  } else if (await exists('REVERT_HEAD')) {
    operation = 'revert'
  }

  const paths = await conflictedPaths(abs)
  if (operation === 'none' && paths.length === 0) {
    return { operation: 'none', paths: [], incoming: null }
  }
  return {
    operation,
    paths,
    // 'refs/heads/main' → 'main'; a MERGE_MSG first line is already readable.
    incoming: incoming === null ? null : incoming.replace(/^refs\/heads\//, '').split('\n')[0] ?? null
  }
}

export type ConflictSide = 'ours' | 'theirs'

/**
 * Resolve one conflicted file by taking one side wholesale, then staging it.
 *
 * "Ours" and "theirs" invert during a rebase — the commits being replayed are
 * "theirs" even though they are yours — so the label the UI shows is derived
 * from the operation (see conflictLabels) rather than passed through raw.
 */
export async function gitResolveConflict(
  dir: string,
  path: string,
  side: ConflictSide
): Promise<void> {
  const abs = assertInsideAllowedRoot(dir)
  const { assertRepoPath } = await import('./git')
  const rel = assertRepoPath(abs, path)
  await runGit(abs, ['checkout', `--${side}`, '--', rel])
  await runGit(abs, ['add', '--', rel])
}

/** Mark a hand-edited file resolved: stage it as it now stands. */
export async function gitMarkResolved(dir: string, path: string): Promise<void> {
  const abs = assertInsideAllowedRoot(dir)
  const { assertRepoPath } = await import('./git')
  const rel = assertRepoPath(abs, path)
  const remaining = await readFile(join(abs, rel), 'utf8').catch(() => '')
  if (/^<{7} |^={7}$|^>{7} /m.test(remaining)) {
    throw new Error(
      'That file still has conflict markers (<<<<<<<, =======, >>>>>>>) in it. Remove them first, then mark it resolved.'
    )
  }
  await runGit(abs, ['add', '--', rel])
}

/**
 * Which side is whose, in words, for the operation actually running. During a
 * rebase git's "ours" is the upstream and "theirs" is your replayed work —
 * the reverse of a merge, and the single most common way people resolve a
 * conflict backwards.
 */
export function conflictLabels(operation: GitOperation): { ours: string; theirs: string } {
  if (operation === 'rebase') {
    return { ours: 'Incoming (from the remote)', theirs: 'Yours (being replayed)' }
  }
  return { ours: 'Yours (current branch)', theirs: 'Incoming' }
}

export interface ContinueResult {
  /** False when something still stands in the way. */
  done: boolean
  /** Conflicts not yet resolved. */
  paths: string[]
  /**
   * Files with unstaged edits that are blocking the continue even though they
   * have nothing to do with the conflict. Empty unless git refused for this
   * reason; see below for why it can.
   */
  blocked: string[]
  output: string
}

/**
 * Paths with working-tree edits that are not in the index.
 *
 * This is not the same question as "what is conflicted", and the difference is
 * the whole reason `blocked` exists: `git rebase --continue` calls
 * has_unstaged_changes() and refuses if ANY file in the tree has them, related
 * to the conflict or not. In SUNA that is the common case rather than the
 * exotic one, because opening a project can rewrite AGENTS.md underneath the
 * user — so a pull that conflicts would otherwise dead-end on git's own
 * "You must edit all merge conflicts", which is not even true.
 */
async function unstagedPaths(dir: string): Promise<string[]> {
  const out = await runGit(dir, ['diff', '--name-only', '-z']).catch(() => '')
  return out.split('\0').filter((path) => path !== '')
}

/**
 * Finish the operation once every conflict is staged.
 *
 * `setAside` deals with the unrelated-unstaged-edits case by stashing exactly
 * those paths, continuing, and putting them back. It is a separate argument
 * rather than automatic because moving someone's uncommitted work — even
 * reversibly — should be something they asked for.
 */
export async function gitContinue(dir: string, setAside = false): Promise<ContinueResult> {
  const abs = assertInsideAllowedRoot(dir)
  const state = await gitConflictState(abs)
  if (state.paths.length > 0) {
    return { done: false, paths: state.paths, blocked: [], output: '' }
  }

  const command =
    state.operation === 'rebase'
      ? ['rebase', '--continue']
      : state.operation === 'cherry-pick'
        ? ['cherry-pick', '--continue']
        : state.operation === 'revert'
          ? ['revert', '--continue']
          : ['commit', '--no-edit']

  // A merge finishes with a plain commit, which does not mind unstaged files.
  const fussy = state.operation === 'rebase' || state.operation === 'cherry-pick'
  const blocked = fussy ? await unstagedPaths(abs) : []
  if (blocked.length > 0 && !setAside) {
    return { done: false, paths: [], blocked, output: '' }
  }

  // git would open $EDITOR for the message; there is no editor here, and the
  // recorded message is the one git already wrote.
  const env = { GIT_EDITOR: 'true' }

  if (blocked.length === 0) {
    const output = await runGit(abs, command, env)
    return { done: true, paths: [], blocked: [], output }
  }

  // Stash ONLY the blocking paths, so the staged conflict resolution — which
  // is what the replayed commit is made of — is left exactly as it is.
  await runGit(abs, ['stash', 'push', '--quiet', '--', ...blocked])
  let output: string
  try {
    output = await runGit(abs, command, env)
  } catch (error) {
    // Put the work back before surfacing the failure; leaving it in a stash
    // the user never asked for is the one outcome worse than not continuing.
    await runGit(abs, ['stash', 'pop']).catch(() => undefined)
    throw error
  }
  try {
    await runGit(abs, ['stash', 'pop'])
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      done: true,
      paths: [],
      blocked: [],
      output: `${output}\n\nThe ${state.operation} finished, but your other edits could not be put back automatically — they are safe in the most recent stash (\`git stash list\`).\n\n${detail}`
    }
  }
  return { done: true, paths: [], blocked: [], output }
}

/** Undo the whole operation and put the repository back where it started. */
export async function gitAbort(dir: string): Promise<{ operation: GitOperation }> {
  const abs = assertInsideAllowedRoot(dir)
  const state = await gitConflictState(abs)
  if (state.operation === 'none') throw new Error('Nothing to abort.')
  const command =
    state.operation === 'rebase'
      ? ['rebase', '--abort']
      : state.operation === 'cherry-pick'
        ? ['cherry-pick', '--abort']
        : state.operation === 'revert'
          ? ['revert', '--abort']
          : ['merge', '--abort']
  await runGit(abs, command)
  return { operation: state.operation }
}
