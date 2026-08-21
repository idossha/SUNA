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
  /** The venue's stated requirements, one line each, with its own wording. */
  venueRequirements?: readonly string[]
  /** The exact placeholder comment the draft must replace. */
  placeholder?: string
}

/**
 * Draft the argument of a cover letter (document-kinds-ux.md §A.4).
 *
 * Two rules shape everything here.
 *
 * **The AI drafts the argument, the human answers the affidavit.** A cover
 * letter asserts that the work is not under consideration elsewhere, that
 * there are no competing interests, that a named colleague read the draft —
 * claims made to an editor over the author's signature. The prompt names
 * every assertion marker and forbids touching them, and no MCP verb exists
 * that could write one anyway.
 *
 * **A cover letter is an argument, not a summary.** The first version of this
 * prompt said "write two or three paragraphs" and got back a competent
 * abstract paraphrase. What an editor is deciding is whether to spend two
 * referees on this paper, so the prompt now names the three moves that
 * decision actually turns on — the gap, what was done about it, what it lets
 * the field do next — and gives concrete instructions about evidence,
 * length and register instead of hoping for them.
 */
export function letterDraftPrompt(input: LetterDraftPromptInput): string {
  const task = [
    `Write the body of a ${input.letterKind} cover letter to ${input.journalName} for the manuscript in this project.`,
    `Replace ONLY the placeholder comment that begins ${JSON.stringify(input.placeholder ?? '<!-- Why this work matters')} with finished prose. Everything else in the file stays exactly as it is.`,
    '',
    'BEFORE you write a single sentence, read the paper. In this order:',
    '  1. mcp__suna__read_manuscript_meta — title, abstract, significance statement, article type.',
    '  2. mcp__suna__list_outline — the shape of the argument and where its weight sits.',
    '  3. mcp__suna__read_manuscript — the actual prose. Read the Results and the Discussion properly; that is where the claims you are about to make to an editor live.',
    '  4. context/PROJECT.md if it exists — what the authors say the project is for, in their own words.',
    `  5. mcp__suna__read_letter with documentId ${input.documentId} — what ${input.journalName} requires and what is still unanswered.`
  ]

  const context = [
    `- Letter file (absolute): ${input.letterPath}`,
    `- Letter file (manuscript-relative, for the MCP verbs): ${input.letterFile}`,
    `- Letter registry id: ${input.documentId}`,
    `- Target venue: ${input.journalName}`,
    ...(input.venueRequirements === undefined || input.venueRequirements.length === 0
      ? [`- No cover-letter requirements have been researched for ${input.journalName}.`]
      : [`- What ${input.journalName} states about cover letters:`, ...input.venueRequirements.map((r) => `    ${r}`)]),
    input.requiredAssertions.length === 0
      ? '- This venue states no required assertions.'
      : `- Assertion markers already in the letter, which you must NOT touch: ${input.requiredAssertions.join(', ')}.`
  ]

  const rules = [
    'SHAPE — three paragraphs, in this order, and nothing else:',
    '  1. THE GAP AND THE CLAIM. Open with the specific thing the field could not do or did not know, then state in one sentence what this paper establishes. Name the actual result — the number, the effect, the comparison — not "important findings".',
    '  2. THE EVIDENCE AND ITS LIMITS. How the claim is supported, and where it is bounded. An editor trusts a letter that says what the work does not show; naming the limit honestly is a strength, not a hedge, and it is what separates this from a press release.',
    `  3. WHY THIS VENUE. What ${input.journalName}'s readership specifically can do with the result. Tie it to the breadth or the discipline this venue actually serves. Never a generic sentence that would fit any journal.`,
    '',
    'EVIDENCE:',
    '- Every number, comparison and claim must come from the manuscript you just read. If a fact is not in the paper, it does not go in the letter. Never invent a result, a statistic, a prior study, or a comparison to other work.',
    '- Prefer the paper\'s own specific quantities to adjectives. "r ≈ 0.95 across 90 contacts" persuades; "excellent agreement" does not.',
    '- If the manuscript genuinely does not support a claim the venue expects (novelty, breadth, clinical relevance), write what it DOES support and leave the gap visible rather than papering over it.',
    '',
    'REGISTER AND LENGTH:',
    '- 250–400 words for the three paragraphs. An editor reads this in under a minute.',
    '- Plain declarative sentences. No "paradigm shift", "unprecedented", "we are excited to", "novel and important", "sheds light on", "paves the way".',
    '- First person plural, present or present-perfect. Address the editor, not the reader of the paper.',
    '- Do not repeat the abstract. Several venues ask explicitly that the letter make the case in the authors\' own words; an editor has the abstract already and is looking for the judgement the abstract cannot carry.',
    '',
    'WHAT YOU MAY NOT TOUCH:',
    '- Do NOT write, fill in, remove or reword any ⟦ unanswered — … ⟧ marker or any ::assert{…} directive. Those are the author\'s factual claims to an editor and only the author may answer them. Leave every one exactly where it is, in place, untouched.',
    '- Keep the salutation, the closing line, and the signature block exactly as they are.',
    '- Edit the LETTER, never the manuscript. Use Edit on the absolute path above, or mcp__suna__write_document with the letter\'s documentId.',
    '',
    'FINISH:',
    `- Run mcp__suna__check_letter with documentId ${input.documentId} when you are done and fix anything it flags that is YOURS to fix — a missing assertion is the author's, but naming the wrong journal in the prose is yours.`,
    `- ${GIT_RULE}`
  ]

  return assemble(
    `You are drafting the argument of a cover letter to ${input.journalName} in a SUNA academic-writing project. The editor reading it is deciding whether to send the paper out for review at all.`,
    task,
    context,
    rules
  )
}

