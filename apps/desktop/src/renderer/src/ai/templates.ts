/**
 * Prompt builders for the three directed AI actions (feature-plan-8 §2c).
 * Pure string assembly, no IO: every template shares one skeleton — role
 * line → TASK (the user's words verbatim) → CONTEXT (absolute paths, ids,
 * structured facts) → RULES (surgical constraints, which MCP verbs to use,
 * and the git prohibitions) → one closing line telling the agent its reply
 * is shown to the author. The MCP verb names embedded below are the
 * registered tool names from packages/agent/src/mcp/verbs.ts (+ comments.ts)
 * under the CLI's `mcp__suna__` prefix — verified against that registry, do
 * not rename here without renaming there.
 */

const CLOSING_LINE =
  'Reply with a concise summary of exactly what you changed; it is shown to the author in the app.'

const GIT_RULE = 'Never run destructive git commands, never commit.'

/** One skeleton for all three builders so section order can never drift. */
function assemble(
  role: string,
  task: readonly string[],
  context: readonly string[],
  rules: readonly string[]
): string {
  return [role, '', 'TASK', ...task, '', 'CONTEXT', ...context, '', 'RULES', ...rules, '', CLOSING_LINE].join(
    '\n'
  )
}

/**
 * One-line transcript label (feature-plan-8 §2c: "promptTitle = a one-line
 * label, not the full prompt") — pushExternalExchange renders it as the
 * user-side bubble, so it must stay short and single-line.
 */
