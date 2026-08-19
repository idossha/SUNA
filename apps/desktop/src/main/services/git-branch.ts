import { runGit } from './git'
import { assertInsideAllowedRoot } from './roots'

/* ---------------------------------------------------------------------------
   Branches.

   A manuscript's branches are usually few and long-lived — "revision-2",
   "reviewer-3-response", a co-author's line of work — so this exposes the
   whole set rather than a search box, and reports each one's drift from its
   upstream so the panel can say which are behind before you switch to them.
   --------------------------------------------------------------------------- */

const SEP = '\u001f'

export interface GitBranch {
  name: string
  /** True for the checked-out branch. */
  current: boolean
  /** 'origin/main', or null when the branch tracks nothing. */
  upstream: string | null
  ahead: number
  behind: number
  /** Subject of the branch tip, for the switcher's second line. */
  subject: string
  /** ISO date of the branch tip. */
  date: string
  /** True for remote-tracking refs (origin/…) that have no local branch. */
  remote: boolean
}

export interface GitBranchesResult {
  current: string | null
  /** Local branches first, then remote-only ones. */
  branches: GitBranch[]
  /** True when HEAD is not on a branch. */
  detached: boolean
}

/**
 * `git for-each-ref` reports upstream drift as 'ahead 2, behind 1' (or
 * '[gone]', or empty). Parsed here rather than by two more git calls per
 * branch.
 */
export function parseTrackShort(text: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(text)
  const behind = /behind (\d+)/.exec(text)
  return {
    ahead: ahead === null ? 0 : Number.parseInt(ahead[1] ?? '0', 10) || 0,
    behind: behind === null ? 0 : Number.parseInt(behind[1] ?? '0', 10) || 0
  }
}

/** `%1f` is for-each-ref's escape for one raw byte — the same separator SEP is. */
const REF_FORMAT = [
  '%(refname:short)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(contents:subject)',
  '%(committerdate:iso-strict)'
].join('%1f')

/** Parse `for-each-ref` output into branches; `remote` marks refs/remotes. */
export function parseBranchRefs(out: string, remote: boolean): GitBranch[] {
  const branches: GitBranch[] = []
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue
    const [name = '', head = '', upstream = '', track = '', subject = '', date = ''] =
      line.split(SEP)
    if (name === '') continue
    // 'origin/HEAD' is a symbolic pointer, not a branch anyone checks out.
    if (remote && name.endsWith('/HEAD')) continue
    const { ahead, behind } = parseTrackShort(track)
    branches.push({
      name,
      current: head.trim() === '*',
      upstream: upstream === '' ? null : upstream,
      ahead,
      behind,
      subject,
      date,
      remote
    })
  }
  return branches
}

export async function gitBranches(dir: string): Promise<GitBranchesResult> {
  const abs = assertInsideAllowedRoot(dir)
  const read = async (ref: string): Promise<string> =>
    runGit(abs, ['for-each-ref', `--format=${REF_FORMAT}`, ref]).catch(() => '')

  const [localOut, remoteOut] = await Promise.all([
    read('refs/heads'),
    read('refs/remotes')
  ])
  const local = parseBranchRefs(localOut, false)
  const remoteOnly = parseBranchRefs(remoteOut, true).filter(
    // A remote branch already checked out locally is the same line of work;
    // showing both would double every row in the switcher.
    (branch) => !local.some((l) => l.upstream === branch.name)
  )

  const currentRaw = (await runGit(abs, ['branch', '--show-current']).catch(() => '')).trim()
  return {
    current: currentRaw === '' ? null : currentRaw,
    branches: [...local, ...remoteOnly],
    detached: currentRaw === ''
  }
}

/**
 * Branch names git accepts, minus the ones that would be read as options or
 * would collide with refspec syntax. `git check-ref-format` is the authority,
 * but a pre-check gives a sentence instead of a porcelain error.
 */
