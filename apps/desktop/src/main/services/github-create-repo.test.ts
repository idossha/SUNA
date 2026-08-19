import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/* ---------------------------------------------------------------------------
   "Create the repository on GitHub and point origin at it".

   GitHub itself is stubbed, but the git half is real: every case here runs
   against a genuine repository on disk and then reads back what `origin`
   actually became. That is the half that has bitten before — a repository
   created successfully but wired to a URL nothing can push to.
   --------------------------------------------------------------------------- */

vi.mock('./github-auth', () => ({
  githubHeaders: async (): Promise<Record<string, string> | null> =>
    signedIn
      ? {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer gho_secret',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      : null,
  githubToken: async (): Promise<string | null> => (signedIn ? 'gho_secret' : null)
}))

let signedIn = true

const { ghCreateRepo, githubOwners, explainCreateFailure } = await import('./github')
const { allowRoot } = await import('./roots')

const run = promisify(execFile)

let base: string

interface Reply {
  status?: number
  body: unknown
}

function stubFetch(routes: Record<string, Reply>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: unknown) => {
    const key = String(url)
    const reply = routes[key]
    if (reply === undefined) throw new Error(`unrouted fetch in test: ${key}`)
    const status = reply.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => reply.body
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** What GitHub returns for a created repository, in the fields we read. */
function repoBody(slug: string): Record<string, unknown> {
  const [owner, name] = slug.split('/')
  return {
    full_name: slug,
    html_url: `https://github.com/${slug}`,
    ssh_url: `git@github.com:${slug}.git`,
    clone_url: `https://github.com/${slug}.git`,
    owner: { login: owner },
    name
  }
}

/** A fresh repository with one commit, so `origin` has somewhere to be set. */
async function newRepo(label: string): Promise<string> {
  const dir = join(base, `${label}-${Math.abs(hash(label))}`)
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: dir })
  return dir
}

/** Deterministic per-label directory suffix; Math.random would flake. */
function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) | 0
  return value
}

async function originUrl(dir: string): Promise<string> {
  const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd: dir })
  return stdout.trim()
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'suna-ghcreate-'))
  allowRoot(base)
}, 30_000)

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  signedIn = true
})

describe('ghCreateRepo — the endpoint it uses', () => {
  it('creates under the signed-in account when no owner is given', async () => {
    const dir = await newRepo('user-repo')
    const fetchSpy = stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/quenching-paper') }
    })

    const res = await ghCreateRepo(dir, 'quenching-paper', 'private', null, null, false)
    expect(res.slug).toBe('ada/quenching-paper')
    expect(res.htmlUrl).toBe('https://github.com/ada/quenching-paper')

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.name).toBe('quenching-paper')
    expect(body.visibility).toBe('private')
    expect(body.private).toBe(true)
  }, 30_000)

  it('creates under an organization when one is chosen', async () => {
    const dir = await newRepo('org-repo')
    const fetchSpy = stubFetch({
      'https://api.github.com/orgs/cosmic-lab/repos': {
        status: 201,
        body: repoBody('cosmic-lab/quenching-paper')
      }
    })

    const res = await ghCreateRepo(dir, 'quenching-paper', 'private', 'cosmic-lab', null, false)
    expect(res.slug).toBe('cosmic-lab/quenching-paper')
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/orgs/cosmic-lab/repos')
  }, 30_000)

  it('marks a public repository as not private', async () => {
    const dir = await newRepo('public-repo')
    const fetchSpy = stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/open-paper') }
    })
    await ghCreateRepo(dir, 'open-paper', 'public', null, null, false)
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.private).toBe(false)
  }, 30_000)

  it('sends a description only when there is one', async () => {
    const dir = await newRepo('desc-repo')
    const fetchSpy = stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/desc-paper') }
    })
    await ghCreateRepo(dir, 'desc-paper', 'private', null, '  A manuscript  ', false)
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.description).toBe('A manuscript')

    const bare = await newRepo('nodesc-repo')
    const spy2 = stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/nodesc') }
    })
    await ghCreateRepo(bare, 'nodesc', 'private', null, '   ', false)
    expect(JSON.parse(String(spy2.mock.calls[0]?.[1]?.body))).not.toHaveProperty('description')
  }, 30_000)
})