/* -------------------------------------------------------- point reply ---- */

/** One sibling point and how it was already answered — the consistency set. */
export interface SiblingReply {
  label: string
  verbatim: string
  reply: string
  status: string
}

export interface PointReplyPromptInput {
  /** 'draft' writes a reply into an empty box; 'polish' reworks the one there. */
  mode: 'draft' | 'polish'
  roundId: string
  /** Round label, e.g. "Round 2 — Nature Neuroscience". */
  roundLabel: string
  /** Venue for an external round; null for an internal circulation. */
  venue: string | null
  /** Editor's decision on the round, if one has been recorded. */
  decision: string | null
  /** "Reviewer 2, point 3" — how the app names this point to the author. */
  pointLabel: string
  /** The reviewer's words. Immutable, and quoted here so the agent sees them. */
  verbatim: string
  /** The section of the paper the point targets, when the importer found one. */
  section: string | null
  /** Enough of the reviewer's report around this point to read it in context. */
  reportContext: string
  /** Points already answered in this round — the reply must not contradict them. */
  siblings: readonly SiblingReply[]
  /** The reply currently in the box. Required for 'polish', empty for 'draft'. */
  currentReply: string
  /** context/PEER-REVIEW.md verbatim, or null when the file is absent/empty. */
  peerReviewGuidelines: string | null
  /** Optional extra instruction the author typed for this run. */
  instruction?: string
}

/**
 * Draft or polish the reply to ONE reviewer point (document-kinds-ux.md §C).
 *
 * The answer to this prompt is not a summary of work done — it IS the reply,
 * and it lands in the author's box as a proposal they accept or discard. So
 * this is the one template that overrides CLOSING_LINE: anything the agent
 * says about its own process would be pasted into a response letter.
 *
 * Two things make the reply good rather than merely fluent, and both are
 * context the agent cannot get from the point alone. **The manuscript has to
 * actually change**, or the reply is a promise — so the prompt sends it to
 * read the prose first and to name the real location of the change. **The
 * other replies in the round exist**, and a letter that concedes a framing in
 * point 4 and defends it in point 11 is worse than either answer alone, so
 * every already-written sibling reply is in CONTEXT.
 *
 * Nothing here may write: the reply is a proposal, the reviewer's words have
 * no write path at all, and the point's status stays the author's call.
 */
