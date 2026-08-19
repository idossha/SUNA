import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gitInit } from './git'
import {
  explainPushFailure,
  gitCheckRemote,
  gitPush,
  gitRemote,
  gitSetRemote,
  parseRemoteUrl,
  toSshUrl
} from './git-remote'
import { allowRoot } from './roots'

const run = promisify(execFile)

describe('parseRemoteUrl', () => {
  it('reads the scp-like SSH form', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toEqual({
      protocol: 'ssh',
      host: 'github.com',
      path: 'owner/repo.git'
    })
  })

  it('appends .git to a path that lacks it', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo').path).toBe('owner/repo.git')
  })

  it('reads ssh:// urls with a port', () => {
    expect(parseRemoteUrl('ssh://git@example.org:2222/team/paper.git')).toEqual({
      protocol: 'ssh',
      host: 'example.org',
      path: 'team/paper.git'
    })
  })

  it('classifies https without mistaking it for the scp form', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo')).toEqual({
      protocol: 'https',
      host: 'github.com',
      path: 'owner/repo.git'
    })
  })

  it('rejects things git cannot clone from', () => {
    expect(parseRemoteUrl('').protocol).toBe('other')
    expect(parseRemoteUrl('not a url').protocol).toBe('other')
  })
})

describe('toSshUrl', () => {
  it('converts https to the scp-like form', () => {
    expect(toSshUrl('https://github.com/owner/repo')).toBe('git@github.com:owner/repo.git')
  })

  it('leaves an already-ssh url in ssh form', () => {
    expect(toSshUrl('git@github.com:owner/repo.git')).toBe('git@github.com:owner/repo.git')
  })

  it('returns null for a url it cannot classify', () => {
    expect(toSshUrl('nonsense')).toBeNull()
  })
})

describe('explainPushFailure', () => {
  it('points a publickey rejection at the SSH setup steps', () => {
    const out = explainPushFailure('git@github.com: Permission denied (publickey).')
    expect(out).toMatch(/SSH could not authenticate/)
    expect(out).toContain('Permission denied (publickey)')
  })

  it('tells an HTTPS credential prompt to switch to SSH', () => {
    expect(explainPushFailure('could not read Username for https://github.com')).toMatch(
      /Switch it to SSH/
    )
  })

  it('passes an unrecognized failure through untouched', () => {
    expect(explainPushFailure('  boom  ')).toBe('boom')
  })
})

/**
 * A bare repo on disk stands in for a hosting account: it exercises the real
 * `git push`/upstream plumbing without a network or a key.
 */
describe('remote round trip', () => {
  let base: string
  let work: string
  let bare: string

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'suna-git-remote-'))
    work = join(base, 'project')
    bare = join(base, 'origin.git')
    allowRoot(work)
    await run('mkdir', ['-p', work])
    await run('git', ['init', '--bare', '-b', 'main', bare])
    await writeFile(join(work, 'paper.md'), '# Title\n', 'utf8')
    await gitInit(work)
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: work })
    await run('git', ['config', 'user.name', 'Test'], { cwd: work })
    // gitInit's first commit may have been skipped if git had no identity.
    await run('git', ['commit', '--allow-empty', '-m', 'Ensure a commit'], { cwd: work })
  })

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('reports no remote before one is set', async () => {
    const info = await gitRemote(work)
    expect(info.url).toBeNull()
    expect(info.hasCommits).toBe(true)
    expect(info.branch).toBe('main')
  })

  it('rewrites an https url to ssh by default', async () => {
    const res = await gitSetRemote(work, 'https://github.com/owner/repo', false)
    expect(res).toEqual({ url: 'git@github.com:owner/repo.git', protocol: 'ssh', converted: true })
    expect((await gitRemote(work)).protocol).toBe('ssh')
  })

  it('keeps https when the caller opts in', async () => {
    const res = await gitSetRemote(work, 'https://github.com/owner/repo.git', true)
    expect(res.converted).toBe(false)
    const info = await gitRemote(work)
    expect(info.protocol).toBe('https')
    expect(info.sshUrl).toBe('git@github.com:owner/repo.git')
  })

  it('refuses a url that could be read as a git flag', async () => {
    await expect(gitSetRemote(work, '--upload-pack=evil', false)).rejects.toThrow(/cannot start/)
  })

  it('pushes, sets upstream, and then reports being up to date', async () => {
    await gitSetRemote(work, bare, true)
    const first = await gitPush(work)
    expect(first).toMatchObject({ branch: 'main', remote: 'origin', setUpstream: true })

    const after = await gitRemote(work)
    expect(after.upstream).toBe('origin/main')
    expect(after.ahead).toBe(0)

    await writeFile(join(work, 'paper.md'), '# Title\n\nMore.\n', 'utf8')
    await run('git', ['commit', '-am', 'Extend'], { cwd: work })
    expect((await gitRemote(work)).ahead).toBe(1)

    const second = await gitPush(work)
    expect(second.setUpstream).toBe(false)
    expect((await gitRemote(work)).ahead).toBe(0)
  })

  it('reports a bare repo on disk as reachable', async () => {
    await gitSetRemote(work, bare, true)
    const res = await gitCheckRemote(work)
    expect(res).toMatchObject({ reachable: true, missing: false })
  })

  it('flags a remote whose repository does not exist as missing, not unreachable', async () => {
    const gone = join(base, 'never-created.git')
    await gitSetRemote(work, gone, true)
    const res = await gitCheckRemote(work)
    expect(res.reachable).toBe(false)
    expect(res.missing).toBe(true)
    // Restore the working remote for any later test in this file.
    await gitSetRemote(work, bare, true)
  })

  it('exposes owner/name as a slug for hosted remotes only', async () => {
    await gitSetRemote(work, 'git@github.com:owner/repo.git', false)
    expect((await gitRemote(work)).slug).toBe('owner/repo')
    await gitSetRemote(work, bare, true)
    expect((await gitRemote(work)).slug).toBeNull()
  })

  it('refuses to push a repository with no remote', async () => {
    const other = join(base, 'lonely')
    allowRoot(other)
    await run('mkdir', ['-p', other])
    await writeFile(join(other, 'a.md'), 'a\n', 'utf8')
    await gitInit(other)
    await expect(gitPush(other)).rejects.toThrow(/no remote/)
  })
})
