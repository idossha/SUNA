import { beforeEach, describe, expect, it } from 'vitest'
import {
  aiCliSearch,
  cancelAiCliSearch,
  detectAvailableClis,
  isCliAvailable,
  resetCliDetectionCache,
  resolveCli,
  type CliProbe
} from './lit'
import { allowRoot } from './roots'

/**
 * CLI detection with a mocked probe (DECISIONS 2026-08-14) — no
 * real `claude --version` / `codex --version` spawn, so this suite is
 * deterministic regardless of what's actually installed on the machine
 * running the tests.
 */

beforeEach(() => {
  resetCliDetectionCache()
})

function probeThatFinds(...clis: readonly string[]): CliProbe {
  const set = new Set(clis)
  return async (cli) => set.has(cli)
}

describe('isCliAvailable', () => {
  it('reports what the probe finds', async () => {
    expect(await isCliAvailable('claude', probeThatFinds('claude'))).toBe(true)
    expect(await isCliAvailable('codex', probeThatFinds('claude'))).toBe(false)
  })

  it('caches the probe result per session — a second call never re-probes', async () => {
    let calls = 0
    const probe: CliProbe = async (cli) => {
      calls += 1
      return cli === 'claude'
    }
    expect(await isCliAvailable('claude', probe)).toBe(true)
    expect(await isCliAvailable('claude', probe)).toBe(true)
    expect(calls).toBe(1)
  })

  it('resetCliDetectionCache forces a fresh probe', async () => {
    expect(await isCliAvailable('claude', probeThatFinds())).toBe(false)
    resetCliDetectionCache()
    expect(await isCliAvailable('claude', probeThatFinds('claude'))).toBe(true)
  })
})

describe('detectAvailableClis', () => {
  it('lists only the CLIs the probe finds, in LIT_CLI_IDS order', async () => {
    expect(await detectAvailableClis(probeThatFinds('codex'))).toEqual(['codex'])
    resetCliDetectionCache()
    expect(await detectAvailableClis(probeThatFinds('claude', 'codex'))).toEqual(['claude', 'codex'])
    resetCliDetectionCache()
    expect(await detectAvailableClis(probeThatFinds())).toEqual([])
  })
})

describe('resolveCli', () => {
  it('auto prefers claude, then falls back to codex', async () => {
    expect(await resolveCli('auto', probeThatFinds('claude', 'codex'))).toBe('claude')
    resetCliDetectionCache()
    expect(await resolveCli('auto', probeThatFinds('codex'))).toBe('codex')
    resetCliDetectionCache()
    expect(await resolveCli('auto', probeThatFinds())).toBeNull()
  })

  it('an explicit preference is not honored if that CLI is missing, even when the other is installed', async () => {
    expect(await resolveCli('codex', probeThatFinds('claude'))).toBeNull()
    resetCliDetectionCache()
    expect(await resolveCli('claude', probeThatFinds('claude', 'codex'))).toBe('claude')
  })
})

describe('aiCliSearch — CLI-absent path', () => {
  it('gives the honest install hint instead of an empty silent list', async () => {
    const dir = '/tmp/suna-lit-test-project'
    allowRoot(dir)
    const progress: string[] = []
    const outcome = await aiCliSearch('search-1', 'ram pressure stripping', 5, {
      dir,
      cliPreference: 'auto',
      onProgress: (status) => progress.push(status),
      probe: probeThatFinds()
    })
    expect(outcome.results).toEqual([])
    expect(outcome.error).toBe('Install Claude Code or Codex, or use Crossref (no key needed).')
  })

  it('confines the search to an allowed project root', async () => {
    const outcome = await aiCliSearch('search-2', 'query', 5, {
      dir: '/definitely/not/an/opened/project',
      cliPreference: 'auto',
      onProgress: () => {},
      probe: probeThatFinds('claude')
    })
    expect(outcome.results).toEqual([])
    expect(outcome.error).toContain('outside any open project')
  })
})

describe('cancelAiCliSearch', () => {
  it('is a no-op for an unknown searchId', () => {
    expect(cancelAiCliSearch('never-started')).toBe(false)
  })
})
