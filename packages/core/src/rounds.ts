import { z } from 'zod';

/**
 * Rounds — the development ledger (ADR-009, feature-plan-12 §3 and §6).
 *
 * A manuscript moves through rounds after the analysis is done: internal
 * circulations to co-authors, and external submission/review/revision cycles.
 * `rounds/<id>/` is the record of one of those.
 *
 * The placement rule, stated once and obeyed everywhere:
 * **`manuscript/` is prose you edit; `rounds/` is the ledger.** Nothing under
 * `rounds/` is a file a human opens and types into — it holds freezes,
 * verbatim received text, and decisions.
 *
 * The sharpest consequence is the reviewer point. A reviewer's words live in
 * `rounds/<id>/reviewers/*.json` and never in a file the author edits, which
 * makes immutability STRUCTURAL rather than a rule someone has to remember.
 * Editing a reviewer's words is misconduct; this makes it require deliberate
 * JSON surgery instead of a keystroke.
 */

export const RoundKindSchema = z.enum(['internal', 'external']);
export type RoundKind = z.infer<typeof RoundKindSchema>;

export const RoundStateSchema = z.enum([
  'open',
  'out',
  'returned',
  'closed',
]);
export type RoundState = z.infer<typeof RoundStateSchema>;

/**
 * The decision that closed an external round. 'withdrawn' and 'transferred'
 * are real outcomes and are not failures of the model.
 */
export const RoundDecisionSchema = z.enum([
  'accept',
  'minor-revision',
  'major-revision',
  'reject',
  'reject-with-resubmission',
  'transferred',
  'withdrawn',
]);
export type RoundDecision = z.infer<typeof RoundDecisionSchema>;

/**
 * A freeze is BOTH an annotated git tag and a text snapshot.
 *
 * The tag makes the round a first-class thing in the history the author
 * already has. The snapshot exists because a returned .docx has to be
 * anchored against exactly what the co-author saw, and `git show` cannot
 * answer that when the tree was dirty at freeze time — which it routinely is.
 */
export const FreezeSchema = z.object({
  /** Annotated tag name, e.g. 'round/2-nature-neuro'. Null if git was absent. */
  tag: z.string().min(1).nullable(),
  /** Commit the tag points at. Null when there was no commit to point at. */
  commit: z.string().min(1).nullable(),
  at: z.iso.datetime(),
  /**
   * True when the working tree had uncommitted changes at freeze time. A
   * freeze over a dirty tree is a freeze of something not in git, so the
   * snapshot is the only record of it and the UI says so.
   */
  dirty: z.boolean(),
  /**
   * Snapshot files, round-relative: 'frozen/manuscript.md',
   * 'frozen/comments.json', … Recorded rather than assumed so a reader can
   * tell a freeze that captured comments from one that predates that.
   */
  files: z.array(z.string().min(1)).default([]),
  /** sha256 of each snapshot file, same order as `files`. */
  hashes: z.array(z.string().min(1)).default([]),
});
export type Freeze = z.infer<typeof FreezeSchema>;

/**
 * One reviewer's point, exactly as received. IMMUTABLE.
 *
 * `verbatim` is a contiguous slice of `sourceText` retained beside it, and the
 * importer asserts that before committing. Nothing in the app offers an edit
 * control for this text — the only operations are split and merge, which
 * re-derive from the retained source and cannot introduce a character the
 * reviewer did not write.
 */
export const ReviewPointRecordSchema = z.object({
  id: z.string().min(1),
  reviewerIndex: z.number().int().positive(),
  pointIndex: z.number().int().positive(),
  section: z.string().min(1).nullable(),
  verbatim: z.string().min(1),
  /** Offsets into the reviewer's retained source text. */
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  /** How the segmenter found it, kept so a reader can audit the split. */
  reason: z.string().min(1),
});
export type ReviewPointRecord = z.infer<typeof ReviewPointRecordSchema>;

/**
 * The author's state on one point. This is the ONLY mutable half, and it
 * lives beside the point rather than inside it.
 *
 * 'rebutted' — we disagree, and here is why — is a first-class outcome, not a
 * failure state. Every real response letter contains several, and a tool that
 * models only compliance quietly pressures authors into conceding points they
 * should defend.
 */
export const PointStatusSchema = z.enum([
  'unaddressed',
  'drafted',
  'done',
  'rebutted',
]);
export type PointStatus = z.infer<typeof PointStatusSchema>;

