import { afterEach, describe, expect, it } from 'vitest'
import {
  clientIdProblem,
  githubClientId,
  githubConfigProblem,
  githubConfigured,
  githubSession
} from './github-auth'

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

describe('clientIdProblem', () => {
  it('accepts both client-id shapes GitHub has issued', () => {
    // 'Iv1.' + hex is the older form; 'Ov23li…' the current one.
    expect(clientIdProblem('Iv1.8a61f9b3a7aba766')).toBeNull()
    expect(clientIdProblem('Ov23liQ1a2B3c4D5e6F7')).toBeNull()
  })

  it('says nothing about a build that simply has no id yet', () => {
    expect(clientIdProblem('')).toBeNull()
  })

  /**
   * The check worth having: the secret sits next to the id on GitHub's page,
   * pasting the wrong one is easy, and it would be committed exactly like the
   * id. GitHub would then reject it with an error naming neither problem.
   */
  it('catches a client SECRET pasted into the id slot', () => {
    const secret = 'a'.repeat(40)
    expect(clientIdProblem(secret)).toMatch(/client SECRET/)
    expect(clientIdProblem(secret)).toMatch(/never be committed/)
  })

  it('rejects a value that could not be a client id at all', () => {
    expect(clientIdProblem('has space')).toMatch(/does not look like/)
    expect(clientIdProblem('short')).toMatch(/does not look like/)
    expect(clientIdProblem('has/slash/and?query')).toMatch(/does not look like/)
  })

  it('refuses to use a malformed id rather than sending it to GitHub', () => {
    process.env['SUNA_GITHUB_CLIENT_ID'] = 'a'.repeat(40)
    expect(githubClientId()).toBeNull()
    expect(githubConfigured()).toBe(false)
    expect(githubConfigProblem()).toMatch(/client SECRET/)
  })

  it('reports no problem when the id is usable', () => {
    process.env['SUNA_GITHUB_CLIENT_ID'] = 'Ov23liQ1a2B3c4D5e6F7'
    expect(githubConfigProblem()).toBeNull()
    expect(githubClientId()).toBe('Ov23liQ1a2B3c4D5e6F7')
  })
})

describe('githubSession when misconfigured', () => {
  it('names the mistake instead of the generic not-configured line', async () => {
    process.env['SUNA_GITHUB_CLIENT_ID'] = 'b'.repeat(40)
    const session = await githubSession()
    expect(session.configured).toBe(false)
    expect(session.message).toMatch(/client SECRET/)
  })
})