describe('ghCreateRepo — what origin becomes', () => {
  it('stores the SSH URL by default, which needs no token at push time', async () => {
    const dir = await newRepo('ssh-remote')
    stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/ssh-paper') }
    })

    const res = await ghCreateRepo(dir, 'ssh-paper', 'private', null, null, false)
    expect(res.remoteUrl).toBe('git@github.com:ada/ssh-paper.git')
    expect(await originUrl(dir)).toBe('git@github.com:ada/ssh-paper.git')
  }, 30_000)

  it('stores the HTTPS URL when the signed-in credential will carry the push', async () => {
    const dir = await newRepo('https-remote')
    stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/https-paper') }
    })

    const res = await ghCreateRepo(dir, 'https-paper', 'private', null, null, true)
    expect(res.remoteUrl).toBe('https://github.com/ada/https-paper.git')
    expect(await originUrl(dir)).toBe('https://github.com/ada/https-paper.git')
  }, 30_000)

  /** A token must never be written into .git/config, where it outlives the session. */
  it('never puts a credential in the stored remote URL', async () => {
    const dir = await newRepo('clean-remote')
    stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/clean-paper') }
    })
    await ghCreateRepo(dir, 'clean-paper', 'private', null, null, true)
    const url = await originUrl(dir)
    expect(url).not.toContain('gho_secret')
    expect(url).not.toContain('@github.com/')
  }, 30_000)

  it('replaces an existing origin rather than failing on the second attempt', async () => {
    const dir = await newRepo('replace-remote')
    await run('git', ['remote', 'add', 'origin', 'git@github.com:ada/stale.git'], { cwd: dir })

    stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/fresh') }
    })
    await ghCreateRepo(dir, 'fresh', 'private', null, null, false)
    expect(await originUrl(dir)).toBe('git@github.com:ada/fresh.git')
  }, 30_000)

  /**
   * Creating must never push. The manuscript leaves the machine only when the
   * author says so — an empty repository is reversible, an uploaded draft is
   * not.
   */
  it('does not push, leaving the branch unpublished', async () => {
    const dir = await newRepo('nopush-remote')
    stubFetch({
      'https://api.github.com/user/repos': { status: 201, body: repoBody('ada/nopush') }
    })
    await ghCreateRepo(dir, 'nopush', 'private', null, null, false)

    const upstream = await run('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: dir })
      .then(() => 'set')
      .catch(() => 'none')
    expect(upstream).toBe('none')
  }, 30_000)
})

