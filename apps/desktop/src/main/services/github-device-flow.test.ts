import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* ---------------------------------------------------------------------------
   The GitHub sign-in, driven end to end against a stubbed GitHub.

   This is the critical path for every GitHub feature in the app — creating the
   repository, publishing a manuscript, pushing over HTTPS — and it is the one
   path that cannot be exercised by hand in CI. So every documented outcome of
   the device flow gets a case here: the happy one, the four error codes
   GitHub defines, the rate-limit backoff, and the machine with no keychain.
   --------------------------------------------------------------------------- */

/** Encrypted-store stand-in, so no test touches the real OS keychain. */
const store = new Map<string, string>()
let keychainWorks = true

vi.mock('./agent-keys', () => ({
  setSecret: async (slot: string, value: string): Promise<void> => {
    if (!keychainWorks) throw new Error('secure key storage is not available on this system')
    if (value === '') store.delete(slot)
    else store.set(slot, value)
  },
  getSecret: async (slot: string): Promise<string | null> => store.get(slot) ?? null,
  hasSecret: async (slot: string): Promise<boolean> => store.has(slot)
}))

const {
  githubAccount,
  githubSession,
  githubSignOut,
  githubToken,
  pollDeviceFlow,
  startDeviceFlow
} = await import('./github-auth')

const DEVICE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'

interface Reply {
  status?: number
  body: unknown
  headers?: Record<string, string>
}

/** Route stubbed responses by URL; anything unrouted is a test bug, not a 404. */
function stubFetch(routes: Record<string, Reply | (() => Reply)>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: unknown) => {
    const key = String(url)
    const entry = routes[key]
    if (entry === undefined) throw new Error(`unrouted fetch in test: ${key}`)
    const reply = typeof entry === 'function' ? entry() : entry
    const status = reply.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => reply.headers?.[name.toLowerCase()] ?? null },
      json: async () => reply.body
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const ACCOUNT_BODY = {
  login: 'ada',
  name: 'Ada Researcher',
  avatar_url: 'https://avatars.example/ada.png',
  html_url: 'https://github.com/ada'
}

const REPO_SCOPE = { 'x-oauth-scopes': 'repo, read:org' }

beforeEach(async () => {
  process.env['SUNA_GITHUB_CLIENT_ID'] = 'Iv1.testclient'
  store.clear()
  keychainWorks = true
  await githubSignOut()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env['SUNA_GITHUB_CLIENT_ID']
})

describe('startDeviceFlow', () => {
  it('asks GitHub for a code and returns what the user has to see', async () => {
    const fetchSpy = stubFetch({
      [DEVICE_URL]: {
        body: {
          device_code: 'dev-code-1',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        }
      }
    })

    const res = await startDeviceFlow()
    expect(res.userCode).toBe('WDJB-MJHT')
    expect(res.verificationUri).toBe('https://github.com/login/device')
    expect(res.deviceCode).toBe('dev-code-1')
    expect(res.expiresIn).toBe(900)
    expect(res.interval).toBe(5)

    // The client id goes up; a client SECRET must never appear — the whole
    // reason this flow was chosen is that a desktop app cannot hold one.
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.client_id).toBe('Iv1.testclient')
    expect(body).not.toHaveProperty('client_secret')
    expect(body.scope).toContain('repo')
  })

  it('falls back to the documented verification URL when GitHub omits it', async () => {
    stubFetch({
      [DEVICE_URL]: { body: { device_code: 'd', user_code: 'ABCD-1234' } }
    })
    const res = await startDeviceFlow()
    expect(res.verificationUri).toBe('https://github.com/login/device')
    expect(res.expiresIn).toBe(900)
    expect(res.interval).toBe(5)
  })

  it('refuses before any request when the build has no client id', async () => {
    process.env['SUNA_GITHUB_CLIENT_ID'] = ''
    const fetchSpy = stubFetch({})
    await expect(startDeviceFlow()).rejects.toThrow(/no GitHub OAuth App configured/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  /**
   * What github.com/login/device/code really answers for a client id it has
   * never issued, verified against the live endpoint: HTTP 404 with
   * {"error":"Not Found"}. Left unmapped it reads as "GitHub refused the
   * sign-in (Not Found)" — the likeliest misconfiguration there is, described
   * in the least useful way available.
   */
  it('names an unrecognized client id, which GitHub reports only as "Not Found"', async () => {
    stubFetch({ [DEVICE_URL]: { status: 404, body: { error: 'Not Found' } } })
    await expect(startDeviceFlow()).rejects.toThrow(/does not recognize SUNA's OAuth client ID/)
  })

  it('names the setting to change when Device Flow is switched off on the app', async () => {
    stubFetch({
      [DEVICE_URL]: { status: 400, body: { error: 'device_flow_disabled' } }
    })
    await expect(startDeviceFlow()).rejects.toThrow(/Device Flow enabled/i)
  })

  it('says GitHub is unreachable rather than leaking a fetch stack', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND github.com')
      })
    )
    await expect(startDeviceFlow()).rejects.toThrow(/Could not reach GitHub/)
  })
})

