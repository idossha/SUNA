/**
 * `context/PEER-REVIEW.md` — how this group answers reviewers.
 *
 * Kept in core rather than in the agent's context layer because both sides
 * need it: the layer SEEDS the file when a project is healed, and the round
 * workspace OFFERS to fill it the first time somebody answers a point. Those
 * are the same document, and a second copy of it would drift.
 *
 * Why the file exists at all. Everything else an agent needs to answer a
 * referee is already somewhere it can read — the reviewer's words are in the
 * round, the claims are in the manuscript, the conventions of the field are
 * in its training. What is written nowhere is the set of judgements this
 * particular group has already made: whether a reply quotes the revised text
 * or points at it, how much of a disagreement to voice, whether the letter
 * opens by thanking the editor. Those are stable across every point of every
 * round, and without them the model guesses — competently, in a register
 * that is not yours.
 *
 * The suggested form below is not invented. Its shape is the consensus one
 * across published response letters — point-by-point, verbatim comment then
 * reply, the revised text quoted so the editor need not open the manuscript
 * — and its specifics were read off two real response documents in this
 * user's own corpus (a Nature Neuroscience reply-to-referees and a
 * methods-paper response): the `RE:` prefix, revised prose quoted inline in
 * quotation marks, `Done.` for a trivial fix, explicit cross-references
 * between points ("this point is addressed above"), reasoned refusals that
 * name why the requested work would not be sound, and per-point ownership
 * marked for co-authors. A user who keeps every default is therefore
 * keeping observed practice, not a guess.
 */

import { z } from 'zod';

/** Fixed name, under the project's `context/` directory. */
export const PEER_REVIEW_FILE = 'PEER-REVIEW.md';

/**
 * Marker on the seeded file. Its presence means nobody has answered the
 * questions yet, which is what the round workspace's first-run offer keys
 * off. A user who fills the file in and deletes the line will never be
 * asked again, and neither will one who simply answers a section — the
 * unfilled test looks at content, not just at this line.
 */
export const PEER_REVIEW_SEED_MARKER = '<!-- suna:peer-review-unanswered -->';

/**
 * The stub written at heal time. Deliberately near-empty: a project that
 * never runs a review round should not carry a page of advice it did not
 * ask for, and the round workspace offers the full form at the moment it
 * first becomes relevant.
 */
export function peerReviewSeed(): string {
  return `# Answering reviewers

${PEER_REVIEW_SEED_MARKER}
<!-- Read verbatim by the AI before it drafts or polishes any reply to a reviewer point. Nobody has filled this in yet — SUNA offers a suggested starting point the first time you answer a point in a round, or you can simply write here in your own words. -->

*(not filled out yet)*
`;
}

/**
 * The suggested starting point, section by section.
 *
 * Structured rather than one blob of Markdown because the sheet offers it as
 * a list of decisions the user accepts or drops individually. A wall of text
 * gets one skim and a Save; five named conventions, each with a line saying
 * what it commits you to, get read. `summary` is what the card shows;
 * `body` is what lands in the file.
 *
 * Everything here is a real convention, not a preference invented to fill
 * the page — see the module comment for where each came from.
 */
export interface PeerReviewSection {
  id: string;
  title: string;
  /** One line on the card: what accepting this section commits you to. */
  summary: string;
  /** The Markdown written into the file, headed by `## title`. */
  body: string;
}

export const PEER_REVIEW_SECTIONS: readonly PeerReviewSection[] = [
  {
    id: 'voice',
    title: 'Voice',
    summary: 'First person plural, courteous and unservile; thank the reviewers once, not per point.',
    body: `- First person plural. Address the reviewer directly.
- Thank the reviewers ONCE, in the letter's opening paragraph to the editor — not at the top of every reply. Per-point thanks read as padding by the third one.
- Plain declarative sentences. Courteous and unservile: we are colleagues answering a colleague, not petitioners.
- No "we are excited to", "insightful comment", "we sincerely appreciate".`,
  },
  {
    id: 'shape',
    title: 'Shape of one reply',
    summary: 'What changed, where, and why — quoting the revised text inline so the editor need not open the paper.',
    body: `- Say what changed, where it changed, and why — in that order.
- Quote the revised manuscript text inline, in quotation marks, when the change is a sentence or a short passage. An editor should not have to open the manuscript to check that a point was answered.
- For a change too large to quote, name the section and summarize it in one sentence: "We now report runtimes for both search strategies (Methods, §2.4)."
- For a trivial fix — a typo, a mislabelled axis, a missing reference — "Done." plus the corrected text is a complete reply. Do not pad it.
- Give the substance, not the promise: "we now report r = 0.91" rather than "we have clarified this".`,
  },
  {
    id: 'disagreeing',
    title: 'Conceding and disagreeing',
    summary: 'Disagreement is normal and needs a stated reason; never concede a claim the paper supports.',
    body: `- Disagreement is a normal part of a response letter, not a failure. If the reviewer is mistaken, or is asking for work outside the scope of the paper, say so and give the reason.
- Acknowledge the concern behind the request before explaining why it does not hold. A rebuttal that never states what worried the reviewer reads as evasion.
- When declining requested work, name the specific reason — it would break compatibility with a published method, the manipulation would not isolate the effect claimed, the data required do not exist. "Beyond the scope of this paper" alone is not a reason.
- Never concede a claim the manuscript actually supports in order to seem agreeable.`,
  },
  {
    id: 'cross-references',
    title: 'Cross-references',
    summary: 'Answer a shared point once in full, and point the other reviewer at that answer.',
    body: `- When two reviewers raise the same issue, answer it once in full and point at that answer from the other: "This point is also addressed in our reply to Reviewer 1, point 3."
- Refer to points by reviewer and number, the way the letter numbers them.`,
  },
  {
    id: 'evidence',
    title: 'Evidence',
    summary: 'Numbers come from the manuscript; a change not yet made is written as a commitment, not a fact.',
    body: `- Every number, comparison and citation must come from the manuscript or the literature it already cites. Never invent a result or an analysis.
- Prefer the paper's own quantities to adjectives.
- Where a requested change has not been made yet, write the reply as the change that WILL be made, specific enough to be held to — never as though it were already in the file.`,
  },
  {
    id: 'house',
    title: 'House conventions',
    summary: 'A blank section for your own terminology, phrasings, and per-co-author ownership.',
    body: `- *(Terminology, preferred phrasings, things you never say. Names of co-authors who own particular kinds of point, if you divide them up.)*`,
  },
];

