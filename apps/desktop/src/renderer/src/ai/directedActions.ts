/**
 * The one runner behind the three directed AI actions (feature-plan-8 §2c):
 * comment fix (§3), figure edit (§4), UI repair (§5). Each entry point
 * composes its template, starts a headless 'ai:ask' run with the action's
 * tool allowlist, and drives state/aiActions so any surface can render
 * progress/cancel by key while the launching component unmounts freely.
 * On success the answer lands in the Agent transcript (pushExternalExchange
 * keeps it the single place every AI answer is reviewed); on error the
 * status bar shows the CLI's message verbatim.
 */
import { LIT_CLI_IDS, type LitCliId, type LitCliPreference } from '@suna/core'
import { startAiAsk, type AiAskOutcome } from '../palette/aiAsk'
import { useAgentChatStore } from '../state/agentChat'
import {
  commentRunKey,
  figureRunKey,
  REPAIR_RUN_KEY,
  useAiActionsStore
} from '../state/aiActions'
import { useSettingsStore } from '../state/settings'
import { useUiStore } from '../state/ui'
import {
  commentFixPrompt,
  figureEditPrompt,
  shortTitle,
  uiRepairPrompt,
  type CommentFixPromptInput,
  type FigureEditPromptInput,
  type UiRepairPromptInput
} from './templates'

/* ------------------------------------------------------------ allowlists -- */

// Verbatim from feature-plan-8 §2c. Main joins each list into ONE
// --allowed-tools argv element; the mcp__suna__* names are the registered
// tools in packages/agent/src/mcp/verbs.ts (+ comments.ts).
const FIGURE_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'mcp__suna__read_figure_svg',
  'mcp__suna__list_figures',
  'mcp__suna__check_figure_compliance'
]
const COMMENT_TOOLS = [
  'Read',
  'Grep',
  'mcp__suna__read_manuscript',
  'mcp__suna__list_outline',
  'mcp__suna__list_comments',
  'mcp__suna__edit_manuscript',
  'mcp__suna__reply_comment'
  // No resolve verb exists: resolving a thread is human-only, in the app.
]
const REPAIR_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(pnpm:*)', 'Bash(node:*)']

/* -------------------------------------------------------------- CLI gate -- */

export interface CliGateResult {
  ok: boolean
  reason?: string
}

/**
 * Pure half of cliGate: mirror main's resolveCli order ('auto' tries claude
 * then codex; an explicit preference never falls back) and translate the
 * outcome into the §2a disabled-button reasons. Directed EDIT actions are
 * claude-only for now — codex asks run --sandbox read-only.
 */
export function gateFromStatus(
  preference: LitCliPreference,
  available: readonly LitCliId[]
): CliGateResult {
  const order: readonly LitCliId[] = preference === 'auto' ? LIT_CLI_IDS : [preference]
  const resolved = order.find((cli) => available.includes(cli)) ?? null
  if (resolved === 'claude') return { ok: true }
  if (resolved === 'codex') {
    return { ok: false, reason: 'AI edits need Claude Code (codex runs read-only here)' }
  }
  return { ok: false, reason: 'Install Claude Code to run AI edits.' }
}

/**
 * Can a directed action run right now? The §3/§4 buttons call this to
 * disable themselves with an honest title. Uses the same 'lit:cli-status'
 * round trip as the settings page and the same 'lit.cli' preference the
 * spawn itself will resolve against.
 */