describe('pollDeviceFlow', () => {
  it('reports a user who has not finished yet, keeping the interval', async () => {
    stubFetch({ [TOKEN_URL]: { body: { error: 'authorization_pending' } } })
    const res = await pollDeviceFlow('dev-code-1', 5)
    expect(res.status).toBe('pending')
    expect(res.interval).toBe(5)
    expect(res.account).toBeNull()
  })

  /**
   * GitHub rate-limits this endpoint hard, and its documented remedy is to add
   * five seconds. Polling on unchanged timing gets the whole flow blocked.
   */
  it('backs off when GitHub says slow_down', async () => {
    stubFetch({ [TOKEN_URL]: { body: { error: 'slow_down' } } })
    const res = await pollDeviceFlow('dev-code-1', 5)
    expect(res.status).toBe('pending')
    expect(res.interval).toBe(10)
  })

  it('honours an explicit interval from GitHub over the +5 default', async () => {
    stubFetch({ [TOKEN_URL]: { body: { error: 'slow_down', interval: 27 } } })
    expect((await pollDeviceFlow('dev-code-1', 5)).interval).toBe(27)
  })

  it('ends the flow when the code expires, and says to start again', async () => {
    stubFetch({ [TOKEN_URL]: { body: { error: 'expired_token' } } })
    const res = await pollDeviceFlow('dev-code-1', 5)
    expect(res.status).toBe('expired')
    expect(res.message).toMatch(/start again/i)
  })

  it('ends the flow when the user cancels on GitHub', async () => {
    stubFetch({ [TOKEN_URL]: { body: { error: 'access_denied' } } })
    const res = await pollDeviceFlow('dev-code-1', 5)
    expect(res.status).toBe('denied')
    expect(res.message).toMatch(/cancelled/i)
  })

  it('stores the token and returns the account once GitHub says yes', async () => {
    stubFetch({
      [TOKEN_URL]: { body: { access_token: 'gho_secret' } },
      [USER_URL]: { body: ACCOUNT_BODY, headers: REPO_SCOPE }
    })

    const res = await pollDeviceFlow('dev-code-1', 5)
    expect(res.status).toBe('authorized')
    expect(res.persisted).toBe(true)
    expect(res.message).toBeNull()
    expect(res.account?.login).toBe('ada')
    expect(res.account?.name).toBe('Ada Researcher')
    expect(res.account?.scopes).toContain('repo')
    expect(await githubToken()).toBe('gho_secret')
  })

  /**
   * A bare Linux session has no keyring. Signing in still has to work for the
   * session — silently failing, or refusing outright, are both worse than
   * saying it will not survive a restart.
   */
  it('still signs in when the keychain refuses, and warns that it will not persist', async () => {
    keychainWorks = false
    stubFetch({
      [TOKEN_URL]: { body: { access_token: 'gho_secret' } },
      [USER_URL]: { body: ACCOUNT_BODY, headers: REPO_SCOPE }
    })

    const res = await pollDeviceFlow('dev-code-1', 5)
    expect(res.status).toBe('authorized')
    expect(res.persisted).toBe(false)
    expect(res.message).toMatch(/sign in again next time/i)
    expect(await githubToken()).toBe('gho_secret')
  })

  it('treats a reply with neither token nor error as a failure, not a sign-in', async () => {
    stubFetch({ [TOKEN_URL]: { status: 200, body: {} } })
    await expect(pollDeviceFlow('dev-code-1', 5)).rejects.toThrow(/no access token/i)
  })

  it('surfaces an unrecognized error code rather than looping forever', async () => {
    stubFetch({
      [TOKEN_URL]: { body: { error: 'unsupported_grant_type', error_description: 'nope' } }
    })
    await expect(pollDeviceFlow('dev-code-1', 5)).rejects.toThrow(/unsupported_grant_type/)
  })
})