export function pointReplyPrompt(input: PointReplyPromptInput): string {
  const polishing = input.mode === 'polish'

  const task = [
    polishing
      ? `Rework the author's existing reply to ${input.pointLabel} below. Keep every claim, concession and disagreement it makes — you are improving how it reads and how well it is evidenced, not deciding the position again.`
      : `Write the author's reply to ${input.pointLabel} below.`,
    ...(input.instruction !== undefined && input.instruction.trim() !== ''
      ? ['', `The author adds: ${input.instruction.trim()}`]
      : []),
    '',
    'BEFORE you write a sentence, read what you are answering about:',
    '  1. mcp__suna__read_manuscript — the prose the point targets. A reply that describes a change nobody made is the one failure that matters here.',
    '  2. mcp__suna__list_outline — where the change would go, so you can name the section.',
    `  3. mcp__suna__list_review_points with roundId ${JSON.stringify(input.roundId)} — the rest of this round, if the sibling replies below are not enough.`,
    '  4. context/PROJECT.md and context/RULES.md — what this project is and how this group works.'
  ]

  const context = [
    `- Round: ${input.roundLabel} (id ${input.roundId})`,
    `- Venue: ${input.venue ?? 'internal circulation — no external venue'}`,
    `- Decision on the round: ${input.decision ?? 'none recorded yet'}`,
    `- Point: ${input.pointLabel}${input.section !== null ? ` · targets ${input.section}` : ''}`,
    '- The reviewer wrote, verbatim:',
    '---',
    input.verbatim,
    '---',
    ...(input.reportContext.trim() === ''
      ? []
      : ['- Surrounding text from the same reviewer, for context:', '---', input.reportContext, '---']),
    ...(input.siblings.length === 0
      ? ['- No other point in this round has been answered yet.']
      : [
          '- Replies already written in this round. Yours must be consistent with these — same position, same terminology, no promise that contradicts one of them:',
          ...input.siblings.flatMap((s) => [
            `  ${s.label} [${s.status}] — reviewer: ${JSON.stringify(clip(s.verbatim, 240))}`,
            `      our reply: ${JSON.stringify(clip(s.reply, 400))}`
          ])
        ]),
    ...(polishing
      ? ['- The reply as the author currently has it:', '---', input.currentReply, '---']
      : []),
    ...(input.peerReviewGuidelines === null
      ? ['- context/PEER-REVIEW.md is empty or absent — no house conventions were given for this project.']
      : [
          "- context/PEER-REVIEW.md — how this group answers reviewers. These are the author's own standing instructions and they outrank the general guidance in RULES below where the two disagree:",
          '---',
          input.peerReviewGuidelines,
          '---'
        ])
  ]

  const rules = [
    'WHAT A GOOD REPLY DOES:',
    '- Answer the point that was actually made. If the reviewer asked two things, answer both; if they asked one, do not answer three.',
    '- Say what changed and where — the section, and the substance of the change. "We have revised the Methods" is not a reply; "We now report the split-half reliability (Methods, §2.3) and it is r = 0.91" is.',
    '- Cite the manuscript\'s own numbers and text. Never invent a result, a citation, an analysis you have not seen, or a change that is not in the prose you read.',
    '- Where the manuscript does not yet contain the change, write the reply as the change the authors WILL make and keep it specific enough to hold them to it. Do not claim it is already done.',
    '',
    'DISAGREEING:',
    '- Disagreement is a legitimate reply and this project models it as a first-class outcome. If the reviewer is wrong, or is asking for work outside the scope of the paper, say so plainly and give the reason — do not concede to be agreeable.',
    '- A rebuttal still acknowledges what the reviewer was worried about before it explains why the concern does not hold.',
    '',
    'REGISTER AND LENGTH:',
    '- One to three short paragraphs. A reviewer reads dozens of these.',
    '- Plain, courteous, unservile. No "we thank the reviewer for this insightful comment", no "we are grateful for the opportunity", no flattery of any kind — the letter thanks them once, elsewhere.',
    '- First person plural. Address the reviewer in the third person ("the reviewer notes") only if PEER-REVIEW.md says to; otherwise write to them directly.',
    '- SciMark: @fig:, @tab: and citation keys resolve at export, so use them rather than typing "Figure 3".',
    '',
    'QUOTING THE REVISED MANUSCRIPT:',
    '- When the change is a sentence or a short passage, quote it — an editor should not have to open the manuscript to check that a point was answered.',
    '- Write a quoted excerpt as its own block, opened by a line reading `::quote` and closed by a line reading `::`. Wrap the words that are NEW or CHANGED in `+++` on both sides. The response letter renders the excerpt as the paper\'s voice and the marked words in red, the way this group\'s previous letters do; the marks themselves never reach the reader.',
    '- Example:',
    '    RE: We now report both runtimes (Methods, §2.4):',
    '    ',
    '    ::quote',
    '    The exhaustive search completed in 4.1 h. +++The genetic algorithm converged in 22 min.+++',
    '    ::',
    '- Mark ONLY text you actually saw change, or that the reply commits the authors to writing. Marking unchanged prose as new is a false claim to the editor.',
    '- For a change too large to quote, name the section and summarize it in one sentence instead. Do not open a quote block you cannot fill with real manuscript text.',
    '',
    'WHAT YOU MAY NOT DO:',
    "- Do NOT edit any file. Not the manuscript, not the round, not the reviewer's text. This run is read-only: your answer is a PROPOSAL shown to the author, who accepts or discards it.",
    '- Do NOT set the point\'s status. Whether this counts as done or rebutted is the author\'s judgement.',
    '- Do NOT quote the reviewer back to them at length. They know what they wrote.',
    `- ${GIT_RULE}`,
    '',
    'YOUR ANSWER:',
    '- Reply with the text of the response and NOTHING else. No preamble, no "Here is a draft", no explanation of your choices, no surrounding quotes or code fence. The whole of what you send is pasted into the response letter.',
    ...(polishing
      ? ['- If the existing reply is already good, send it back with only the changes that genuinely improve it.']
      : [])
  ]

  return [
    `You are writing one author's reply to one reviewer point in a SUNA academic-writing project. This text goes into the response letter a reviewer and an editor will read beside the revised manuscript.`,
    '',
    'TASK',
    ...task,
    '',
    'CONTEXT',
    ...context,
    '',
    'RULES',
    ...rules
  ].join('\n')
}

