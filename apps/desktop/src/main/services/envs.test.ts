import { describe, expect, it } from 'vitest'
import { createEnvWithUv, uvAvailable } from './envs'

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