const SUGGESTION_HEADER = `# Answering reviewers

<!-- Read verbatim by the AI before it drafts or polishes any reply to a reviewer point. Change anything here — these are starting points, not rules, and what you write wins over SUNA's own defaults. Delete a section you do not care about. -->`;

/**
 * Compose the file from the sections the user kept. Passing no argument
 * yields the full suggestion; an empty list yields the header alone, which
 * is a legitimate "I will write this myself" answer and not an error.
 */
export function peerReviewSuggestion(
  sectionIds?: readonly string[],
): string {
  const chosen =
    sectionIds === undefined
      ? PEER_REVIEW_SECTIONS
      : PEER_REVIEW_SECTIONS.filter((s) => sectionIds.includes(s.id));
  const parts = chosen.map((s) => `## ${s.title}\n\n${s.body}`);
  return `${[SUGGESTION_HEADER, ...parts].join('\n\n')}\n`;
}

/**
 * Has anybody actually answered the questions in this file?
 *
 * Content-based rather than marker-based, so it stays right in both
 * directions: a user who deletes the marker but leaves the placeholder is
 * still unfilled, and a user who answers one section while leaving the
 * marker is not. What counts as content is any line that is not blank, not
 * a heading, not an HTML comment, and not an italic *(placeholder)* — the
 * shape both this seed and the templates beside it use for "your turn".
 */
export function peerReviewIsUnfilled(text: string | null): boolean {
  if (text === null) return true;
  // HTML comments can span lines; drop them wholesale before looking.
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '');
  for (const raw of withoutComments.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) continue;
    // A bullet or plain line whose whole content is an italic placeholder.
    const body = line.replace(/^[-*+]\s+/, '').trim();
    if (body === '') continue;
    if (/^\*\(.*\)\*$/s.test(body)) continue;
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* The approval gate                                                    */
/* ------------------------------------------------------------------ */

/**
 * Where the approved text came from. Recorded because "I accepted SUNA's
 * defaults" and "I wrote these myself" are different claims about the same
 * file, and an approval record that cannot tell them apart is worth less.
 */
export const PEER_REVIEW_SOURCES = ['suggested', 'imported', 'manual'] as const;
export const PeerReviewSourceSchema = z.enum(PEER_REVIEW_SOURCES);
export type PeerReviewSource = z.infer<typeof PeerReviewSourceSchema>;

/**
 * One human's recorded acceptance of the rules an AI will follow when it
 * drafts replies to referees, stored in `suna.json`.
 *
 * A response letter goes to an editor over the authors' names, and several
 * publishers now require disclosure of how AI was used in preparing it. So
 * SUNA will not draft a single reply until a person has read the guidelines
 * and said so. That is a deliberate gate and not a preference: the file is
 * the AI's instructions, and instructions nobody read are nobody's
 * responsibility.
 *
 * `contentHash` is what makes this a record rather than a checkbox — it
 * pins the approval to the exact bytes that were on screen. It is computed
 * in the main process from the file on disk, never passed in by a caller,
 * so it cannot record an approval of text that was never saved.
 *
 * Asked once per project. Editing the file afterwards does NOT re-arm the
 * gate: the person editing it is the person who approved it, and making
 * them re-confirm their own edit would train them to click past it.
 */
export const PeerReviewApprovalSchema = z.object({
  approvedAt: z.iso.datetime(),
  /** Local identity of whoever clicked. */
  approvedBy: z.string().min(1),
  source: PeerReviewSourceSchema,
  /** sha256 of context/PEER-REVIEW.md exactly as approved, lowercase hex. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Absolute path of the document the conventions were learned from. */
  learnedFrom: z.string().min(1).nullable().default(null),
});
export type PeerReviewApproval = z.infer<typeof PeerReviewApprovalSchema>;

/** The manifest block holding it. Additive and optional, like `settings`. */
export const ProjectApprovalsSchema = z.object({
  /** Null/absent means AI reply drafting is not permitted in this project. */
  peerReviewAi: PeerReviewApprovalSchema.nullish(),
});
export type ProjectApprovals = z.infer<typeof ProjectApprovalsSchema>;

/**
 * May this project's AI draft replies to reviewers? The single question the
 * gate asks, in one place so every surface agrees on the answer.
 */
export function peerReviewAiApproved(
  approvals: ProjectApprovals | null | undefined,
): boolean {
  return approvals?.peerReviewAi !== undefined && approvals.peerReviewAi !== null;
}