describe('githubSession', () => {
  async function signIn(headers: Record<string, string> = REPO_SCOPE): Promise<void> {
    stubFetch({
      [TOKEN_URL]: { body: { access_token: 'gho_secret' } },
      [USER_URL]: { body: ACCOUNT_BODY, headers }
    })
    await pollDeviceFlow('dev-code-1', 5)
  }

  it('reports a signed-out machine with no message to apologize for', async () => {
    stubFetch({})
    const session = await githubSession()
    expect(session.configured).toBe(true)
    expect(session.signedIn).toBe(false)
    expect(session.account).toBeNull()
    expect(session.message).toBeNull()
  })

  it('reports the signed-in account', async () => {
    await signIn()
    stubFetch({ [USER_URL]: { body: ACCOUNT_BODY, headers: REPO_SCOPE } })
    const session = await githubSession()
    expect(session.signedIn).toBe(true)
    expect(session.needsReauth).toBe(false)
    expect(session.account?.login).toBe('ada')
    expect(session.account?.avatarUrl).toBe('https://avatars.example/ada.png')
  })

  /**
   * A token without `repo` can read the account but cannot create or push,
   * which would otherwise surface as a 403 halfway through publishing.
   */
  it('flags a sign-in that cannot create or push', async () => {
    await signIn({ 'x-oauth-scopes': 'read:user' })
    stubFetch({ [USER_URL]: { body: ACCOUNT_BODY, headers: { 'x-oauth-scopes': 'read:user' } } })
    const session = await githubSession()
    expect(session.signedIn).toBe(true)
    expect(session.needsReauth).toBe(true)
    expect(session.message).toMatch(/repo/)
  })

  it('treats a revoked token as signed out rather than as an error', async () => {
    await signIn()
    stubFetch({ [USER_URL]: { status: 401, body: { message: 'Bad credentials' } } })
    const session = await githubSession()
    expect(session.signedIn).toBe(false)
    expect(session.needsReauth).toBe(true)
    expect(session.message).toMatch(/sign in again/i)
  })

  it('forgets the token on sign-out', async () => {
    await signIn()
    expect(await githubToken()).toBe('gho_secret')
    await githubSignOut()
    expect(await githubToken()).toBeNull()

    stubFetch({})
    expect((await githubSession()).signedIn).toBe(false)
  })
})

describe('githubAccount', () => {
  it('returns null without a token instead of calling GitHub', async () => {
    const fetchSpy = stubFetch({})
    expect(await githubAccount()).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends the token as a bearer credential on the versioned API', async () => {
    stubFetch({
      [TOKEN_URL]: { body: { access_token: 'gho_secret' } },
      [USER_URL]: { body: ACCOUNT_BODY, headers: REPO_SCOPE }
    })
    await pollDeviceFlow('dev-code-1', 5)

    const fetchSpy = stubFetch({ [USER_URL]: { body: ACCOUNT_BODY, headers: REPO_SCOPE } })
    await githubAccount()
    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer gho_secret')
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28')
  })

  it('reports an account with no display name as null rather than empty string', async () => {
    stubFetch({
      [TOKEN_URL]: { body: { access_token: 'gho_secret' } },
      [USER_URL]: { body: { ...ACCOUNT_BODY, name: '', avatar_url: '' }, headers: REPO_SCOPE }
    })
    const res = await pollDeviceFlow('dev-code-1', 5)
    expect(res.account?.name).toBeNull()
    expect(res.account?.avatarUrl).toBeNull()
  })
})
