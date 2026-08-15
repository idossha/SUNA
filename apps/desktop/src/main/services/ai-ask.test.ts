import { beforeEach, describe, expect, it } from 'vitest'
import { resetCliDetectionCache, type CliProbe } from './lit'
import { allowRoot } from './roots'
import {
  cancelAiAsk,
  parseClaudeAskOutput,
  parseCodexAskOutput,
  runAiAsk
} from './ai-ask'

/**
 * Mirrors lit.test.ts's testing philosophy: CLI detection is injected via
 * `probe`, so this suite never spawns a real `claude`/`codex` process. The
 * envelope parsers get thorough direct coverage since they're the pure logic
 * unique to this adapter (the process-management half is exercised by
 * lit.test.ts already, reusing the very same `resolveCli`/`cliEnv`).
 */

beforeEach(() => {
  resetCliDetectionCache()
})

function probeThatFinds(...clis: readonly string[]): CliProbe {
  const set = new Set(clis)
  return async (cli) => set.has(cli)
}

describe('parseClaudeAskOutput', () => {
  function envelope(result: string, isError = false): string {
    return JSON.stringify({ result, is_error: isError })
  }

  it('extracts the plain-text answer from the ground-truth envelope', () => {
    const { text, error } = parseClaudeAskOutput(envelope('The Balmer series is visible.'), '', 0)
    expect(error).toBeNull()
    expect(text).toBe('The Balmer series is visible.')
  })

  it('trims surrounding whitespace from the answer', () => {
    const { text } = parseClaudeAskOutput(envelope('  padded answer  \n'), '', 0)
    expect(text).toBe('padded answer')
  })

  it('is_error true surfaces the failure message, not a blank answer', () => {
    const { text, error } = parseClaudeAskOutput(envelope('rate limited by the model provider', true), '', 0)
    expect(text).toBeNull()
    expect(error).toBe('rate limited by the model provider')
  })

  it('a non-zero exit surfaces the first 300 chars of stdout, falling back to stderr', () => {
    expect(parseClaudeAskOutput('', 'command not found: claude', 127)).toEqual({
      text: null,
      error: 'command not found: claude'
    })
    expect(parseClaudeAskOutput('partial output', 'ignored', 1)).toEqual({
      text: null,
      error: 'partial output'
    })
  })

  it('unparseable stdout (not the promised JSON object) surfaces honestly', () => {
    const { text, error } = parseClaudeAskOutput('not json at all', '', 0)
    expect(text).toBeNull()
    expect(error).toBe('not json at all')
  })

  it('a JSON value that is not an object, or an object missing .result, is an honest error', () => {
    expect(parseClaudeAskOutput('[1,2,3]', '', 0).error).toBe('[1,2,3]')
    expect(parseClaudeAskOutput('{"other":"field"}', '', 0).error).toBe('{"other":"field"}')
  })

  it('truncates a very long answer/error to 300 chars with an ellipsis', () => {
    const long = 'x'.repeat(500)
    expect(parseClaudeAskOutput(envelope(long, true), '', 0).error).toHaveLength(301)
    expect(parseClaudeAskOutput(envelope(long, true), '', 0).error?.endsWith('…')).toBe(true)
  })

  it('empty stdout on a zero exit is an honest "(empty output)" error, never a silent blank answer', () => {
    expect(parseClaudeAskOutput('', '', 0)).toEqual({ text: null, error: '(empty output)' })
  })
})

describe('parseCodexAskOutput', () => {
  it('parses the --output-last-message file content directly (no envelope, no JSON)', () => {
    const { text, error } = parseCodexAskOutput('The transition is forbidden.', '', 0)
    expect(error).toBeNull()
    expect(text).toBe('The transition is forbidden.')
  })

  it('trims surrounding whitespace', () => {
    expect(parseCodexAskOutput('  padded  \n', '', 0).text).toBe('padded')
  })

  it('a non-zero exit surfaces stderr when the last-message file is empty', () => {
    expect(parseCodexAskOutput('', 'error: not authenticated', 1)).toEqual({
      text: null,
      error: 'error: not authenticated'
    })
  })

  it('an empty last-message with exit 0 is still an honest error, not a silent blank answer', () => {
    const { text, error } = parseCodexAskOutput('', '', 0)
    expect(text).toBeNull()
    expect(error).not.toBeNull()
  })
})

describe('runAiAsk — CLI-absent path', () => {
  it('gives the honest install hint instead of a silent blank answer', async () => {
    const dir = '/tmp/suna-ai-ask-test-project'
    allowRoot(dir)
    const progress: string[] = []
    const outcome = await runAiAsk('ask-1', 'why is the sky blue', {
      dir,
      cliPreference: 'auto',
      onProgress: (status) => progress.push(status),
      probe: probeThatFinds()
    })
    expect(outcome).toEqual({ text: null, error: 'Install Claude Code or Codex to use the ? command.' })
  })

  it('confines the question to an allowed project root', async () => {
    const outcome = await runAiAsk('ask-2', 'why is the sky blue', {
      dir: '/definitely/not/an/opened/project',
      cliPreference: 'auto',
      onProgress: () => {},
      probe: probeThatFinds('claude')
    })
    expect(outcome.text).toBeNull()
    expect(outcome.error).toContain('outside any open project')
  })
})

describe('cancelAiAsk', () => {
  it('is a no-op for an unknown askId', () => {
    expect(cancelAiAsk('never-started')).toBe(false)
  })
})