describe('ghCreateRepo — refusals that cost no network call', () => {
  it('rejects a name that could be read as a flag or a path', async () => {
    const dir = await newRepo('bad-names')
    const fetchSpy = stubFetch({})
    await expect(ghCreateRepo(dir, '--public', 'private', null, null, false)).rejects.toThrow(
      /repository name/
    )
    await expect(ghCreateRepo(dir, 'a/b', 'private', null, null, false)).rejects.toThrow(
      /repository name/
    )
    await expect(ghCreateRepo(dir, '', 'private', null, null, false)).rejects.toThrow(
      /repository name/
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  }, 30_000)

  it('rejects an owner GitHub could not name', async () => {
    const dir = await newRepo('bad-owner')
    stubFetch({})
    await expect(ghCreateRepo(dir, 'ok-name', 'private', 'bad owner', null, false)).rejects.toThrow(
      /valid GitHub account/
    )
  }, 30_000)

  it('explains internal visibility instead of letting GitHub 422', async () => {
    const dir = await newRepo('internal-nouser')
    const fetchSpy = stubFetch({})
    await expect(ghCreateRepo(dir, 'ok-name', 'internal', null, null, false)).rejects.toThrow(
      /organization/
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  }, 30_000)

  it('refuses a directory outside every open project', async () => {
    stubFetch({})
    await expect(
      ghCreateRepo('/nowhere-at-all', 'name', 'private', null, null, false)
    ).rejects.toThrow(/outside any open project/)
  })

  it('says to sign in when nobody is', async () => {
    const dir = await newRepo('signed-out')
    signedIn = false
    const fetchSpy = stubFetch({})
    await expect(ghCreateRepo(dir, 'ok-name', 'private', null, null, false)).rejects.toThrow(
      /Not signed in/i
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  }, 30_000)
})

describe('ghCreateRepo — GitHub refusals', () => {
  it('names a name collision and what to do about it', async () => {
    const dir = await newRepo('collision')
    stubFetch({
      'https://api.github.com/user/repos': {
        status: 422,
        body: {
          message: 'Repository creation failed.',
          errors: [{ message: 'name already exists on this account' }]
        }
      }
    })
    await expect(ghCreateRepo(dir, 'taken', 'private', null, null, false)).rejects.toThrow(
      /already exists on that account/
    )
  }, 30_000)

  it('leaves origin alone when creation failed', async () => {
    const dir = await newRepo('failed-no-remote')
    stubFetch({
      'https://api.github.com/user/repos': { status: 403, body: { message: 'Forbidden' } }
    })
    await expect(ghCreateRepo(dir, 'denied', 'private', null, null, false)).rejects.toThrow()
    await expect(originUrl(dir)).rejects.toThrow()
  }, 30_000)

  it('reports an unreachable network as such', async () => {
    const dir = await newRepo('offline')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND api.github.com')
      })
    )
    await expect(ghCreateRepo(dir, 'offline-paper', 'private', null, null, false)).rejects.toThrow(
      /Could not reach GitHub/
    )
  }, 30_000)

  it('does not claim success when GitHub answers 201 with an unusable body', async () => {
    const dir = await newRepo('weird-body')
    stubFetch({ 'https://api.github.com/user/repos': { status: 201, body: {} } })
    await expect(ghCreateRepo(dir, 'weird', 'private', null, null, false)).rejects.toThrow(
      /unexpected response/i
    )
  }, 30_000)
})

describe('githubOwners', () => {
  it('lists the account first, then the organizations it can publish into', async () => {
    stubFetch({
      'https://api.github.com/user': { body: { login: 'ada', avatar_url: 'https://a/ada.png' } },
      'https://api.github.com/user/orgs?per_page=100': {
        body: [
          { login: 'cosmic-lab', avatar_url: 'https://a/lab.png' },
          { login: 'obs-collab', avatar_url: null }
        ]
      }
    })

    const { owners } = await githubOwners()
    expect(owners.map((o) => [o.login, o.kind])).toEqual([
      ['ada', 'user'],
      ['cosmic-lab', 'org'],
      ['obs-collab', 'org']
    ])
  })

  /** Without read:org the orgs call 403s; the user can still publish to themselves. */
  it('still returns the account when organizations cannot be read', async () => {
    stubFetch({
      'https://api.github.com/user': { body: { login: 'ada' } },
      'https://api.github.com/user/orgs?per_page=100': { status: 403, body: { message: 'no' } }
    })
    const { owners } = await githubOwners()
    expect(owners).toEqual([{ login: 'ada', kind: 'user', avatarUrl: null }])
  })

  it('requires a sign-in', async () => {
    signedIn = false
    stubFetch({})
    await expect(githubOwners()).rejects.toThrow(/Not signed in/i)
  })
})

describe('explainCreateFailure', () => {
  it('separates the four causes a user can act on', () => {
    expect(explainCreateFailure(401, { message: 'Bad credentials' })).toMatch(/sign out and in/i)
    expect(explainCreateFailure(403, { message: 'Forbidden' })).toMatch(/not allowed to create/)
    expect(explainCreateFailure(404, { message: 'Not Found' })).toMatch(/no such organization/)
    expect(
      explainCreateFailure(422, { errors: [{ message: 'name already exists' }] })
    ).toMatch(/already exists on that account/)
  })

  it('still says something when GitHub sends nothing', () => {
    expect(explainCreateFailure(500, {})).toMatch(/HTTP 500/)
  })
})
