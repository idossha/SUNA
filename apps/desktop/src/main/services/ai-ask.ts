/**
 * General-purpose "ask the agent CLI" adapter — the command palette's `?`
 * prefix (DECISIONS 2026-08-14): "the rest is sent to the agent CLI in the
 * project directory (same adapter as literature search)". This mirrors
 * lit.ts's 'ai-cli' process management (detect → spawn `-p … --output-format
 * json` → timeout → cancellable) but the *parsing* is deliberately different:
 * the literature adapter expects the model's answer to be a JSON array of
 * papers, while a palette question expects free-text prose, so this module
 * has its own tiny envelope parser instead of @suna/bib's array-shaped one.
 *
 * Detection/env plumbing (`resolveCli`, `cliEnv`) is reused from lit.ts —
 * one probe cache, one PATH-repair fix, not two.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiEffort, AiModel, LitCliId, LitCliPreference } from '@suna/core'
import { codexProgressFromLine } from '@suna/bib'
import { cliEnv, resolveCli, type CliProbe } from './lit'
import { assertInsideAllowedRoot } from './roots'

export const AI_ASK_TIMEOUT_MS = 180_000

export interface AiAskOptions {
  /** Project directory: child cwd, and the confinement boundary (roots.ts). */
  dir: string
  cliPreference: LitCliPreference
  onProgress: (status: string) => void
  /** Test seam: override CLI detection without spawning a real process. */
  probe?: CliProbe
  // Directed-action extensions (ARCHITECTURE §15.6). All three shape the
  // CLAUDE spawn only; the codex path ignores them — codex asks run
  // `--sandbox read-only`, so directed EDIT actions never target codex.
  /** Values for ONE `--allowed-tools` argv element, comma-joined. */
  allowedTools?: string[]
  /** Append `--mcp-config <dir>/.mcp.json` — only when that file exists. */
  useMcp?: boolean
  /** Deliver the prompt over stdin: no argv length limit, absent from `ps`. */
  viaStdin?: boolean
  /**
   * Model tier and reasoning effort ('ai.model' / 'ai.effort', resolved
   * project-then-global by the caller). Undefined leaves the CLI on whatever
   * the user's own claude/codex config says — an ask must still run against a
   * CLI whose flags this build does not know.
   */
  model?: AiModel
  effort?: AiEffort
}

/**
 * Codex reads reasoning effort from `model_reasoning_effort`, whose vocabulary
 * stops at 'high'. The two levels above it collapse there rather than being
 * dropped: a project that asked for more thinking gets the most codex has.
 */
export function codexReasoningEffort(effort: AiEffort): string {
  return effort === 'xhigh' || effort === 'max' ? 'high' : effort
}

export interface AiAskResult {
  text: string | null
  error: string | null
}

interface ActiveAsk {
  cancel: () => void
}

const activeAsks = new Map<string, ActiveAsk>()

/** Kills the child for an in-flight ask. No-op if it already finished. Returns whether one was found. */
export function cancelAiAsk(askId: string): boolean {
  const active = activeAsks.get(askId)
  if (active === undefined) return false
  active.cancel()
  return true
}

/** Kills every in-flight ask — called on window close / app quit so no child leaks. */
export function cancelAllAiAsks(): void {
  for (const id of [...activeAsks.keys()]) cancelAiAsk(id)
}

function cliLabel(cli: LitCliId): string {
  return cli === 'claude' ? 'Claude Code' : 'Codex'
}

/** First `n` chars of the model's raw answer/failure — an honest error, never a silent blank. */
function firstChars(text: string, n: number): string {
  const trimmed = text.trim()
  if (trimmed === '') return '(empty output)'
  return trimmed.length <= n ? trimmed : `${trimmed.slice(0, n)}…`
}

/**
 * Parse `claude -p "<prompt>" --output-format json` stdout: one envelope
 * object, `.result` is the answer STRING (not an array), `.is_error` flags a
 * failed turn (same envelope shape lit.ts's ai-cli adapter observed live).
 */
