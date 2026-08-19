import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gitCommit, gitStatus, gitUndoCommit } from './git'
import { conflictedPaths } from './git-branch'
import {
  conflictLabels,
  explainPullFailure,
  gitAbort,
  gitConflictState,
  gitContinue,
  gitFetch,
  gitMarkResolved,
  gitPull,
  gitResolveConflict
} from './git-sync'
import { allowRoot } from './roots'

const run = promisify(execFile)

/**
 * A real bare "server" with two clones of it — the only way to exercise
 * fetch, pull and a genuine merge conflict, none of which can be faked
 * convincingly enough to be worth asserting on.
 */
let base: string
let server: string
let alice: string
let bob: string

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd })
  return stdout
}

/** Identity and a fixed branch name, so the tests do not read global config. */
async function configure(dir: string): Promise<void> {
  await git(dir, 'config', 'user.name', 'Test')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await git(dir, 'config', 'commit.gpgsign', 'false')
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'suna-sync-'))
  allowRoot(base)
  server = join(base, 'server.git')
  alice = join(base, 'alice')
  bob = join(base, 'bob')

  await run('git', ['init', '--bare', '-b', 'main', server])

  await run('git', ['clone', server, alice])
  await configure(alice)
  await writeFile(join(alice, 'paper.md'), 'line one\n', 'utf8')
  await git(alice, 'add', '-A')
  await git(alice, 'commit', '-m', 'First')
  await git(alice, 'push', '-u', 'origin', 'main')

  await run('git', ['clone', server, bob])
  await configure(bob)
}, 60_000)

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('gitFetch', () => {
  it('reports no remote as a fact, not a failure', async () => {
    const solo = join(base, 'solo')
    await run('git', ['init', '-b', 'main', solo])
    const res = await gitFetch(solo)
    expect(res.fetched).toBe(false)
    expect(res.error).toBeNull()
  })

  it('turns a stale behind-count into a current one', async () => {
    // Alice publishes something Bob has never heard of.
    await writeFile(join(alice, 'paper.md'), 'line one\nline two\n', 'utf8')
    await git(alice, 'commit', '-am', 'Second')
    await git(alice, 'push')

    // Before fetching, Bob's clone still believes it is in step.
    const bobRemoteBefore = await gitFetch(bob)
    expect(bobRemoteBefore.fetched).toBe(true)
    expect(bobRemoteBefore.behind).toBe(1)
    expect(bobRemoteBefore.upstream).toBe('origin/main')
  }, 30_000)
})

describe('gitPull', () => {
  it('brings the commits down and leaves the tree clean', async () => {
    const res = await gitPull(bob, 'rebase')
    expect(res.clean).toBe(true)
    expect(res.conflicted).toEqual([])
    expect(await readFile(join(bob, 'paper.md'), 'utf8')).toContain('line two')

    const after = await gitFetch(bob)
    expect(after.behind).toBe(0)
  }, 30_000)

  it('says so when there was nothing to bring down', async () => {
    const res = await gitPull(bob, 'rebase')
    expect(res.clean).toBe(true)
    expect(res.alreadyUpToDate).toBe(true)
  }, 30_000)
})