export function assertBranchName(name: string): string {
  const value = name.trim()
  if (value === '') throw new Error('Enter a branch name.')
  if (value.startsWith('-')) throw new Error('A branch name cannot start with "-".')
  if (/[\s~^:?*[\\]/.test(value)) {
    throw new Error('A branch name cannot contain spaces or any of  ~ ^ : ? * [ \\')
  }
  if (value.includes('..') || value.endsWith('/') || value.endsWith('.lock')) {
    throw new Error(`git will not accept that branch name: ${value}`)
  }
  return value
}

export interface SwitchResult {
  branch: string
  /** True when the branch was created by this call. */
  created: boolean
}

/**
 * Create a branch from HEAD and switch to it. Uncommitted work comes along,
 * which is git's own behaviour and the one that loses nothing.
 */
export async function gitCreateBranch(dir: string, name: string): Promise<SwitchResult> {
  const abs = assertInsideAllowedRoot(dir)
  const branch = assertBranchName(name)
  await runGit(abs, ['switch', '-c', branch])
  return { branch, created: true }
}

/**
 * Switch to an existing branch. A remote-only name ('origin/revision-2') is
 * checked out as a local branch tracking it — the thing the user meant, and
 * the thing that avoids a detached HEAD they would not know how to leave.
 */
export async function gitSwitchBranch(dir: string, name: string): Promise<SwitchResult> {
  const abs = assertInsideAllowedRoot(dir)
  const branch = assertBranchName(name)

  const isLocal = await runGit(abs, ['show-ref', '--verify', `refs/heads/${branch}`]).then(
    () => true,
    () => false
  )
  if (isLocal) {
    await runGit(abs, ['switch', branch])
    return { branch, created: false }
  }

  const slash = branch.indexOf('/')
  if (slash !== -1) {
    const localName = branch.slice(slash + 1)
    // `switch --track` both creates the local branch and sets its upstream.
    await runGit(abs, ['switch', '--track', '-c', localName, branch])
    return { branch: localName, created: true }
  }
  // `switch` alone will do git's own DWIM: create from origin/<name> if unique.
  await runGit(abs, ['switch', branch])
  return { branch, created: false }
}

/**
 * Delete a local branch. Refuses unmerged work unless `force` is set, which
 * the UI only offers after saying what is about to be lost.
 */
export async function gitDeleteBranch(
  dir: string,
  name: string,
  force: boolean
): Promise<{ branch: string }> {
  const abs = assertInsideAllowedRoot(dir)
  const branch = assertBranchName(name)
  const current = (await runGit(abs, ['branch', '--show-current']).catch(() => '')).trim()
  if (branch === current) {
    throw new Error(`${branch} is checked out — switch to another branch before deleting it.`)
  }
  try {
    await runGit(abs, ['branch', force ? '-D' : '-d', branch])
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (!force && /not fully merged/i.test(detail)) {
      throw new Error(
        `${branch} has commits that are on no other branch. Deleting it discards them for good.\n\n${detail}`
      )
    }
    throw error
  }
  return { branch }
}

export interface MergeResult {
  /** False when the merge stopped on conflicts; the repo is mid-merge. */
  clean: boolean
  conflicted: string[]
  output: string
}

/**
 * Merge another branch into the current one. A conflict is reported, not
 * thrown: the repository is in a legitimate state that the conflict panel
 * exists to resolve, and unwinding it silently would throw away the merge.
 */
export async function gitMergeBranch(dir: string, name: string): Promise<MergeResult> {
  const abs = assertInsideAllowedRoot(dir)
  const branch = assertBranchName(name)
  try {
    const output = await runGit(abs, ['merge', '--no-edit', branch])
    return { clean: true, conflicted: [], output }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const conflicted = await conflictedPaths(abs)
    if (conflicted.length === 0) throw error
    return { clean: false, conflicted, output: detail }
  }
}

/** Paths git reports as unmerged, via the index rather than porcelain text. */
export async function conflictedPaths(dir: string): Promise<string[]> {
  const out = await runGit(dir, ['diff', '--name-only', '--diff-filter=U', '-z']).catch(() => '')
  return out.split('\0').filter((path) => path !== '')
}