export async function cliGate(): Promise<CliGateResult> {
  let available: LitCliId[]
  try {
    ;({ available } = await window.suna.invoke('lit:cli-status', {}))
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  return gateFromStatus(useSettingsStore.getState().settings['lit.cli'], available)
}

/* ---------------------------------------------------------------- runner -- */

interface DirectedSpec {
  key: string
  /** One-line transcript label — the user-side bubble, never the full prompt. */
  title: string
  prompt: string
  /** Child cwd and confinement root: the project dir, or repoRoot for repair. */
  dir: string
  allowedTools: string[]
  useMcp: boolean
  successNote: string
}

async function runDirected(spec: DirectedSpec): Promise<AiAskOutcome> {
  const store = useAiActionsStore.getState()
  if (store.runs[spec.key] !== undefined) {
    // One run per key: the buttons disable while busy, so reaching this
    // means a race (double click) — refuse quietly rather than spawn twice.
    return { text: null, error: 'An AI action is already running here.' }
  }

  // Same placeholder-cancel dance as CommandPalette.tsx: the real handle
  // only exists once 'ai:ask' round-trips back with an askId, but a Cancel
  // click in that brief window must still kill the child once it arrives.
  let cancelRequested = false
  let liveCancel: (() => void) | null = null
  store.start(spec.key, 'Starting…', () => {
    cancelRequested = true
    if (liveCancel !== null) liveCancel()
  })

  return await new Promise<AiAskOutcome>((resolve) => {
    const settle = (outcome: AiAskOutcome): void => {
      useAiActionsStore.getState().finish(spec.key)
      if (outcome.text !== null) {
        useAgentChatStore.getState().pushExternalExchange(spec.title, outcome.text)
        useUiStore.getState().setStatusNote(spec.successNote)
      } else {
        // The CLI's message verbatim (§2c) — including plain 'Cancelled.'.
        useUiStore.getState().setStatusNote(outcome.error ?? 'AI action failed.')
      }
      resolve(outcome)
    }
    startAiAsk(
      spec.prompt,
      spec.dir,
      (status) => useAiActionsStore.getState().progress(spec.key, status),
      settle,
      { allowedTools: spec.allowedTools, useMcp: spec.useMcp, viaStdin: true, label: spec.title }
    )
      .then((handle) => {
        if (cancelRequested) {
          handle.cancel()
          return
        }
        liveCancel = handle.cancel
      })
      .catch((error: unknown) => {
        // The 'ai:ask' invoke itself rejected (e.g. dir outside the allowed
        // roots) — no child was spawned and no done event is coming.
        settle({ text: null, error: error instanceof Error ? error.message : String(error) })
      })
  })
}

/* ---------------------------------------------------------- entry points -- */

export interface CommentFixArgs extends CommentFixPromptInput {
  /** Project root: child cwd, and where .mcp.json lives. */
  rootDir: string
}

/** §3 — the comment card's ✦ AI button. Keyed 'comment:<id>'. */
export async function runCommentFix(args: CommentFixArgs): Promise<AiAskOutcome> {
  return runDirected({
    key: commentRunKey(args.commentId),
    title: shortTitle('✦ Fix comment', args.anchor.quote),
    prompt: commentFixPrompt(args),
    dir: args.rootDir,
    allowedTools: COMMENT_TOOLS,
    useMcp: true,
    successNote: 'AI addressed the comment — summary in the Agent panel.'
  })
}

export interface FigureEditArgs extends FigureEditPromptInput {
  /** Project root: child cwd, and where .mcp.json lives. */
  rootDir: string
}

/** §4 — the canvas Agent section's Send. Keyed 'figure:<figureId>'. */
export async function runFigureEdit(args: FigureEditArgs): Promise<AiAskOutcome> {
  return runDirected({
    key: figureRunKey(args.figureId),
    title: shortTitle('✦ Edit figure', args.instruction),
    prompt: figureEditPrompt(args),
    dir: args.rootDir,
    allowedTools: FIGURE_TOOLS,
    useMcp: true,
    successNote: 'AI edited the figure — summary in the Agent panel.'
  })
}

export interface UiRepairArgs extends UiRepairPromptInput {
  /** SUNA repo root from 'app:dev-info' — allow-listed by 'ai:repair-bundle'. */
  repoRoot: string
}

/** §5 — dev-only "Repair this UI". Single-flight, keyed 'repair'. */
export async function runUiRepair(args: UiRepairArgs): Promise<AiAskOutcome> {
  return runDirected({
    key: REPAIR_RUN_KEY,
    title: shortTitle('✦ Repair UI', args.report),
    prompt: uiRepairPrompt(args),
    dir: args.repoRoot,
    allowedTools: REPAIR_TOOLS,
    useMcp: false,
    successNote: 'AI repair finished — summary in the Agent panel.'
  })
}
