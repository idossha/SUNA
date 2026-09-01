import { z } from 'zod';

/**
 * Reviewer-report segmentation (ARCHITECTURE §4.5, document-kinds-ux.md §B).
 *
 * Turns one blob — a pasted decision letter, or the text extracted from a
 * .docx/.pdf — into discrete reviewer points, DETERMINISTICALLY and offline.
 * Pass 1 is this module and needs no model at all; the AI split is offered
 * only for a block this cannot break up, writes to `_proposed/` and is always
 * confirmed by a human.
 *
 * Two properties are load-bearing.
 *
 * **Every point's text is a contiguous substring of the source.** Points carry
 * `[from, to)` offsets, never rewritten text. A reviewer's words are quoted
 * into a response document and must survive byte-exact; a segmenter that
 * reflowed or trimmed them would make that impossible to guarantee.
 *
 * **Nothing is silently dropped.** The real failure mode is not a mis-split,
 * it is a lost paragraph — exactly the defect in the evidence set, where a
 * hand-maintained response reached RE83 with RE58 missing. Every span of the
 * source is accounted for as a point, a recognised heading, or an explicitly
 * reported unassigned gap, and the three add up to the whole.
 */

export const ReviewPointSchema = z.object({
  /** Stable within one segmentation: "r1.3" = reviewer 1, third point. */
  id: z.string().min(1),
  reviewerIndex: z.number().int().positive(),
  /** 1-based within the reviewer. */
  pointIndex: z.number().int().positive(),
  /** The section heading this point sat under, when there was one. */
  section: z.string().min(1).nullable(),
  /** Offsets into the SOURCE. `verbatim` is always source.slice(from, to). */
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  verbatim: z.string().min(1),
  /** Why the segmenter believed this was a point. Shown on the card. */
  reason: z.string().min(1),
  /**
   * When the source was a RESPONSE document rather than a bare decision
   * letter, the author's own reply sits in the same paragraph as the point,
   * behind an "RE12:" marker. `from`/`to` then cover the reviewer's words
   * only, and this covers the reply — so re-importing last round's response
   * recovers both sides instead of quoting our own prose back at the
   * reviewer. Null when the source held no reply for this point.
   */
  reply: z
    .object({
      /** The number in the marker: 12 for "RE12:". */
      number: z.number().int().positive(),
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
      text: z.string(),
    })
    .nullable()
    .default(null),
});
export type ReviewPoint = z.infer<typeof ReviewPointSchema>;

export const ReviewerBlockSchema = z.object({
  index: z.number().int().positive(),
  /** The heading line as it appeared, e.g. "Reviewer #1 (Comments for the Author):". */
  label: z.string().min(1),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  points: z.array(ReviewPointSchema),
  /**
   * Section-heading line spans ("Major comments", "Minor issues") inside this
   * block. Recognised STRUCTURE, not content — so they belong to no point and
   * are not unassigned text either. Recorded so the coverage meter can tell
   * the two apart: reporting a heading we understood as a lost paragraph is
   * exactly the false alarm that makes a safety rail stop being read.
   */
  headings: z
    .array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }))
    .default([]),
});
export type ReviewerBlock = z.infer<typeof ReviewerBlockSchema>;

export interface UnassignedSpan {
  from: number;
  to: number;
  text: string;
}

export interface SegmentationResult {
  reviewers: ReviewerBlock[];
  /** Text before the first reviewer heading — usually the editor's letter. */
  preamble: string;
  /** Spans inside a reviewer block that landed in no point. */
  unassigned: UnassignedSpan[];
  /** Non-whitespace chars inside points ÷ non-whitespace chars inside blocks. */
  coverage: number;
  /** Reviewer blocks this could not break into more than one point. */
  unsplitReviewers: number[];
  /**
   * Reply numbers that the source skips — "RE57" and "RE59" present, "RE58"
   * absent. Only meaningful when importing a response document. This is the
   * defect in the evidence set that a hand-maintained numbering reached RE83
   * with RE58 silently missing; a machine that reads the numbers can say so.
   */
  replyGaps: number[];
}

interface Line {
  raw: string;
  /** Emphasis, pandoc escapes and span syntax removed — for MATCHING only. */
  probe: string;
  from: number;
  to: number;
}