/** Sibling replies are context, not the subject — long ones are clipped. */
function clip(text: string, n: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= n ? oneLine : `${oneLine.slice(0, n - 1)}…`
}

/* ------------------------------------------------ peer-review learning ---- */

export interface PeerReviewLearnPromptInput {
  /** Absolute path of the document the conventions are read off. */
  sourcePath: string
  /** Its extracted plain text — the app extracted it, the agent needn't. */
  sourceText: string
  /** Section titles SUNA's own suggested form uses, as a starting shape. */
  sectionTitles: readonly string[]
}

/**
 * Read a group's response-letter conventions off a letter they already sent.
 *
 * This exists because the alternative — asking an author to write down their
 * house style from memory — produces an aspirational document. What a group
 * actually does is in the letters it has already sent, and those are sitting
 * on the author's disk.
 *
 * The single hard rule here is DESCRIBE, DO NOT PRESCRIBE. A model asked to
 * "write guidelines from this letter" reliably returns generic advice about
 * being polite and thorough, because that is what the phrase "guidelines"
 * pulls from. Asked to report only conventions it can point at in the text,
 * with the evidence, it returns the things that are actually specific to
 * this group: that replies open "RE:", that revised prose is quoted inline
 * in quotation marks, that a typo gets "Done." and nothing more.
 *
 * The answer IS the file — a human reads it, approves it, and it becomes the
 * AI's standing instructions — so this template overrides CLOSING_LINE, and
 * the output contract is strict Markdown with no preamble.
 */
