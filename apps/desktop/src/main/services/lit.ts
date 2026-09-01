/**
 * Literature providers — re-exported from `@suna/bib`, the shared module
 * both this main process and the standalone MCP server (packages/agent/src/mcp)
 * import, so the two hosts run the exact same provider fetch/mapping logic
 * (see @suna/bib/src/providers.ts for the full implementation and its tests).
 */
export { lookupByDoi, searchLiterature } from '@suna/bib'

/**
 * The 'ai-cli' provider (ARCHITECTURE §15.6): spawns a Claude Code or Codex
 * CLI as a child process from THIS process — the only place in the app that
 * touches child_process for literature search. `@suna/bib` does the pure
 * parsing (JSON.parse → strip fences → validate, dropping malformed items);
 * this module only does process management: detection, spawn/kill,
 * timeout, cancellation, and progress narration.
 *
 * Deliberately NOT wired into the MCP `search_literature` tool (an agent
 * already has its own web search — see packages/agent/src/mcp/lit.ts).
 *
 * Ground truth (probed 2026-08-14, ARCHITECTURE §9, plus a live
 * verification run for codex during this build — see providers.ts's
 * ai-cli section doc for the exact commands):
 *   - claude: `-p "<prompt>" --output-format json --allowed-tools WebSearch`.
 *     No incremental progress in this output mode, so progress is synthetic
 *     ticks on a timer (stream-json was not attempted — see build report).
 *   - codex: `--ask-for-approval never --sandbox read-only --search exec
 *     --json --skip-git-repo-check -C <dir> --output-last-message <file>
 *     "<prompt>"`. `--json` streams real JSONL progress events on stdout
 *     (parsed by @suna/bib's codexProgressFromLine), and the final answer
 *     is written to `<file>` with no envelope.
 */
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LIT_CLI_IDS,
  type LitCliId,
  type LitCliPreference,
  type LitResult
} from '@suna/core'
import { codexProgressFromLine, parseClaudeCliOutput, parseCodexCliOutput } from '@suna/bib'
import { assertInsideAllowedRoot } from './roots'

const VERSION_TIMEOUT_MS = 5_000
export const AI_CLI_SEARCH_TIMEOUT_MS = 180_000

/**
 * A GUI-launched macOS app inherits a minimal PATH (no `~/.local/bin`, no
 * Homebrew's `/opt/homebrew/bin`) that leaves an installed `claude`/`codex`
 * undetectable even though a Terminal-launched shell finds them fine —
 * verified during this build: `claude` resolves to `~/.local/bin/claude`,
 * `codex` to `/opt/homebrew/bin/codex`, neither on Electron's default
 * inherited PATH. Append the common install locations so detection/spawn
 * matches what the user's own shell sees.
 */
export function cliEnv(): NodeJS.ProcessEnv {
  const extras = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  const path = process.env['PATH'] ?? ''
  return { ...process.env, PATH: [path, ...extras].filter((entry) => entry !== '').join(':') }
}

/* ------------------------------------------------------------- detection -- */

/** Injectable so detection is testable without a real child process. */
export type CliProbe = (cli: LitCliId) => Promise<boolean>

async function defaultProbe(cli: LitCliId): Promise<boolean> {
  return new Promise((resolvePromise) => {
    execFile(cli, ['--version'], { timeout: VERSION_TIMEOUT_MS, env: cliEnv() }, (error) => {
      resolvePromise(error === null)
    })
  })
}

/** Cached per session (module lifetime), keyed by CLI id. */
const detectionCache = new Map<LitCliId, boolean>()

/** Test-only: clears the per-session detection cache between cases. */
export function resetCliDetectionCache(): void {
  detectionCache.clear()
}

export async function isCliAvailable(cli: LitCliId, probe: CliProbe = defaultProbe): Promise<boolean> {
  const cached = detectionCache.get(cli)
  if (cached !== undefined) return cached
  const available = await probe(cli)
  detectionCache.set(cli, available)
  return available
}

/** Every agent CLI `--version` answered for within 5s, for the settings/UI picker. */
export async function detectAvailableClis(probe: CliProbe = defaultProbe): Promise<LitCliId[]> {
  const available: LitCliId[] = []
  for (const cli of LIT_CLI_IDS) {
    if (await isCliAvailable(cli, probe)) available.push(cli)
  }
  return available
}

/** Applies the 'literature.cli' settings preference ('auto' | 'claude' | 'codex') against what's installed. */
export async function resolveCli(
  preference: LitCliPreference,
  probe: CliProbe = defaultProbe
): Promise<LitCliId | null> {
  const order: readonly LitCliId[] =
    preference === 'auto' ? LIT_CLI_IDS : [preference]
  for (const cli of order) {
    if (await isCliAvailable(cli, probe)) return cli
  }
  return null
}

/* ------------------------------------------------------------------ search -- */

export interface AiCliSearchOptions {
  /** Project directory: child cwd, and the confinement boundary (roots.ts). */
  dir: string
  cliPreference: LitCliPreference
  onProgress: (status: string) => void
  /** Test seam: override CLI detection without spawning a real process. */
  probe?: CliProbe
}

export interface AiCliSearchResult {
  results: LitResult[]
  error: string | null
}

interface ActiveSearch {
  cancel: () => void
}

const activeSearches = new Map<string, ActiveSearch>()

/** Kills the child for an in-flight search. No-op if it already finished. Returns whether one was found. */
export function cancelAiCliSearch(searchId: string): boolean {
  const active = activeSearches.get(searchId)
  if (active === undefined) return false
  active.cancel()
  return true
}

