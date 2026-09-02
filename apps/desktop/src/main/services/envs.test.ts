import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  awaitProvision,
  createEnvWithUv,
  installKernelRuntime,
  provisionProjectEnv,
  uvAvailable,
  type KernelRuntimeRunners,
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

/**
 * The ipykernel install (ROADMAP item 5, §20.6). Every branch here is a
 * failure the user must be told about honestly rather than left to discover
 * when a cell does not run.
 */
describe('installKernelRuntime', () => {
  /** A directory shaped like a venv, so resolvePython finds an interpreter. */
  const venv = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'suna-kernel-'))
    const envPath = join(dir, '.venv')
    await mkdir(join(envPath, 'bin'), { recursive: true })
    await writeFile(join(envPath, 'bin', 'python'), '#!/bin/sh\n')
    return envPath
  }

  const runners = (log: string[], present: boolean[]): KernelRuntimeRunners => ({
    probe: async () => {
      log.push('probe')
      return present.shift() ?? false
    },
    install: async () => {
      log.push('install')
    }
  })

  it('installs when the runtime is missing, then re-checks that it is importable', async () => {
    const log: string[] = []
    const result = await installKernelRuntime(await venv(), runners(log, [false, true]))
    expect(result).toEqual({ ok: true, alreadyPresent: false, error: null })
    // The trailing probe is the point: "pip succeeded" is not the claim.
    expect(log).toEqual(['probe', 'install', 'probe'])
  })

  it('installs nothing when the runtime is already there', async () => {
    const log: string[] = []
    const result = await installKernelRuntime(await venv(), runners(log, [true]))
    expect(result).toEqual({ ok: true, alreadyPresent: true, error: null })
    expect(log).toEqual(['probe'])
  })

  it('reports the command to run by hand when the install fails', async () => {
    const envPath = await venv()
    const result = await installKernelRuntime(envPath, {
      probe: async () => false,
      install: async () => {
        throw new Error('Could not reach https://pypi.org')
      }
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Could not reach https://pypi.org')
    expect(result.error).toContain(`${join(envPath, 'bin', 'python')} -m pip install ipykernel`)
  })

  it('does not claim success when the install left nothing importable', async () => {
    const log: string[] = []
    const result = await installKernelRuntime(await venv(), runners(log, [false, false]))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('still not importable')
  })

  it('refuses honestly when the env has no interpreter at all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'suna-kernel-'))
    const result = await installKernelRuntime(dir, {
      probe: async () => {
        throw new Error('must not probe an env with no interpreter')
      },
      install: async () => {
        throw new Error('must not install into an env with no interpreter')
      }
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('has no interpreter')
  })
})