export function peerReviewLearnPrompt(input: PeerReviewLearnPromptInput): string {
  const task = [
    'Read the response-to-reviewers document below and write down the conventions its authors actually follow, as instructions for writing the NEXT such letter in the same voice.',
    '',
    'Work from evidence, not from what a good response letter is supposed to look like. For each convention, satisfy yourself that you could point at two or more places in the document where it holds. If you cannot, leave it out — a short accurate document is worth far more here than a complete-looking one.'
  ]

  const context = [
    `- Source document (absolute): ${input.sourcePath}`,
    '- Its full text follows between the markers. This is the ONLY evidence; do not go looking for other files.',
    '<<<DOCUMENT',
    input.sourceText,
    'DOCUMENT>>>'
  ]

  const rules = [
    'WHAT TO LOOK FOR — these are the things that vary between groups and that a model cannot guess:',
    '- How a reply opens and closes. Is there a prefix ("RE:", "Response:")? Is the reviewer thanked per point, once at the top, or not at all? Is the reviewer addressed directly or in the third person?',
    '- Whether revised manuscript text is quoted inline, paraphrased, or merely pointed at by section — and if quoted, how it is marked.',
    '- What a reply to a trivial correction looks like, versus a substantive one.',
    '- How disagreement is expressed: how directly, whether the reviewer\'s concern is restated first, what kind of reason is given for declining requested work.',
    '- How a point raised by two reviewers is handled, and how the letter refers to its own other replies.',
    '- Register: sentence length, formality, first person plural or singular, recurring phrases, and anything conspicuously ABSENT (e.g. no superlatives, no apologies).',
    '- Anything structural: numbering, per-reviewer headings, whether changes are said to be highlighted in the manuscript.',
    '',
    'WHAT NOT TO WRITE:',
    '- No generic advice ("be clear", "be respectful", "address all comments"). If it would be true of every response letter ever written, it tells the next draft nothing.',
    '- Do not invent a convention because the document is silent on it. Silence is a real finding; omit the topic.',
    '- Do not summarize what the paper is about, and do not reproduce the reviewers\' comments or the authors\' replies at length. Short illustrative fragments only.',
    '- Do not copy any scientific content: no results, no numbers, no citations from the source. Conventions only — this document is about HOW they wrote, never WHAT they said.',
    '',
    'FORMAT — a Markdown document, exactly this shape and nothing else:',
    '- One `# Answering reviewers` heading at the top.',
    `- Then \`##\` sections. Use these titles where they fit what you found, and add or drop sections freely: ${input.sectionTitles.join(', ')}.`,
    '- Under each, imperative bullets addressed to whoever writes the next letter — "Open each reply with RE:", not "The authors open each reply with RE:".',
    '- Where a convention is worth an example, put a short quoted fragment on the bullet.',
    '- 25 bullets at the very most, across all sections.',
    '- Write each bullet as ONE unbroken line, however long it runs. Never hard-wrap a bullet at a column width and never start a new line mid-sentence — in this project a newline begins a new block, so a wrapped sentence becomes two broken ones in the file.',
    '',
    'YOUR ANSWER:',
    '- Reply with the Markdown document and NOTHING else. No preamble, no "Here is what I found", no closing summary, no code fence. What you send is shown to the author for approval and saved as the file verbatim.',
    '- Do NOT write any file, and do not use any tool that changes anything. This run only reads and reports.',
    `- ${GIT_RULE}`
  ]

  return [
    'You are reading one research group\'s past response-to-reviewers letter in order to describe, precisely, the conventions they write by. Another AI will follow what you write when it drafts their next letter, and a human will read and approve it first.',
    '',
    'TASK',
    ...task,
    '',
    'CONTEXT',
    ...context,
    '',
    'RULES',
    ...rules
  ].join('\n')
}