/**
 * Strip the markup that survives a .docx → text conversion so the structural
 * patterns match. Used for RECOGNITION only; extraction always slices the
 * original.
 */
function probeOf(raw: string): string {
  return raw
    .replace(/\{\.[a-z-]+\}/gi, '') // pandoc span attributes: {.mark}
    .replace(/\[([^\]]*)\]/g, '$1') // […] span wrappers
    .replace(/[*_]{1,3}/g, '') // bold / italic markers
    .replace(/\\(?=[.)#])/g, '') // pandoc escapes: "2\." -> "2."
    .replace(/\\$/, '') // trailing hard-break backslash
    .replace(/\s+/g, ' ')
    .trim();
}

function toLines(source: string): Line[] {
  const out: Line[] = [];
  let offset = 0;
  for (const raw of source.split('\n')) {
    out.push({ raw, probe: probeOf(raw), from: offset, to: offset + raw.length });
    offset += raw.length + 1;
  }
  return out;
}

/** "Reviewer #1", "Reviewer 2:", "Referee #3 (Comments for the Author):" */
const REVIEWER_RE = /^(?:reviewer|referee)\s*#?\s*(\d+)\b/i;

/**
 * Section headings a reviewer report actually uses. Deliberately closed
 * lists: a heuristic that promoted any short line to a heading would swallow
 * the first sentence of a point.
 *
 * Three recognised shapes, because real reports use all three and a report
 * that mixes them is the common case, not the exotic one:
 *
 *  1. "Major comments", "Minor issues/questions", "Detailed comments:"
 *  2. a manuscript section used as a divider — "Methods", "Introduction:",
 *     "Figures" — which is how a reviewer walks the paper front to back
 *  3. a markdown ATX heading ("### COMMENTS PER SECTION") or a short
 *     ALL-CAPS line ("OVERALL", "LIMITATIONS AND SAFETY CONSIDERATIONS"),
 *     which is how a domain-organised report labels its blocks
 *
 * Getting these wrong is not cosmetic. An unrecognised heading is not
 * ignored — it is absorbed into the end of the point above it, so the last
 * point of every section quotes a stray word the reviewer never wrote there.
 */
const SECTION_RE =
  /^(major|minor|main|general|specific|substantive|additional|detailed|further|other)\b[^.?!]{0,40}?\b(comments?|issues?|points?|concerns?|revisions?|questions?|remarks?|suggestions?|feedback)\b\s*:?$/i;

/** A manuscript section used as a divider inside a reviewer's report. */
const MANUSCRIPT_SECTION_RE =
  /^(title|abstract|introduction|background|methods?|materials and methods|results?|discussion|conclusions?|limitations?|figures?|tables?|figures and tables|references|bibliography|supplement(?:ary|ary information|ary material)?|abbreviations|language)\b[^.?!]{0,20}\s*:?$/i;

/** A markdown ATX heading, whatever a .docx → text conversion left behind. */
const ATX_RE = /^#{1,6}\s+(\S.*?)\s*#*$/;

/**
 * A short ALL-CAPS line. Interior periods are allowed — "INDIVIDUALIZED VS.
 * GENERALIZED MODELS" is a heading, and rejecting it silently glued that
 * whole block onto the point above — but a TERMINAL "." "?" or "!" is not,
 * which is what keeps a shouted sentence out.
 */
const ALLCAPS_RE = /^[A-Z][A-Z0-9 .&/,'’()-]{2,58}[A-Z0-9)]$/;

/**
 * The author's reply marker inside a response document: "RE12:", "RE 12 :",
 * and the "[RE44:]{.mark}" that pandoc leaves when the reply was highlighted.
 */
const REPLY_RE = /\[?\bRE\s?(\d{1,3})\s*:\]?/;
const REPLY_RE_ALL = new RegExp(REPLY_RE.source, 'g');

/**
 * Recognise a heading line, returning its title, or null. `probe` is the
 * demarked line; matching never touches the offsets used for extraction.
 */
function headingTitle(probe: string): string | null {
  if (probe.length === 0) return null;
  const atx = ATX_RE.exec(probe);
  if (atx !== null) return atx[1]!;
  if (probe.length > 60) return null;
  if (SECTION_RE.test(probe)) return probe.replace(/:$/, '');
  if (MANUSCRIPT_SECTION_RE.test(probe)) return probe.replace(/:$/, '');
  // ALL-CAPS needs real letters, not "I." or an acronym list.
  if (ALLCAPS_RE.test(probe) && /[A-Z]{3}/.test(probe)) return probe.replace(/:$/, '');
  return null;
}

/** A numbered point: "1.", "2\.", "(3)", "4)" — at the head of a line. */
const NUMBERED_RE = /^\(?(\d{1,3})\s*[.)]/;

/** A bulleted point. */
const BULLET_RE = /^[-*•‣]\s+\S/;

const MIN_POINT_CHARS = 12;

export function segmentReviewerReport(source: string): SegmentationResult {
  const lines = toLines(source);

  // ---- 1. reviewer blocks ------------------------------------------------
  const heads = lines
    .map((line, i) => {
      const head = reviewerHeadOf(line);
      return head === null ? null : { ...head, line: i };
    })
    .filter((h): h is { index: number; label: string; splitAt: number | null; line: number } =>
      h !== null,
    );

  if (heads.length === 0) {
    // No reviewer delimiters at all: treat the whole thing as one reviewer, so
    // a single-reviewer report or a pasted fragment still segments.
    const block = buildBlock(1, 'Reviewer 1', lines, source);
    return finish([block], '', source);
  }

  const preamble = source.slice(0, lines[heads[0]!.line]!.from).trim();
  const blocks: ReviewerBlock[] = heads.map((head, n) => {
    const endLine = n + 1 < heads.length ? heads[n + 1]!.line : lines.length;
    const body = bodyLines(lines, head.line, endLine, head.splitAt);
    return buildBlock(head.index, head.label, body, source);
  });

  return finish(blocks, preamble, source);
}

/**
 * Is this line a reviewer delimiter, and if so where does the reviewer's
 * text start?
 *
 * Two forms occur, and only one of them was handled before:
 *
 *   **Reviewer #1**:                    ← its own line (a .docx export)
 *   Reviewer #1: The authors present…   ← inline (every editorial system's
 *                                         plain-text decision letter)
 *
 * The inline form is the one that arrives by email, and it is a LONG line, so
 * a short-line rule rejects it and the whole report collapses into a single
 * reviewer. `splitAt` is the absolute source offset just past the colon, so
 * the block starts mid-line without the label being re-attributed as content.
 */
function reviewerHeadOf(line: Line): { index: number; label: string; splitAt: number | null } | null {
  if (REVIEWER_RE.exec(line.probe) === null) return null;
  // Short line: the whole line is the heading. This also covers labels with a
  // parenthetical, e.g. "Reviewer #3 (Comments for the Author):".
  if (line.probe.length <= 80) {
    const m = REVIEWER_RE.exec(line.probe)!;
    return { index: Number(m[1]), label: line.probe, splitAt: null };
  }
  // Long line: only a delimiter if a colon closes a short label prefix.
  // "We agree with the point Reviewer 2 raised…" has no such colon and stays
  // prose, which is the case that makes the short-line rule worth keeping.
  const colon = line.raw.indexOf(':');
  if (colon < 0 || colon > 80) return null;
  const label = probeOf(line.raw.slice(0, colon + 1));
  const m = REVIEWER_RE.exec(label);
  if (m === null) return null;
  return { index: Number(m[1]), label, splitAt: line.from + colon + 1 };
}

/**
 * The lines of one reviewer's block. When the heading was inline, the first
 * element is the REMAINDER of the heading line — carrying its true offset, so
 * every verbatim cut from it is still a slice of the original source.
 */
function bodyLines(
  lines: Line[],
  headLine: number,
  endLine: number,
  splitAt: number | null,
): Line[] {
  const rest = lines.slice(headLine + 1, endLine);
  if (splitAt === null) return rest;
  const head = lines[headLine]!;
  const raw = head.raw.slice(splitAt - head.from);
  return [{ raw, probe: probeOf(raw), from: splitAt, to: head.to }, ...rest];
}

function buildBlock(
  index: number,
  label: string,
  body: Line[],
  source: string,
): ReviewerBlock {
  const points: ReviewPoint[] = [];
  const headings: { from: number; to: number }[] = [];

  // ---- 2. section headings inside the block ------------------------------
  const sections: { title: string | null; start: number; end: number }[] = [];
  let cursor = 0;
  let current: string | null = null;
  body.forEach((line, i) => {
    const title = headingTitle(line.probe);
    if (title !== null) {
      if (i > cursor) sections.push({ title: current, start: cursor, end: i });
      current = title;
      headings.push({ from: line.from, to: line.to });
      cursor = i + 1;
    }
  });
  if (cursor < body.length) sections.push({ title: current, start: cursor, end: body.length });
  if (sections.length === 0) sections.push({ title: null, start: 0, end: body.length });

  // ---- 3. points inside each section -------------------------------------
  for (const section of sections) {
    const slice = body.slice(section.start, section.end);
    const ranges = rangesIn(slice, section.title);

    for (const range of ranges) {
      const first = slice[range.start];
      const lastIdx = lastNonBlank(slice, range.start, range.end);
      if (first === undefined || lastIdx === null) continue;
      const from = first.from;
      const split = splitReply(source, from, slice[lastIdx]!.to);
      const verbatim = source.slice(from, split.to);
      if (verbatim.trim().length < MIN_POINT_CHARS) continue;
      points.push({
        id: `r${index}.${points.length + 1}`,
        reviewerIndex: index,
        pointIndex: points.length + 1,
        section: section.title,
        from,
        to: split.to,
        verbatim,
        reason: range.reason,
        reply: split.reply,
      });
    }
  }

  const from = body[0]?.from ?? 0;
  const to = body[body.length - 1]?.to ?? from;
  return { index, label, from, to, points, headings };
}

/**
 * Cut one section of a reviewer's block into point ranges.
 *
 * Two boundaries, applied together — which is the whole point. Treating the
 * two as alternatives is what broke: a block that opens with a paragraph and
 * then turns into a bullet list took the marker path, and every word before
 * the first bullet was silently dropped while the last bullet swallowed the
 * closing paragraph. Reviewers write exactly that shape all the time.
 *
 *  - a blank line ends a range (paragraph prose, and bullets spaced apart)
 *  - a marker line starts one (bullets and numbers packed with no blank
 *    between them, which is the other common list style)
 */
function rangesIn(
  slice: Line[],
  title: string | null,
): { start: number; end: number; reason: string }[] {
  const under = title === null ? '' : ` under “${title}”`;
  const starts: number[] = [];
  slice.forEach((line, i) => {
    if (line.probe === '') return;
    const isMarked = NUMBERED_RE.test(line.probe) || BULLET_RE.test(line.probe);
    const afterBlank = i === 0 || slice[i - 1]!.probe === '';
    if (isMarked || afterBlank) starts.push(i);
  });

  return starts.map((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1]! : slice.length;
    const probe = slice[start]!.probe;
    const reason = NUMBERED_RE.test(probe)
      ? `numbered point${under}`
      : BULLET_RE.test(probe)
        ? `bulleted point${under}`
        : `paragraph${under}`;
    return { start, end, reason };
  });
}

/**
 * Cut the author's reply off the end of a point.
 *
 * In a response document the reviewer's paragraph and our answer to it are
 * one paragraph, joined by "RE12:". Left alone the reply lands inside
 * `verbatim`, and the next round quotes our own prose back at the reviewer as
 * if they had written it. The reviewer's words end where the marker begins,
 * minus the whitespace between — so the offsets stay a real slice of the
 * source and no character is invented.
 */
function splitReply(
  source: string,
  from: number,
  to: number,
): { to: number; reply: ReviewPoint['reply'] } {
  const span = source.slice(from, to);
  const m = REPLY_RE.exec(span);
  if (m === null || m.index === 0) return { to, reply: null };
  const markerAt = from + m.index;
  let end = markerAt;
  while (end > from && /\s/.test(source[end - 1]!)) end -= 1;
  if (end - from < MIN_POINT_CHARS) return { to, reply: null };
  return {
    to: end,
    reply: {
      number: Number(m[1]),
      from: markerAt,
      to,
      text: source.slice(markerAt, to),
    },
  };
}

function lastNonBlank(lines: Line[], start: number, end: number): number | null {
  for (let i = end - 1; i >= start; i -= 1) {
    if (lines[i]!.probe !== '') return i;
  }
  return null;
}

function finish(
  reviewers: ReviewerBlock[],
  preamble: string,
  source: string,
): SegmentationResult {
  // Coverage is measured over the reviewer blocks only — the editor's covering
  // letter is not a reviewer point and should not drag the number down.
  const claimed: { from: number; to: number }[] = [];
  for (const r of reviewers) {
    for (const p of r.points) {
      claimed.push({ from: p.from, to: p.to });
      // A reply is text we understood and attributed, just not to the
      // reviewer. It is neither a point nor a lost paragraph, so it counts as
      // covered — otherwise importing a response document reads as half the
      // text missing.
      if (p.reply !== null) claimed.push({ from: p.reply.from, to: p.reply.to });
    }
  }
  claimed.sort((a, b) => a.from - b.from);

  // Headings are structure we recognised. They belong to no point, and they
  // are not lost text — so they come out of BOTH the denominator and the gap
  // scan, or every sectioned report reads as 95% with two "missing" spans.
  const headingSpans: { from: number; to: number }[] = [];
  for (const r of reviewers) headingSpans.push(...r.headings);

  let inBlocks = 0;
  for (const r of reviewers) inBlocks += nonWs(source.slice(r.from, r.to));
  for (const h of headingSpans) inBlocks -= nonWs(source.slice(h.from, h.to));
  let inPoints = 0;
  for (const c of claimed) inPoints += nonWs(source.slice(c.from, c.to));

  const skip = [...claimed, ...headingSpans].sort((a, b) => a.from - b.from);
  const unassigned: UnassignedSpan[] = [];
  for (const r of reviewers) {
    let at = r.from;
    for (const c of skip) {
      if (c.to <= r.from || c.from >= r.to) continue;
      if (c.from > at) pushGap(unassigned, source, at, c.from);
      at = Math.max(at, c.to);
    }
    if (at < r.to) pushGap(unassigned, source, at, r.to);
  }

  return {
    reviewers,
    preamble,
    unassigned,
    coverage: inBlocks === 0 ? 1 : inPoints / inBlocks,
    unsplitReviewers: reviewers.filter((r) => r.points.length <= 1).map((r) => r.index),
    replyGaps: gapsIn(replyNumbersIn(reviewers, source)),
  };
}

/**
 * Every reply number PRESENT in the reviewer blocks — read off the text, not
 * off the points.
 *
 * A point that answers two comments at once carries two markers and only the
 * first becomes its `reply`; counting attached replies then reports the second
 * as missing. On the evidence document that turned one true gap into seven,
 * six of them wrong — and a safety rail that cries wolf is one nobody reads.
 * The question this answers is "does the source skip a number", so the source
 * is what it reads.
 */
function replyNumbersIn(reviewers: ReviewerBlock[], source: string): number[] {
  const out: number[] = [];
  for (const r of reviewers) {
    const span = source.slice(r.from, r.to);
    for (const m of span.matchAll(REPLY_RE_ALL)) out.push(Number(m[1]));
  }
  return out;
}

/** Numbers missing from an otherwise consecutive run. [1,2,4] -> [3]. */
function gapsIn(numbers: number[]): number[] {
  if (numbers.length === 0) return [];
  const seen = new Set(numbers);
  const out: number[] = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n += 1) {
    if (!seen.has(n)) out.push(n);
  }
  return out;
}

/**
 * A gap only counts as unassigned if it holds real words. A blank line
 * between two points is not a lost paragraph, and reporting it as one would
 * make the meter cry wolf until nobody reads it.
 */
function pushGap(out: UnassignedSpan[], source: string, from: number, to: number): void {
  const text = source.slice(from, to);
  if (text.trim().length < MIN_POINT_CHARS) return;
  out.push({ from, to, text });
}

function nonWs(s: string): number {
  return s.replace(/\s/g, '').length;
}

/**
 * Every point's verbatim really is a contiguous slice of the source. Exported
 * so the importer can assert it before committing anything, and so the same
 * guarantee holds for AI-proposed splits.
 */
export function verbatimIsContiguous(result: SegmentationResult, source: string): boolean {
  for (const r of result.reviewers) {
    for (const p of r.points) {
      if (source.slice(p.from, p.to) !== p.verbatim) return false;
    }
  }
  return true;
}

/** Total points across every reviewer. */
export function pointCount(result: SegmentationResult): number {
  return result.reviewers.reduce((n, r) => n + r.points.length, 0);
}
