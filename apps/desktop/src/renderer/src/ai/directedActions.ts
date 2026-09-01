/**
 * The one runner behind the three directed AI actions (DECISIONS 2026-08-17):
 * comment fix (§3), figure edit (§4), UI repair (§5). Each entry point
 * composes its template, starts a headless 'ai:ask' run with the action's
 * tool allowlist, and drives state/aiActions so any surface can render
 * progress/cancel by key while the launching component unmounts freely.
 * On success the answer lands in the Agent transcript (pushExternalExchange
 * keeps it the single place every AI answer is reviewed); on error the
 * status bar shows the CLI's message verbatim.
 */
import { LIT_CLI_IDS, type LitCliId, type LitCliPreference } from '@suna/core'
import type { AiEffort, AiModel } from '@suna/core'
import { startAiAsk, type AiAskOutcome } from '../palette/aiAsk'
import { useAgentChatStore } from '../state/agentChat'
import {
  commentRunKey,
  figureRunKey,
  pointRunKey,
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
import { letterDraftPrompt, type LetterDraftPromptInput } from './templates'
import { pointReplyPrompt, type PointReplyPromptInput } from './templates'
import { peerReviewLearnPrompt, type PeerReviewLearnPromptInput } from './templates'

/* ------------------------------------------------------------ allowlists -- */

// Verbatim from DECISIONS 2026-08-17. Main joins each list into ONE
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
const LETTER_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'mcp__suna__read_manuscript',
  'mcp__suna__read_manuscript_meta',
  'mcp__suna__list_outline',
  'mcp__suna__read_letter',
  'mcp__suna__check_letter',
  'mcp__suna__write_document'
  // Deliberately NOT here: anything that could answer an assertion. No such
  // verb exists, and the prompt forbids editing the markers by hand.
]
// Read-only by construction: a reply draft is a PROPOSAL the author accepts
// in the app, so this action has no write verb and no Edit/Write tool. The
// one thing it must do well is read the paper before answering for it.
const POINT_REPLY_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'mcp__suna__read_manuscript',
  'mcp__suna__read_manuscript_meta',
  'mcp__suna__list_outline',
  'mcp__suna__read_round',
  'mcp__suna__list_review_points',
  'mcp__suna__list_figures',
  'mcp__suna__read_bib'
]
// Read and nothing else. The letter's whole text travels in the prompt, so
// the agent has nothing it needs to fetch; this list exists to take Write,
// Edit and Bash away from it. It cannot be the empty array — main omits the
// --allowed-tools flag entirely for an empty list, which hands back the
// CLI's permissive default set.
const PEER_REVIEW_LEARN_TOOLS = ['Read']
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
 * round trip as the settings page and the same 'literature.cli' preference the
 * spawn itself will resolve against.
 */