/** Kills every in-flight ai-cli search — called on window close / app quit so no child leaks. */
export function cancelAllAiCliSearches(): void {
  for (const id of [...activeSearches.keys()]) cancelAiCliSearch(id)
}

function cliLabel(cli: LitCliId): string {
  return cli === 'claude' ? 'Claude Code' : 'Codex'
}

function buildPrompt(query: string, limit: number): string {
  return [
    `Use web search to find up to ${limit} real, published academic papers about: ${query}`,
    'Respond with ONLY a JSON array (no prose, no markdown code fences) of objects shaped exactly:',
    '{"title": string, "authors": string[], "year": number | null, "venue": string | null, "doi": string | null, "url": string | null, "abstract": string | null}.',
    'Use null for any field you cannot verify from a real source. Never fabricate a DOI.'
  ].join('\n')
}

/** Shared spawn/timeout/cancel bookkeeping around one child process run. */
function manageChild(
  searchId: string,
  child: ChildProcess,
  onSettleSignal: (cancelledByUser: boolean, timedOut: boolean) => void
): { markSettled: () => void } {
  let settled = false
  let cancelledByUser = false
  let timedOut = false

  activeSearches.set(searchId, {
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
  }, AI_CLI_SEARCH_TIMEOUT_MS)

  return {
    markSettled: () => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      activeSearches.delete(searchId)
      onSettleSignal(cancelledByUser, timedOut)
    }
  }
}

function runClaudeSearch(
  searchId: string,
  query: string,
  limit: number,
  options: AiCliSearchOptions
): Promise<AiCliSearchResult> {
  return new Promise((resolvePromise) => {
    const prompt = buildPrompt(query, limit)
    const child = spawn('claude', ['-p', prompt, '--output-format', 'json', '--allowed-tools', 'WebSearch'], {
      cwd: options.dir,
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    // `--output-format json` gives no incremental events, so the UI isn't a
    // frozen spinner for up to 3 minutes — synthetic ticks stand in for real
    // progress (stream-json was not attempted for claude; see build report).
    const ticks = ['Searching the web…', 'Reading sources…', 'Compiling results…']
    let tickIndex = 0
    options.onProgress(`Searching with ${cliLabel('claude')}…`)
    const tickTimer = setInterval(() => {
      options.onProgress(ticks[tickIndex % ticks.length] as string)
      tickIndex += 1
    }, 12_000)

    function finish(result: AiCliSearchResult): void {
      clearInterval(tickTimer)
      resolvePromise(result)
    }

    const exitInfo: { code: number | null } = { code: null }

    const { markSettled } = manageChild(searchId, child, (cancelledByUser, timedOut) => {
      if (cancelledByUser) {
        finish({ results: [], error: 'Search was cancelled.' })
        return
      }
      if (timedOut) {
        finish({
          results: [],
          error: `Claude Code search timed out after ${AI_CLI_SEARCH_TIMEOUT_MS / 1000}s.`
        })
        return
      }
      finish(parseClaudeCliOutput(stdout, stderr, exitInfo.code ?? 1))
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

async function runCodexSearch(
  searchId: string,
  query: string,
  limit: number,
  options: AiCliSearchOptions
): Promise<AiCliSearchResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'suna-lit-codex-'))
  const lastMessagePath = join(workDir, 'last-message.txt')
  try {
    return await new Promise<AiCliSearchResult>((resolvePromise) => {
      const prompt = buildPrompt(query, limit)
      const args = [
        '--ask-for-approval',
        'never',
        '--sandbox',
        'read-only',
        '--search',
        'exec',
        '--json',
        '--skip-git-repo-check',
        '-C',
        options.dir,
        '--output-last-message',
        lastMessagePath,
        prompt
      ]
      const child = spawn('codex', args, { cwd: options.dir, env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'] })

      let stderr = ''
      let stdoutBuffer = ''
      options.onProgress(`Searching with ${cliLabel('codex')}…`)

      function finish(result: AiCliSearchResult): void {
        resolvePromise(result)
      }

      const exitInfo: { code: number | null } = { code: null }

      const { markSettled } = manageChild(searchId, child, (cancelledByUser, timedOut) => {
        if (cancelledByUser) {
          finish({ results: [], error: 'Search was cancelled.' })
          return
        }
        if (timedOut) {
          finish({ results: [], error: `Codex search timed out after ${AI_CLI_SEARCH_TIMEOUT_MS / 1000}s.` })
          return
        }
        void readFile(lastMessagePath, 'utf8')
          .catch(() => '')
          .then((lastMessage) => {
            finish(parseCodexCliOutput(lastMessage, stderr, exitInfo.code ?? 1))
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
 * Run an 'ai-cli' search: resolves which CLI to use (settings 'literature.cli'
 * preference against what's installed), spawns it, and returns once it
 * completes, was cancelled (`cancelAiCliSearch`), or hit the 180s timeout.
 * Never throws — every failure mode comes back as `{ results: [], error }`.
 */
export async function aiCliSearch(
  searchId: string,
  query: string,
  limit: number,
  options: AiCliSearchOptions
): Promise<AiCliSearchResult> {
  let dir: string
  try {
    dir = assertInsideAllowedRoot(options.dir)
  } catch (error) {
    return { results: [], error: error instanceof Error ? error.message : String(error) }
  }
  const scopedOptions: AiCliSearchOptions = { ...options, dir }

  const cli = await resolveCli(options.cliPreference, options.probe)
  if (cli === null) {
    return {
      results: [],
      error: 'Install Claude Code or Codex, or use Crossref (no key needed).'
    }
  }
  return cli === 'claude'
    ? runClaudeSearch(searchId, query, limit, scopedOptions)
    : runCodexSearch(searchId, query, limit, scopedOptions)
}
