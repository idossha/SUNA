import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gitInit, gitStatus } from './git'
import { gitPush, gitRemote, gitSetRemote } from './git-remote'
import { gitFetch } from './git-sync'
import { allowRoot } from './roots'

/* ---------------------------------------------------------------------------
   New project → repository → remote → published.

   The whole chain the wizard's "publish" substep and Source Control's
   "Publish branch" button run, against a real bare repository standing in for
   GitHub. Everything here is genuine git: if this passes, the only untested
   link between a new manuscript and a backed-up one is GitHub's own API,
   which github-create-repo.test.ts covers against a stub.
   --------------------------------------------------------------------------- */

const run = promisify(execFile)

let base: string
let counter = 0

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd })
  return stdout
}

/** A bare repository standing in for the one GitHub would have created. */
async function newBareRemote(label: string): Promise<string> {
  const dir = join(base, `${label}.git`)
  await run('git', ['init', '--bare', '-b', 'main', dir])
  return dir
}

/** A project folder shaped like the scaffold's output, not yet a repository. */
async function newProject(label: string): Promise<string> {
  counter += 1
  const dir = join(base, `${label}-${counter}`)
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  await writeFile(join(dir, 'suna.json'), '{"name":"paper"}\n', 'utf8')
  await writeFile(join(dir, 'manuscript', 'manuscript.md'), '# Title\n', 'utf8')
  return dir
}

/** git needs an identity to commit; never read the machine's global config. */
async function identify(dir: string): Promise<void> {
  await git(dir, 'config', 'user.name', 'Ada Researcher')
  await git(dir, 'config', 'user.email', 'ada@observatory.edu')
  await git(dir, 'config', 'commit.gpgsign', 'false')
}

/**
 * Leave `dir` a repository with at least one commit and a clean tree.
 *
 * `gitInit` already commits when the machine has a global git identity and
 * does not when it has none — a difference between developer laptops and bare
 * CI that would otherwise decide whether these tests pass. So this asserts the
 * end state instead of assuming which half ran.
 */
async function ensureCommitted(dir: string): Promise<void> {
  await identify(dir)
  const status = await git(dir, 'status', '--porcelain')
  const hasCommits = await git(dir, 'rev-parse', '--verify', 'HEAD').then(
    () => true,
    () => false
  )
  if (status.trim() === '' && hasCommits) return
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-m', 'Initialize SUNA project')
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'suna-publish-'))
  allowRoot(base)
}, 30_000)

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('the publish chain', () => {
  it('carries a brand-new project all the way onto the remote', async () => {
    const dir = await newProject('fresh')
    const remote = await newBareRemote('fresh-remote')

    // 1. git init — what the scaffold does, and what Source Control offers.
    const init = await gitInit(dir)
    expect(init.warning === null || init.committed).toBe(true)
    await ensureCommitted(dir)

    const status = await gitStatus(dir)
    expect(status.isRepo).toBe(true)
    expect(status.branch).toBe('main')

    // 2. Point origin at the "created" repository.
    const set = await gitSetRemote(dir, remote, true)
    expect(set.url).toBe(remote)

    // Before publishing, the branch tracks nothing — this is exactly the
    // state the panel renders as "Publish" rather than "Push".
    const before = await gitRemote(dir)
    expect(before.url).toBe(remote)
    expect(before.upstream).toBeNull()
    expect(before.hasCommits).toBe(true)

    // 3. Publish.
    const push = await gitPush(dir)
    expect(push.branch).toBe('main')
    expect(push.setUpstream).toBe(true)

    // 4. The remote genuinely has it.
    const remoteLog = await git(remote, 'log', '--oneline', 'main')
    expect(remoteLog.trim().split('\n')).toHaveLength(1)

    const after = await gitRemote(dir)
    expect(after.upstream).toBe('origin/main')
    expect(after.ahead).toBe(0)
    expect(after.behind).toBe(0)
  }, 60_000)

  it('pushes again without re-setting the upstream', async () => {
    const dir = await newProject('second-push')
    const remote = await newBareRemote('second-remote')
    await gitInit(dir)
    await ensureCommitted(dir)
    await gitSetRemote(dir, remote, true)
    await gitPush(dir)

    await writeFile(join(dir, 'manuscript', 'manuscript.md'), '# Title\n\nMore.\n', 'utf8')
    await git(dir, 'commit', '-am', 'Expand the introduction')

    // One commit ahead — the number the sync trail shows on "commits to push".
    const ahead = await gitRemote(dir)
    expect(ahead.ahead).toBe(1)
    expect(ahead.upstream).toBe('origin/main')

    const push = await gitPush(dir)
    expect(push.setUpstream).toBe(false)
    expect((await gitRemote(dir)).ahead).toBe(0)
    expect((await git(remote, 'log', '--oneline', 'main')).trim().split('\n')).toHaveLength(2)
  }, 60_000)

  it('reports a co-author’s commits as behind once fetched', async () => {
    const dir = await newProject('behind')
    const remote = await newBareRemote('behind-remote')
    await gitInit(dir)
    await ensureCommitted(dir)
    await gitSetRemote(dir, remote, true)
    await gitPush(dir)

    // A co-author pushes from their own clone.
    const other = join(base, 'behind-coauthor')
    await run('git', ['clone', remote, other])
    await identify(other)
    await writeFile(join(other, 'manuscript', 'manuscript.md'), '# Title\n\nTheirs.\n', 'utf8')
    await git(other, 'commit', '-am', 'A co-author edit')
    await git(other, 'push')

    const fetched = await gitFetch(dir)
    expect(fetched.fetched).toBe(true)
    expect(fetched.behind).toBe(1)
    expect(fetched.ahead).toBe(0)
  }, 60_000)
})

