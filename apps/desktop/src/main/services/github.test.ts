import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { explainCreateFailure, ghCreateRepo } from './github'
import { allowRoot } from './roots'

describe('explainCreateFailure', () => {
  it('names the collision when the repository exists', () => {
    const out = explainCreateFailure(422, {
      message: 'Repository creation failed.',
      errors: [{ message: 'name already exists on this account' }]
    })
    expect(out).toMatch(/already exists on that account/)
    expect(out).toContain('name already exists on this account')
  })

  it('sends an auth failure back to signing in again', () => {
    expect(explainCreateFailure(401, { message: 'Bad credentials' })).toMatch(/sign out and in/i)
  })

  it('separates a scope failure from an auth failure', () => {
    expect(explainCreateFailure(403, { message: 'Resource not accessible' })).toMatch(
      /not allowed to create/
    )
  })

  it('names a missing organization for a 404', () => {
    expect(explainCreateFailure(404, { message: 'Not Found' })).toMatch(/no such organization/)
  })

  it('still says something when GitHub sends no message at all', () => {
    expect(explainCreateFailure(500, {})).toMatch(/HTTP 500/)
  })
})

describe('ghCreateRepo validation', () => {
  it('rejects a name that could be read as a flag or a path', async () => {
    const base = await mkdtemp(join(tmpdir(), 'suna-gh-'))
    allowRoot(base)
    try {
      // Refused before any network call, so no repository can be created.
      await expect(ghCreateRepo(base, '--public', 'private', null, null, false)).rejects.toThrow(
        /repository name/
      )
      await expect(ghCreateRepo(base, 'a/b', 'private', null, null, false)).rejects.toThrow(
        /repository name/
      )
      await expect(
        ghCreateRepo(base, 'ok-name', 'private', 'bad owner', null, false)
      ).rejects.toThrow(/valid GitHub account/)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('refuses a directory outside every open project', async () => {
    await expect(
      ghCreateRepo('/nowhere-at-all', 'name', 'private', null, null, false)
    ).rejects.toThrow(/outside any open project/)
  })

  it('refuses internal visibility without an organization to own it', async () => {
    const base = await mkdtemp(join(tmpdir(), 'suna-gh-'))
    allowRoot(base)
    try {
      await expect(ghCreateRepo(base, 'ok-name', 'internal', null, null, false)).rejects.toThrow(
        /organization/
      )
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