export function parseClaudeAskOutput(stdout: string, stderr: string, exitCode: number): AiAskResult {
  if (exitCode !== 0) {
    return { text: null, error: firstChars(stdout !== '' ? stdout : stderr, 300) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { text: null, error: firstChars(stdout !== '' ? stdout : stderr, 300) }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { text: null, error: firstChars(stdout, 300) }
  }
  const envelope = parsed as Record<string, unknown>
  const result = typeof envelope['result'] === 'string' ? envelope['result'] : null
  if (result === null) {
    return { text: null, error: firstChars(stdout, 300) }
  }
  if (envelope['is_error'] === true) {
    return { text: null, error: firstChars(result, 300) }
  }
  return { text: result.trim(), error: null }
}

/**
 * Parse a `codex exec --output-last-message <file>` run: the file's raw text
 * IS the answer, no envelope (verified live for the lit adapter, same CLI).
 */
export function parseCodexAskOutput(lastMessage: string, stderr: string, exitCode: number): AiAskResult {
  if (exitCode !== 0 || lastMessage.trim() === '') {
    return { text: null, error: firstChars(lastMessage !== '' ? lastMessage : stderr, 300) }
  }
  return { text: lastMessage.trim(), error: null }
}

/** Shared spawn/timeout/cancel bookkeeping around one child process run. */
function manageChild(
  askId: string,
  child: ChildProcess,
  onSettleSignal: (cancelledByUser: boolean, timedOut: boolean) => void
): { markSettled: () => void } {
  let settled = false
  let cancelledByUser = false
  let timedOut = false

  activeAsks.set(askId, {
    cancel: () => {
      if (settled) return
      cancelledByUser = true
      try {
        child.kill()
      } catch {
        // already exited
      }
    }
  })

  const timeoutTimer = setTimeout(() => {
    if (settled) return
    timedOut = true
    try {
      child.kill()
    } catch {
      // already exited
    }
  }, AI_ASK_TIMEOUT_MS)

  return {
    markSettled: () => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      activeAsks.delete(askId)
      onSettleSignal(cancelledByUser, timedOut)
    }
  }
}

/**
 * Argv for one `claude -p` run (ARCHITECTURE §15.6) — pure so tests can pin
 * the flag contract without spawning. With `viaStdin` the positional prompt
 * is dropped (`claude -p` reads stdin when none is given — measured live);
 * `allowedTools` joins into ONE argv element (the CLI accepts comma-separated
 * values); `mcpConfigPath` is appended only when the caller has verified the
 * file exists — claude errors out on a missing `--mcp-config` path.
 */
export function claudeAskArgs(
  prompt: string,
  options: {
    viaStdin?: boolean
    allowedTools?: string[]
    mcpConfigPath?: string | null
    model?: AiModel
    effort?: AiEffort
  }
): string[] {
  const args =
    options.viaStdin === true
      ? ['-p', '--output-format', 'json']
      : ['-p', prompt, '--output-format', 'json']
  // The tier names ARE claude's model aliases, so the setting passes straight
  // through; --effort takes the same five levels the setting offers.
  if (options.model !== undefined) args.push('--model', options.model)
  if (options.effort !== undefined) args.push('--effort', options.effort)
  if (options.mcpConfigPath !== undefined && options.mcpConfigPath !== null) {
    args.push('--mcp-config', options.mcpConfigPath)
  }
  if (options.allowedTools !== undefined && options.allowedTools.length > 0) {
    args.push('--allowed-tools', options.allowedTools.join(','))
  }
  return args
}

async function runClaudeAsk(askId: string, prompt: string, options: AiAskOptions): Promise<AiAskResult> {
  // Resolve the MCP config before spawning: a project without an agent layer
  // must still answer plain asks rather than die on a missing --mcp-config.
  let mcpConfigPath: string | null = null
  if (options.useMcp === true) {
    const candidate = join(options.dir, '.mcp.json')
    mcpConfigPath = await access(candidate).then(
      () => candidate,
      () => null
    )
  }
  const args = claudeAskArgs(prompt, {
    viaStdin: options.viaStdin,
    allowedTools: options.allowedTools,
    mcpConfigPath,
    model: options.model,
    effort: options.effort
  })

  return new Promise((resolvePromise) => {
    const child = spawn('claude', args, {
      cwd: options.dir,
      env: cliEnv(),
      stdio: [options.viaStdin === true ? 'pipe' : 'ignore', 'pipe', 'pipe']
    })

    if (options.viaStdin === true && child.stdin !== null) {
      // A failed spawn (CLI missing) surfaces via the child's 'error' event;
      // the mirrored stdin EPIPE must not crash the main process.
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    }

    let stdout = ''
    let stderr = ''

    // `--output-format json` gives no incremental events — synthetic ticks
    // stand in for real progress, same tradeoff as the lit ai-cli adapter.
    options.onProgress(`Asking ${cliLabel('claude')}…`)
    const tickTimer = setInterval(() => {
      options.onProgress('Thinking…')
    }, 12_000)

    function finish(result: AiAskResult): void {
      clearInterval(tickTimer)
      resolvePromise(result)
    }

    const exitInfo: { code: number | null } = { code: null }

    const { markSettled } = manageChild(askId, child, (cancelledByUser, timedOut) => {
      if (cancelledByUser) {
        finish({ text: null, error: 'Cancelled.' })
        return
      }
      if (timedOut) {
        finish({ text: null, error: `Claude Code timed out after ${AI_ASK_TIMEOUT_MS / 1000}s.` })
        return
      }
      finish(parseClaudeAskOutput(stdout, stderr, exitInfo.code ?? 1))
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      exitInfo.code = 1
      stderr += error.message
      markSettled()
    })
    child.on('close', (code) => {
      exitInfo.code = code
      markSettled()
    })
  })
}