describe('a real conflict', () => {
  /**
   * Both authors edit the same line and Alice pushes first — the ordinary way
   * two people writing one paragraph collide.
   */
  it('stops the pull, names the file, and reports the operation', async () => {
    await writeFile(join(alice, 'paper.md'), 'line one\nALICE edit\n', 'utf8')
    await git(alice, 'commit', '-am', 'Alice edits line two')
    await git(alice, 'push')

    await writeFile(join(bob, 'paper.md'), 'line one\nBOB edit\n', 'utf8')
    await git(bob, 'commit', '-am', 'Bob edits line two')

    const res = await gitPull(bob, 'rebase')
    expect(res.clean).toBe(false)
    expect(res.conflicted).toContain('paper.md')

    const state = await gitConflictState(bob)
    expect(state.operation).toBe('rebase')
    expect(state.paths).toContain('paper.md')
  }, 30_000)

  it('refuses to continue while a file still has conflict markers', async () => {
    const res = await gitContinue(bob)
    expect(res.done).toBe(false)
    expect(res.paths).toContain('paper.md')
  })

  it('refuses to mark a file resolved while the markers are still in it', async () => {
    await expect(gitMarkResolved(bob, 'paper.md')).rejects.toThrow(/conflict markers/)
  })

  it('resolves by taking one side, then finishes the rebase', async () => {
    // During a REBASE, 'theirs' is the work being replayed — Bob's own.
    await gitResolveConflict(bob, 'paper.md', 'theirs')
    expect(await conflictedPaths(bob)).toEqual([])

    const res = await gitContinue(bob)
    expect(res.done).toBe(true)

    const state = await gitConflictState(bob)
    expect(state.operation).toBe('none')
    expect(await readFile(join(bob, 'paper.md'), 'utf8')).toContain('BOB edit')
  }, 30_000)

  /**
   * The bug this pins, found by driving the real app: `git rebase --continue`
   * calls has_unstaged_changes() and refuses if ANY file in the tree has
   * them — then reports "You must edit all merge conflicts", which is not what
   * is wrong. SUNA hits this constantly because opening a project can rewrite
   * AGENTS.md underneath the user.
   */
  it('reports unrelated unstaged edits instead of relaying git’s wrong reason', async () => {
    await writeFile(join(alice, 'paper.md'), 'line one\nALICE third\n', 'utf8')
    await git(alice, 'commit', '-am', 'Alice third')
    await git(alice, 'push')

    await writeFile(join(bob, 'paper.md'), 'line one\nBOB third\n', 'utf8')
    await git(bob, 'commit', '-am', 'Bob third')

    const pull = await gitPull(bob, 'rebase')
    expect(pull.clean).toBe(false)
    await gitResolveConflict(bob, 'paper.md', 'theirs')

    // An unrelated file the app touched while the rebase was parked.
    await writeFile(join(bob, 'unrelated.md'), 'written by the app\n', 'utf8')
    await git(bob, 'add', 'unrelated.md')
    await git(bob, 'commit', '-m', 'Track unrelated')
    await writeFile(join(bob, 'unrelated.md'), 'rewritten by the app\n', 'utf8')

    const blockedRun = await gitContinue(bob)
    expect(blockedRun.done).toBe(false)
    expect(blockedRun.paths).toEqual([])
    expect(blockedRun.blocked).toContain('unrelated.md')
  }, 30_000)

  it('sets the blocking edits aside, finishes, and hands them straight back', async () => {
    const res = await gitContinue(bob, true)
    expect(res.done).toBe(true)

    const state = await gitConflictState(bob)
    expect(state.operation).toBe('none')

    // The unrelated edit is back in the working tree, and NOT in the commit.
    expect(await readFile(join(bob, 'unrelated.md'), 'utf8')).toBe('rewritten by the app\n')
    const lastCommit = await git(bob, 'show', '--name-only', '--format=', 'HEAD')
    expect(lastCommit).not.toContain('unrelated.md')
  }, 30_000)

  it('can be called off instead, putting the repository back', async () => {
    // Set up a second collision, then abort it.
    await writeFile(join(alice, 'paper.md'), 'line one\nALICE again\n', 'utf8')
    await git(alice, 'commit', '-am', 'Alice again')
    await git(alice, 'push')

    await writeFile(join(bob, 'paper.md'), 'line one\nBOB again\n', 'utf8')
    await git(bob, 'commit', '-am', 'Bob again')
    const head = (await git(bob, 'rev-parse', 'HEAD')).trim()

    const pull = await gitPull(bob, 'rebase')
    expect(pull.clean).toBe(false)

    await gitAbort(bob)
    const state = await gitConflictState(bob)
    expect(state.operation).toBe('none')
    expect((await git(bob, 'rev-parse', 'HEAD')).trim()).toBe(head)
  }, 30_000)

  it('has nothing to abort once the repository is settled', async () => {
    await expect(gitAbort(alice)).rejects.toThrow(/Nothing to abort/)
  })
})

describe('conflictLabels', () => {
  /**
   * The inversion this guards is the reason the UI never says "ours": during
   * a rebase git's "ours" is the upstream, not you.
   */
  it('swaps the sides between a merge and a rebase', () => {
    expect(conflictLabels('merge').ours).toMatch(/current branch/)
    expect(conflictLabels('rebase').ours).toMatch(/remote/i)
    expect(conflictLabels('rebase').theirs).toMatch(/Yours/)
  })
})

describe('explainPullFailure', () => {
  it('names uncommitted work as the fixable cause', () => {
    expect(explainPullFailure('error: Your local changes to the following files')).toMatch(
      /Commit or discard them first/
    )
  })

  it('names unrelated histories', () => {
    expect(explainPullFailure('fatal: refusing to merge unrelated histories')).toMatch(
      /nothing in common/
    )
  })

  it('passes an unrecognized failure through', () => {
    expect(explainPullFailure('  something odd  ')).toBe('something odd')
  })
})

describe('gitUndoCommit', () => {
  it('refuses once the commit is on the remote', async () => {
    await expect(gitUndoCommit(alice)).rejects.toThrow(/already on the remote/)
  })

  it('takes an unpushed commit apart and leaves its changes staged', async () => {
    await writeFile(join(alice, 'notes.md'), 'a note\n', 'utf8')
    await gitCommit(alice, 'A local-only commit', true)

    const res = await gitUndoCommit(alice)
    expect(res.subject).toBe('A local-only commit')

    const status = await gitStatus(alice)
    expect(status.staged.map((c) => c.path)).toContain('notes.md')
    // Nothing on disk was touched — that is what makes this recoverable.
    expect(await readFile(join(alice, 'notes.md'), 'utf8')).toBe('a note\n')
  }, 30_000)
})