export const PointStateSchema = z.object({
  pointId: z.string().min(1),
  status: PointStatusSchema.default('unaddressed'),
  /** Identity/author id of whoever owns this point. */
  assignee: z.string().min(1).nullable().default(null),
  /**
   * The author's reply, in SciMark, written against this point.
   *
   * This is state ON the point, not prose in `manuscript/` — it sits in the
   * mutable half beside the verbatim it answers, which is the only place a
   * reply can live without either being editable next to the reviewer's words
   * or being stranded in a response document that has no idea which point it
   * is answering. The response document is DERIVED from these at format time
   * (`::reply`), the same way numbering is.
   */
  reply: z.string().default(''),
  /**
   * Links from this point to spans of a document that answer it. The response
   * document's ::quote renders the linked span's CURRENT text at format time,
   * and the page/line reference is derived at export — never typed, never
   * stored, so it cannot go stale the way a hand-maintained one does.
   */
  links: z
    .array(
      z.object({
        documentId: z.string().min(1),
        /** Quote-based anchor, same discipline as comments.json. */
        quote: z.string().min(1),
        prefix: z.string().default(''),
        suffix: z.string().default(''),
      }),
    )
    .default([]),
});
export type PointState = z.infer<typeof PointStateSchema>;

/** One reviewer's report, as received. `rounds/<id>/reviewers/<n>.json`. */
export const ReviewerReportSchema = z.object({
  schemaVersion: z.literal(1),
  index: z.number().int().positive(),
  label: z.string().min(1),
  /**
   * The full text this reviewer's points were cut from, retained so a split
   * or merge can be re-derived and so a reader can verify every verbatim.
   */
  sourceText: z.string(),
  points: z.array(ReviewPointRecordSchema),
  /** Spans of sourceText that landed in no point, reported not discarded. */
  unassigned: z
    .array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }))
    .default([]),
});
export type ReviewerReport = z.infer<typeof ReviewerReportSchema>;

/** `rounds/<id>/round.json`. */
export const RoundSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: RoundKindSchema,
  /** Human label: "Round 2 — Nature Neuroscience", "Internal, pre-submission". */
  label: z.string().min(1),
  /** Venue for an external round; null for internal. */
  venue: z.string().min(1).nullable().default(null),
  state: RoundStateSchema.default('open'),
  createdAt: z.iso.datetime(),
  freeze: FreezeSchema.nullable().default(null),
  /** Who the freeze went out to, for an internal round. */
  recipients: z.array(z.string().min(1)).default([]),
  /** Per-point author state, keyed by point id. */
  pointStates: z.array(PointStateSchema).default([]),
  decision: RoundDecisionSchema.nullable().default(null),
  decidedAt: z.iso.datetime().nullable().default(null),
  /** Registry id of the response document answering this round, if any. */
  responseDocumentId: z.string().min(1).nullable().default(null),
});
export type Round = z.infer<typeof RoundSchema>;

/** `rounds/index.json` — the ledger's table of contents. */
export const RoundsIndexSchema = z.object({
  schemaVersion: z.literal(1),
  rounds: z.array(z.string().min(1)).default([]),
});
export type RoundsIndex = z.infer<typeof RoundsIndexSchema>;

export function emptyRoundsIndex(): RoundsIndex {
  return { schemaVersion: 1, rounds: [] };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** The author's state for a point, defaulting to unaddressed. */
export function pointStateFor(round: Round, pointId: string): PointState {
  return (
    round.pointStates.find((s) => s.pointId === pointId) ?? {
      pointId,
      status: 'unaddressed',
      assignee: null,
      reply: '',
      links: [],
    }
  );
}

/**
 * A point counts as addressed when it is done OR rebutted. Disagreeing with a
 * reviewer, in writing, is answering them.
 */
export function isAddressed(status: PointStatus): boolean {
  return status === 'done' || status === 'rebutted';
}

export interface RoundProgress {
  total: number;
  addressed: number;
  byReviewer: { index: number; total: number; addressed: number }[];
}

/** Progress for the points pane and the status bar. */
export function roundProgress(
  round: Round,
  reports: readonly ReviewerReport[],
): RoundProgress {
  const byReviewer = reports.map((r) => {
    const addressed = r.points.filter((p) => isAddressed(pointStateFor(round, p.id).status)).length;
    return { index: r.index, total: r.points.length, addressed };
  });
  return {
    total: byReviewer.reduce((n, r) => n + r.total, 0),
    addressed: byReviewer.reduce((n, r) => n + r.addressed, 0),
    byReviewer,
  };
}

/**
 * Every point still unaddressed. This is what blocks a revision export, named
 * one by one rather than counted — "Reviewer 2, point 3 is unaddressed" is
 * actionable in a way that "3 problems" is not.
 */
export function unaddressedPoints(
  round: Round,
  reports: readonly ReviewerReport[],
): ReviewPointRecord[] {
  const out: ReviewPointRecord[] = [];
  for (const report of reports) {
    for (const point of report.points) {
      if (!isAddressed(pointStateFor(round, point.id).status)) out.push(point);
    }
  }
  return out;
}

/**
 * Assert that every stored verbatim is still a contiguous slice of the
 * retained source. Cheap, and the one invariant that makes quoting a
 * reviewer safe.
 */
export function reportIsFaithful(report: ReviewerReport): boolean {
  return report.points.every((p) => report.sourceText.slice(p.from, p.to) === p.verbatim);
}