/**
 * The `-c model_reasoning_effort=…` pair for a codex spawn, or nothing when no
 * effort is set. The model TIER is deliberately not passed: 'opus'/'sonnet'
 * name Anthropic models, and codex would reject them — a codex run keeps the
 * model its own config picks and takes only the effort.
 */
export function codexAskEffortArgs(effort: AiEffort | undefined): string[] {
  if (effort === undefined) return []
  return ['-c', `model_reasoning_effort=${codexReasoningEffort(effort)}`]
}

async function runCodexAsk(askId: string, prompt: string, options: AiAskOptions): Promise<AiAskResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'suna-ai-ask-codex-'))
  const lastMessagePath = join(workDir, 'last-message.txt')
  try {
    return await new Promise<AiAskResult>((resolvePromise) => {
      const args = [
        '--ask-for-approval',
        'never',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        ...codexAskEffortArgs(options.effort),
        '-C',
        options.dir,
        '--output-last-message',
        lastMessagePath,
        prompt
      ]
      const child = spawn('codex', args, { cwd: options.dir, env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'] })

      let stderr = ''
      let stdoutBuffer = ''
      options.onProgress(`Asking ${cliLabel('codex')}…`)

      function finish(result: AiAskResult): void {
        resolvePromise(result)
      }

      const exitInfo: { code: number | null } = { code: null }

      const { markSettled } = manageChild(askId, child, (cancelledByUser, timedOut) => {
        if (cancelledByUser) {
          finish({ text: null, error: 'Cancelled.' })
          return
        }
        if (timedOut) {
          finish({ text: null, error: `Codex timed out after ${AI_ASK_TIMEOUT_MS / 1000}s.` })
          return
        }
        void readFile(lastMessagePath, 'utf8')
          .catch(() => '')
          .then((lastMessage) => {
            finish(parseCodexAskOutput(lastMessage, stderr, exitInfo.code ?? 1))
          })
      })

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString()
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const status = codexProgressFromLine(line)
          if (status !== null) options.onProgress(status)
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => {
        exitInfo.code = 1
        stderr += error.message
        markSettled()
      })
      child.on('close', (code) => {
        exitInfo.code = code
        markSettled()
      })
    })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      // best-effort cleanup of the temp last-message dir
    })
  }
}

/**
 * Run one `?`-prefixed palette question: resolves which CLI to use (settings
 * 'literature.cli' preference against what's installed — the same setting the
 * literature ai-cli provider reads, since it names the same underlying
 * choice), spawns it in `dir`, and returns once it completes, was cancelled
 * (`cancelAiAsk`), or hit the 180s timeout. Never throws — every failure mode
 * comes back as `{ text: null, error }`.
 */
export async function runAiAsk(askId: string, prompt: string, options: AiAskOptions): Promise<AiAskResult> {
  let dir: string
  try {
    dir = assertInsideAllowedRoot(options.dir)
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : String(error) }
  }
  const scopedOptions: AiAskOptions = { ...options, dir }

  const cli = await resolveCli(options.cliPreference, options.probe)
  if (cli === null) {
    return { text: null, error: 'Install Claude Code or Codex to use the ? command.' }
  }
  return cli === 'claude'
    ? runClaudeAsk(askId, prompt, scopedOptions)
    : runCodexAsk(askId, prompt, scopedOptions)
}
