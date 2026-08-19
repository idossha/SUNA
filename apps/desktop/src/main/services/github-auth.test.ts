import { afterEach, describe, expect, it } from 'vitest'
import { githubClientId, githubConfigured, githubSession } from './github-auth'

const ORIGINAL = process.env['SUNA_GITHUB_CLIENT_ID']

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['SUNA_GITHUB_CLIENT_ID']
  else process.env['SUNA_GITHUB_CLIENT_ID'] = ORIGINAL
})

describe('githubClientId', () => {
  it('reads the runtime override when one is set', () => {
    process.env['SUNA_GITHUB_CLIENT_ID'] = 'Iv1.abc123'
    expect(githubClientId()).toBe('Iv1.abc123')
    expect(githubConfigured()).toBe(true)
  })

  it('trims a padded value rather than sending whitespace to GitHub', () => {
    process.env['SUNA_GITHUB_CLIENT_ID'] = '  Iv1.abc123  '
    expect(githubClientId()).toBe('Iv1.abc123')
  })

  /**
   * The shipped default is empty until an OAuth App is registered. It must read
   * as "not configured" rather than as a client id of '', which would send a
   * request GitHub can only reject with an error nobody can act on.
   */
  it('treats an empty or whitespace-only id as no id at all', () => {
    process.env['SUNA_GITHUB_CLIENT_ID'] = '   '
    expect(githubClientId()).toBeNull()
    expect(githubConfigured()).toBe(false)
  })
})

describe('githubSession', () => {
  it('explains an unconfigured build instead of offering a sign-in that cannot work', async () => {
    process.env['SUNA_GITHUB_CLIENT_ID'] = ''
    const session = await githubSession()
    expect(session.configured).toBe(false)
    expect(session.signedIn).toBe(false)
    expect(session.account).toBeNull()
    expect(session.message).toMatch(/no GitHub OAuth App configured/i)
    // SSH is the route that still works, and the message has to say so.
    expect(session.message).toMatch(/SSH/)
  })
})
