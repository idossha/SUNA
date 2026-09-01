import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

/* ---------------------------------------------------------------------------
   The HTTPS credential bridge.

   Two things must hold, and the second is a security property rather than a
   feature: the token reaches git when it should, and it reaches nothing and
   nobody else. The negative cases below are the important half.
   --------------------------------------------------------------------------- */

let token: string | null = 'gho_secret'

vi.mock('./github-auth', () => ({
  githubToken: async (): Promise<string | null> => token
}))

const { canAuthenticateHttps, remoteAuthEnv } = await import('./git-credential')

const run = promisify(execFile)

afterEach(() => {
  token = 'gho_secret'
})

describe('remoteAuthEnv — when the token is offered', () => {
  it('supplies an askpass helper for a GitHub HTTPS remote while signed in', async () => {
    const env = await remoteAuthEnv('https://github.com/ada/paper.git')
    expect(env).toBeDefined()
    expect(env?.['GIT_ASKPASS']).toMatch(/askpass\.(sh|bat)$/)
    expect(env?.['SUNA_GIT_TOKEN']).toBe('gho_secret')
    // Prompts must stay off: a windowless app cannot answer one.
    expect(env?.['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(await canAuthenticateHttps('https://github.com/ada/paper.git')).toBe(true)
  })

  /**
   * Verified against a real machine and a real private repository: with the
   * helper list intact, a deliberately INVALID token still authenticated,
   * because osxkeychain answered first and git never consulted GIT_ASKPASS.
   * On such a machine the sign-in would be decorative — and once the stored
   * credential expired, signing in would not fix pushes at all.
   *
   * An empty credential.helper resets the list rather than appending to it.
   */
  it('resets the credential-helper list, which git consults before askpass', async () => {
    const env = await remoteAuthEnv('https://github.com/ada/paper.git')
    expect(env?.['GIT_CONFIG_COUNT']).toBe('1')
    expect(env?.['GIT_CONFIG_KEY_0']).toBe('credential.helper')
    expect(env?.['GIT_CONFIG_VALUE_0']).toBe('')
  })

  it('accepts the www host GitHub also answers on', async () => {
    expect(await remoteAuthEnv('https://www.github.com/ada/paper.git')).toBeDefined()
  })

  it('reuses one helper script rather than writing a new one per call', async () => {
    const first = await remoteAuthEnv('https://github.com/ada/paper.git')
    const second = await remoteAuthEnv('https://github.com/ada/other.git')
    expect(first?.['GIT_ASKPASS']).toBe(second?.['GIT_ASKPASS'])
  })
})

describe('remoteAuthEnv — when it must stay silent', () => {
  it('offers nothing for an SSH remote, which needs no token', async () => {
    expect(await remoteAuthEnv('git@github.com:ada/paper.git')).toBeUndefined()
    expect(await remoteAuthEnv('ssh://git@github.com/ada/paper.git')).toBeUndefined()
    expect(await canAuthenticateHttps('git@github.com:ada/paper.git')).toBe(false)
  })

  /**
   * The one that matters most: a GitHub token handed to gitlab.example.edu is
   * a credential leak to a third party, dressed up as a convenience.
   */
  it('never sends a GitHub token to a host that is not GitHub', async () => {
    for (const url of [
      'https://gitlab.com/ada/paper.git',
      'https://git.university.edu/ada/paper.git',
      'https://github.com.evil.example/ada/paper.git',
      'https://notgithub.com/ada/paper.git'
    ]) {
      expect(await remoteAuthEnv(url)).toBeUndefined()
    }
  })

  it('does not touch the helper list when it has no token to offer', async () => {
    token = null
    const env = await remoteAuthEnv('https://github.com/ada/paper.git')
    // undefined, not "an env that disables the helpers" — with no token of
    // ours, the machine's own credentials are the only ones that can work.
    expect(env).toBeUndefined()
  })

  it('offers nothing when nobody is signed in', async () => {
    token = null
    expect(await remoteAuthEnv('https://github.com/ada/paper.git')).toBeUndefined()
    expect(await canAuthenticateHttps('https://github.com/ada/paper.git')).toBe(false)
  })

  it('offers nothing for a local path or a missing remote', async () => {
    expect(await remoteAuthEnv(null)).toBeUndefined()
    expect(await remoteAuthEnv('')).toBeUndefined()
    expect(await remoteAuthEnv('/Volumes/backup/paper.git')).toBeUndefined()
  })
})

describe('the askpass helper itself', () => {
  /**
   * Running it is the only way to know the mechanism works — a path in an env
   * var proves nothing. git calls this with the prompt as argv[1] and reads
   * the answer from stdout.
   */
  it(
    'prints the token from the environment and nothing else',
    async () => {
      const env = await remoteAuthEnv('https://github.com/ada/paper.git')
      const script = env?.['GIT_ASKPASS'] as string

      const asked = await run(script, ["Password for 'https://github.com':"], {
        env: { ...process.env, SUNA_GIT_TOKEN: 'gho_from_env' }
      })
      expect(asked.stdout).toBe('gho_from_env')

      // GitHub accepts the token in either position, which is why the helper
      // can answer both prompts identically and stay one line.
      const user = await run(script, ["Username for 'https://github.com':"], {
        env: { ...process.env, SUNA_GIT_TOKEN: 'gho_from_env' }
      })
      expect(user.stdout).toBe('gho_from_env')
    },
    30_000
  )

  it(
    'is not readable or runnable by anyone but this user',
    async () => {
      const env = await remoteAuthEnv('https://github.com/ada/paper.git')
      const { stat } = await import('node:fs/promises')
      const info = await stat(env?.['GIT_ASKPASS'] as string)
      // 0o700: no group or world bits at all.
      expect(info.mode & 0o077).toBe(0)
    }
  )

  it(
    'does not contain the token, which lives only in the environment',
    async () => {
      const env = await remoteAuthEnv('https://github.com/ada/paper.git')
      const { readFile } = await import('node:fs/promises')
      const text = await readFile(env?.['GIT_ASKPASS'] as string, 'utf8')
      expect(text).not.toContain('gho_secret')
      expect(text).toContain('SUNA_GIT_TOKEN')
    }
  )
})
