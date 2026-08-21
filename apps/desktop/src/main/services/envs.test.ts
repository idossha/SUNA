import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  awaitProvision,
  createEnvWithUv,
  provisionProjectEnv,
  uvAvailable,
  type ProvisionRunners
} from './envs'

describe('uvAvailable', () => {
  it('reports true when the probe resolves true', async () => {
    expect(await uvAvailable(async () => true)).toBe(true)
  })

  it('reports false when the probe resolves false (uv not on PATH)', async () => {
    expect(await uvAvailable(async () => false)).toBe(false)
  })
})

describe('createEnvWithUv', () => {
  it('resolves with the venv path on success', async () => {
    const result = await createEnvWithUv('/work/my-paper', async () => undefined)
    expect(result).toEqual({ ok: true, envPath: '/work/my-paper/.venv', error: null })
  })

  it('reports a clear "not installed" error on ENOENT, and never throws', async () => {
    const runner = async (): Promise<void> => {
      const error = new Error('spawn uv ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    const result = await createEnvWithUv('/work/my-paper', runner)
    expect(result).toEqual({
      ok: false,
      envPath: null,
      error: 'uv is not installed or not on PATH'
    })
  })

  it('surfaces a real failure message (not the generic ENOENT wording)', async () => {
    const runner = async (): Promise<void> => {
      throw new Error('uv venv failed: no interpreter found for Python 3.12')
    }
    const result = await createEnvWithUv('/work/my-paper', runner)
    expect(result.ok).toBe(false)
    expect(result.envPath).toBeNull()
    expect(result.error).toBe('uv venv failed: no interpreter found for Python 3.12')
  })
})

describe('provisionProjectEnv', () => {
  /** A runner pair that fakes `uv venv` by writing the files a venv has. */
  const fakeRunners = (log: string[]): ProvisionRunners => ({
    createVenv: async (_dir, envPath) => {
      log.push('create')
      await mkdir(join(envPath, 'bin'), { recursive: true })
      await writeFile(join(envPath, 'pyvenv.cfg'), 'home = /usr/bin\n')
      await writeFile(join(envPath, 'bin', 'python'), '#!/bin/sh\n')
    },
    install: async () => {
      log.push('install')
    }
  })

  const project = async (withRequirements: boolean): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'suna-env-'))
    if (withRequirements) await writeFile(join(dir, 'requirements.txt'), 'ipykernel\n')
    return dir
  }

  it('creates the venv and installs the requirements into it', async () => {
    const dir = await project(true)
    const log: string[] = []
    const result = await provisionProjectEnv(dir, fakeRunners(log))
    expect(result).toEqual({ ok: true, envPath: join(dir, '.venv'), error: null })
    expect(log).toEqual(['create', 'install'])
  })

  it('does nothing for a project that ships no requirements.txt', async () => {
    const dir = await project(false)
    const log: string[] = []
    const result = await provisionProjectEnv(dir, fakeRunners(log))
    expect(result.ok).toBe(false)
    expect(log).toEqual([])
  })

  it('reuses an existing .venv rather than recreating it, but still installs', async () => {
    const dir = await project(true)
    const envPath = join(dir, '.venv')
    await mkdir(join(envPath, 'bin'), { recursive: true })
    await writeFile(join(envPath, 'pyvenv.cfg'), 'home = /usr/bin\n')
    await writeFile(join(envPath, 'bin', 'python'), '#!/bin/sh\n')
    const log: string[] = []
    expect((await provisionProjectEnv(dir, fakeRunners(log))).ok).toBe(true)
    expect(log).toEqual(['install'])
  })

  it('never throws when the install fails, and reports why', async () => {
    const dir = await project(true)
    const log: string[] = []
    const runners = fakeRunners(log)
    const result = await provisionProjectEnv(dir, {
      ...runners,
      install: async () => {
        throw new Error('no network')
      }
    })
    expect(result).toEqual({ ok: false, envPath: null, error: 'no network' })
  })

  it('provisions once per env and shares the promise; awaitProvision waits for it', async () => {
    const dir = await project(true)
    const log: string[] = []
    const runners = fakeRunners(log)
    const [a, b] = await Promise.all([
      provisionProjectEnv(dir, runners),
      provisionProjectEnv(dir, runners)
    ])
    expect(a).toEqual(b)
    expect(log).toEqual(['create', 'install'])
    await expect(awaitProvision(join(dir, '.venv'))).resolves.toBeUndefined()
    await expect(awaitProvision(null)).resolves.toBeUndefined()
  })
})