export async function cliGate(): Promise<CliGateResult> {
  let available: LitCliId[]
  try {
    ;({ available } = await window.suna.invoke('lit:cli-status', {}))
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  return gateFromStatus(useSettingsStore.getState().settings['literature.cli'], available)
}

/* ---------------------------------------------------------------- runner -- */

interface DirectedSpec {
  key: string
  /** Per-task model tier; omit to use the project/global setting. */
  model?: AiModel
  /** Per-task reasoning effort; omit to use the project/global setting. */
  effort?: AiEffort
  /** One-line transcript label — the user-side bubble, never the full prompt. */
  title: string
  prompt: string
  /** Child cwd and confinement root: the project dir, or repoRoot for repair. */
  dir: string
  allowedTools: string[]
  useMcp: boolean
  successNote: string
  /**
   * Push the answer into the Agent transcript. True for every action that
   * CHANGED something — the transcript is where those are reviewed. False for
   * an action whose answer is itself the deliverable (a reply draft), which
   * would otherwise paste a whole response paragraph into the chat log the
   * moment its own review surface already shows it.
   */
  announce?: boolean
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
        if (spec.announce !== false) {
          useAgentChatStore.getState().pushExternalExchange(spec.title, outcome.text)
        }
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
      {
        allowedTools: spec.allowedTools,
        useMcp: spec.useMcp,
        viaStdin: true,
        label: spec.title,
        model: spec.model,
        effort: spec.effort
      }
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


export interface LetterDraftArgs extends LetterDraftPromptInput {
  /** Project root: child cwd, and where .mcp.json lives. */
  rootDir: string
  /** Chosen in the New Letter sheet for this run only. */
  model?: AiModel
  effort?: AiEffort
}

/** The New Letter sheet's "AI draft" mode. Keyed 'letter:<documentId>'. */
export async function runLetterDraft(args: LetterDraftArgs): Promise<AiAskOutcome> {
  return runDirected({
    key: letterRunKey(args.documentId),
    title: shortTitle('✦ Draft letter', args.journalName),
    prompt: letterDraftPrompt(args),
    dir: args.rootDir,
    allowedTools: LETTER_TOOLS,
    useMcp: true,
    model: args.model,
    effort: args.effort,
    successNote: 'AI drafted the letter — review the change before sending.'
  })
}

export function letterRunKey(documentId: string): string {
  return `letter:${documentId}`
}


export interface PointReplyArgs extends PointReplyPromptInput {
  /** Project root: child cwd, and where .mcp.json lives. */
  rootDir: string
  /** The point being answered — the run key, so the card can find its own run. */
  pointId: string
  /** Chosen on the card for this run only; omitted falls back to the setting. */
  model?: AiModel
  effort?: AiEffort
}

/**
 * The ✦ button beside one reply box: draft a reply, or polish the one there.
 * Keyed 'point:<pointId>', so the busy indicator and the arriving proposal
 * both survive the card unmounting mid-run — which it does constantly, since
 * continuous mode scrolls cards in and out and the mode toggle replaces all
 * of them.
 *
 * The answer does NOT land in the box. It is stored as a proposal the author
 * accepts or discards, because a reply to a referee is signed by them and a
 * box that silently fills itself with someone else's prose is how an
 * unreviewed sentence reaches an editor.
 */
export async function runPointReply(args: PointReplyArgs): Promise<AiAskOutcome> {
  const key = pointRunKey(args.pointId)
  useAiActionsStore.getState().clearProposal(key)
  const outcome = await runDirected({
    key,
    title: shortTitle(args.mode === 'polish' ? '✦ Polish reply' : '✦ Draft reply', args.pointLabel),
    prompt: pointReplyPrompt(args),
    dir: args.rootDir,
    allowedTools: POINT_REPLY_TOOLS,
    useMcp: true,
    model: args.model,
    effort: args.effort,
    announce: false,
    successNote:
      args.mode === 'polish'
        ? 'AI polished the reply — review it before you keep it.'
        : 'AI drafted a reply — review it before you keep it.'
  })
  if (outcome.text !== null) useAiActionsStore.getState().propose(key, stripFence(outcome.text))
  return outcome
}

/**
 * The prompt forbids a code fence and models mostly obey, but a reply that
 * arrives wrapped in ``` would be pasted verbatim into a response letter. One
 * cheap unwrap is worth more than trusting the instruction.
 */
export function stripFence(text: string): string {
  const trimmed = text.trim()
  const fence = /^```[a-z]*\n([\s\S]*)\n```$/.exec(trimmed)
  return (fence?.[1] ?? trimmed).trim()
}


export interface PeerReviewLearnArgs extends PeerReviewLearnPromptInput {
  /** Project root: child cwd and the confinement boundary. */
  rootDir: string
  model?: AiModel
  effort?: AiEffort
}

export const PEER_REVIEW_LEARN_KEY = 'peer-review-learn'

/**
 * Read a group's reply conventions off a response letter they already sent
 * (the approval sheet's "Learn from a past letter" source).
 *
 * Read-only and MCP-less: the letter's text is in the prompt, so the agent
 * has nothing to fetch, and its answer is a proposal a human must approve
 * before it becomes the AI's instructions. Single-flight — one sheet, one
 * document at a time.
 */
export async function runPeerReviewLearn(args: PeerReviewLearnArgs): Promise<AiAskOutcome> {
  const outcome = await runDirected({
    key: PEER_REVIEW_LEARN_KEY,
    title: shortTitle('✦ Learn reply style', args.sourcePath.split('/').pop() ?? ''),
    prompt: peerReviewLearnPrompt(args),
    dir: args.rootDir,
    allowedTools: PEER_REVIEW_LEARN_TOOLS,
    useMcp: false,
    model: args.model,
    effort: args.effort,
    announce: false,
    successNote: 'Read the conventions from your letter — review them before approving.'
  })
  return outcome.text === null ? outcome : { ...outcome, text: stripFence(outcome.text) }
}