describe('the publish chain refuses clearly', () => {
  it('will not push a repository with no remote', async () => {
    const dir = await newProject('no-remote')
    await gitInit(dir)
    await ensureCommitted(dir)
    await expect(gitPush(dir)).rejects.toThrow(/no remote yet/i)
  }, 30_000)

  it('will not push a repository with no commits', async () => {
    const dir = join(base, `empty-${(counter += 1)}`)
    await mkdir(dir, { recursive: true })
    await gitInit(dir)
    await gitSetRemote(dir, await newBareRemote('empty-remote'), true)
    await expect(gitPush(dir)).rejects.toThrow(/commit first/i)
  }, 30_000)

  it('refuses a URL git could not use, before recording it', async () => {
    const dir = await newProject('bad-url')
    await gitInit(dir)
    await expect(gitSetRemote(dir, 'not a url', false)).rejects.toThrow(/cannot contain spaces/)
    await expect(gitSetRemote(dir, '--upload-pack=evil', false)).rejects.toThrow(/cannot start/)
    await expect(gitSetRemote(dir, 'ftp://example.com/repo', false)).rejects.toThrow(
      /git cannot use that URL/
    )
    await expect(gitRemote(dir).then((r) => r.url)).resolves.toBeNull()
  }, 30_000)

  /**
   * An HTTPS remote with nobody signed in cannot authenticate from a
   * windowless app, so it is stored in SSH form instead — the transport that
   * works without a prompt.
   */
  it('rewrites an HTTPS URL to SSH unless the caller allows HTTPS', async () => {
    const dir = await newProject('https-rewrite')
    await gitInit(dir)

    const converted = await gitSetRemote(dir, 'https://github.com/ada/paper', false)
    expect(converted.converted).toBe(true)
    expect(converted.url).toBe('git@github.com:ada/paper.git')

    const kept = await gitSetRemote(dir, 'https://github.com/ada/paper', true)
    expect(kept.converted).toBe(false)
    expect(kept.url).toBe('https://github.com/ada/paper')
  }, 30_000)

  it('accepts a plain filesystem path as a remote, needing no credentials at all', async () => {
    const dir = await newProject('local-remote')
    const remote = await newBareRemote('local-backup')
    await gitInit(dir)
    await ensureCommitted(dir)

    const set = await gitSetRemote(dir, remote, false)
    expect(set.url).toBe(remote)
    await gitPush(dir)
    expect((await git(remote, 'log', '--oneline', 'main')).trim()).not.toBe('')
  }, 60_000)
})