export function shortTitle(prefix: string, text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine === '') return prefix
  const clipped = oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 59)}…`
  return `${prefix}: ${clipped}`
}

/* ------------------------------------------------------------- figure ---- */

export interface FigureEditPromptInput {
  figureId: string
  /** Absolute path to figures/<figureId>/figure.svg — the only editable file. */
  svgPath: string
  /** Physical artboard size in millimetres (width × height). */
  artboardMm: { width: number; height: number }
  /** Engine ids of the selected elements; empty = the whole figure. */
  selectedIds: readonly string[]
  /** Absolute PNG path from 'app:capture-rect'; null when the capture failed. */
  screenshotPath: string | null
  /** Journal profile name driving compliance, or null when none is set. */
  profileName: string | null
  /** Current compliance issue lines, already human-readable. */
  complianceIssues: readonly string[]
  /** The user's words from the Agent section textarea, verbatim. */
  instruction: string
}

export function figureEditPrompt(input: FigureEditPromptInput): string {
  const context = [
    `- Figure id: ${input.figureId}`,
    `- SVG file (absolute): ${input.svgPath}`,
    `- Artboard: ${input.artboardMm.width} × ${input.artboardMm.height} mm`,
    input.selectedIds.length > 0
      ? `- Selected element ids: ${input.selectedIds.join(', ')}`
      : '- Selected element ids: none — the whole figure is the target',
    ...(input.screenshotPath !== null ? [`- Screenshot (PNG, absolute): ${input.screenshotPath}`] : []),
    `- Journal profile: ${input.profileName ?? 'none'}`,
    ...(input.complianceIssues.length > 0
      ? ['- Current compliance issues:', ...input.complianceIssues.map((issue) => `  - ${issue}`)]
      : ['- Current compliance issues: none'])
  ]
  const rules = [
    `- Edit ${input.svgPath} only; touch no other file.`,
    '- Preserve all element ids and leave untouched markup exactly as it is.',
    '- Never regenerate the figure from source/plot.py — edit the SVG in place.',
    '- Check your work with mcp__suna__check_figure_compliance when you are done.',
    ...(input.screenshotPath !== null
      ? [
          `- The screenshot at ${input.screenshotPath} shows the current visual state; the gold overlay marks the selection.`
        ]
      : []),
    `- ${GIT_RULE}`
  ]
  return assemble(
    'You are editing one SVG figure inside a SUNA academic-writing project.',
    [input.instruction],
    context,
    rules
  )
}

/* ------------------------------------------------------------ comment ---- */

/** One thread entry, comment or reply, pre-formatted timestamps included. */
export interface CommentThreadEntry {
  author: string
  when: string
  body: string
}

export interface CommentFixPromptInput {
  /** Absolute path to the prose file the comment targets. */
  manuscriptPath: string
  commentId: string
  /** W3C-style text-quote anchor, live-snapshotted by the caller. */
  anchor: { quote: string; prefix: string; suffix: string }
  /** The comment first, then its replies, in order. */
  thread: readonly CommentThreadEntry[]
  /** ±400 chars of buffer text around the live range (or the located quote). */
  surrounding: string
  /** True when the quote no longer matches the prose exactly. */
  detached: boolean
  /** Optional explicit ask; v1 sends none — the comment body IS the instruction. */
  instruction?: string
}

export function commentFixPrompt(input: CommentFixPromptInput): string {
  const task =
    input.instruction !== undefined && input.instruction.trim() !== ''
      ? [input.instruction]
      : [
          'Address the review comment thread in CONTEXT. The comment body is the instruction; make the manuscript change it asks for.'
        ]
  const context = [
    `- Manuscript file (absolute): ${input.manuscriptPath}`,
    `- Comment id: ${input.commentId}`,
    `- Anchor quote: ${JSON.stringify(input.anchor.quote)}`,
    `- Anchor prefix: ${JSON.stringify(input.anchor.prefix)}`,
    `- Anchor suffix: ${JSON.stringify(input.anchor.suffix)}`,
    input.detached
      ? '- Anchor state: detached — the quote no longer matches the prose exactly; re-locate the intended region from the quote and the surrounding prose below.'
      : '- Anchor state: attached — the quote matches the prose.',
    '- Thread:',
    ...input.thread.map((entry) => `  ${entry.author} (${entry.when}): ${entry.body}`),
    '- Surrounding prose (about 400 chars each side of the anchor):',
    '---',
    input.surrounding,
    '---'
  ]
  const rules = [
    '- Make the minimal edit that addresses the comment using mcp__suna__edit_manuscript (exact find/replace) — never write_manuscript.',
    '- Then use mcp__suna__reply_comment to summarize the change on the thread.',
    '- Never resolve the thread — resolving is a human decision made in the app; your reply is the signal that it is ready for review.',
    '- If the comment is ambiguous, ask a question via mcp__suna__reply_comment instead of guessing.',
    '- Touch nothing outside the quoted region unless the comment demands it.',
    `- ${GIT_RULE}`
  ]
  return assemble(
    'You are addressing one reviewer comment on the manuscript of a SUNA academic-writing project.',
    task,
    context,
    rules
  )
}

/* ------------------------------------------------------------- repair ---- */

export interface UiRepairPromptInput {
  /** Absolute bug-reports/<stamp>-<slug>/ directory holding the bundle. */
  bundleDir: string
  /** Absolute shot.png path, or null when no rect was captured. */
  shotPath: string | null
  /** The structured context captured at the moment of the report. */
  context: Record<string, unknown>
  /** The user's report from the repair dialog textarea, verbatim. */
  report: string
}

export function uiRepairPrompt(input: UiRepairPromptInput): string {
  const context = [
    `- Bug-report bundle (absolute): ${input.bundleDir}`,
    input.shotPath !== null
      ? `- Screenshot of the broken UI (absolute): ${input.shotPath}`
      : '- Screenshot: none was captured for this report.',
    '- context.json contents:',
    JSON.stringify(input.context, null, 2)
  ]
  const rules = [
    `- Read ${input.shotPath !== null ? 'shot.png and ' : ''}context.json in the bundle before changing anything.`,
    '- The DOM path and class names in context.json map to components under apps/desktop/src/renderer/src.',
    '- Make a minimal fix.',
    '- Verify with pnpm typecheck and the nearest unit tests.',
    '- Do NOT commit; list the files you changed in your reply.',
    `- ${GIT_RULE}`
  ]
  return assemble(
    'You are fixing a UI bug in the SUNA source repository — the Electron app whose renderer produced this report. You are cd’d into the repo root.',
    [input.report],
    context,
    rules
  )
}

/* ------------------------------------------------------- letter draft ----- */

export interface LetterDraftPromptInput {
  /** Absolute path of the letter's prose file. */
  letterPath: string
  /** Manuscript-relative, for the MCP verbs. */
  letterFile: string
  /** Registry id, so the agent can read the sidecar through read_letter. */
  documentId: string
  /** The venue this letter addresses. */
  journalName: string
  letterKind: string
  /** Assertion ids the venue requires — named so the agent leaves them alone. */
  requiredAssertions: readonly string[]
}

/**
 * Draft the argument of a cover letter (document-kinds-ux.md §A.4).
 *
 * The rule that shapes this whole prompt: **the AI drafts the argument, the
 * human answers the affidavit.** A cover letter asserts that the work is not
 * under consideration elsewhere, that there are no competing interests, that
 * a named colleague read the draft — claims made to an editor over the
 * author's signature. So the prompt names every assertion marker explicitly
 * and forbids touching them, and no MCP verb exists that could write one
 * anyway.
 */
export function letterDraftPrompt(input: LetterDraftPromptInput): string {
  const task = [
    `Write the body of a ${input.letterKind} cover letter to ${input.journalName} for the manuscript in this project.`,
    'Replace ONLY the HTML comment placeholder that begins "<!-- Why this work matters" with two or three finished paragraphs.'
  ]
  const context = [
    `- Letter file (absolute): ${input.letterPath}`,
    `- Letter file (manuscript-relative, for the MCP verbs): ${input.letterFile}`,
    `- Letter registry id: ${input.documentId}`,
    `- Target venue: ${input.journalName}`,
    '- Read the manuscript first: mcp__suna__read_manuscript for the prose, mcp__suna__read_manuscript_meta for the title, abstract and significance statement, mcp__suna__list_outline for its shape.',
    '- Read context/PROJECT.md if it exists — it carries what the project is for in the authors\' own words.',
    `- Read mcp__suna__read_letter with documentId ${input.documentId} to see what ${input.journalName} requires and what is still unanswered.`,
    input.requiredAssertions.length === 0
      ? '- This venue states no required assertions.'
      : `- Assertion markers already in the letter, which you must NOT touch: ${input.requiredAssertions.join(', ')}.`
  ]
  const rules = [
    '- Edit the LETTER, never the manuscript. Use mcp__suna__write_document with the letter\'s documentId, or Edit on the absolute path.',
    '- Say what the work found, why it matters, and why it belongs in THIS venue. Ground every claim in the manuscript you just read — never invent a result, a number, or a comparison to other work.',
    '- Do NOT write, fill in, remove or reword any ⟦ unanswered — … ⟧ marker or any ::assert{…} directive. Those are the author\'s factual claims to an editor and only the author may answer them. Leave them exactly where they are.',
    '- Do not repeat the abstract. Several venues ask explicitly that the letter make the case in the authors\' own words; write for an editor deciding whether to send it out for review.',
    '- Keep the existing salutation, the closing, and the signature block exactly as they are.',
    '- Professional, plain, specific. No superlatives the manuscript does not support, no "paradigm shift", no filler.',
    `- ${GIT_RULE}`
  ]
  return assemble(
    'You are drafting the argument of a cover letter in a SUNA academic-writing project.',
    task,
    context,
    rules
  )
}
