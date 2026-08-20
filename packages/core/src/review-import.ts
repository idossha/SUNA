import { z } from 'zod';

/**
 * Reviewer-report segmentation (feature-plan-12 §6, document-kinds-ux.md §B).
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
 * Section headings a reviewer report actually uses. Deliberately a closed
 * list: a heuristic that promoted any short line to a heading would swallow
 * the first sentence of a point.
 */
const SECTION_RE =
  /^(major|minor|main|general|specific|substantive|additional)\b[^.?!]{0,40}?\b(comments?|issues?|points?|concerns?|revisions?|questions?|remarks?)\b\s*:?$/i;

/** A numbered point: "1.", "2\.", "(3)", "4)" — at the head of a line. */
const NUMBERED_RE = /^\(?(\d{1,3})\s*[.)]/;

/** A bulleted point. */
const BULLET_RE = /^[-*•‣]\s+\S/;

const MIN_POINT_CHARS = 12;

export function segmentReviewerReport(source: string): SegmentationResult {
  const lines = toLines(source);

  // ---- 1. reviewer blocks ------------------------------------------------
  const heads: { index: number; label: string; line: number }[] = [];
  lines.forEach((line, i) => {
    const m = REVIEWER_RE.exec(line.probe);
    // A reviewer heading is a SHORT line. "Reviewer 2 asked us to…" inside a
    // paragraph is prose, not a delimiter.
    if (m !== null && line.probe.length <= 80) {
      heads.push({ index: Number(m[1]), label: line.probe, line: i });
    }
  });

  if (heads.length === 0) {
    // No reviewer delimiters at all: treat the whole thing as one reviewer, so
    // a single-reviewer report or a pasted fragment still segments.
    const block = buildBlock(1, 'Reviewer 1', lines, 0, lines.length, source);
    return finish([block], '', source);
  }

  const preamble = source.slice(0, lines[heads[0]!.line]!.from).trim();
  const blocks: ReviewerBlock[] = heads.map((head, n) => {
    const startLine = head.line + 1;
    const endLine = n + 1 < heads.length ? heads[n + 1]!.line : lines.length;
    return buildBlock(head.index, head.label, lines, startLine, endLine, source);
  });

  return finish(blocks, preamble, source);
}

function buildBlock(
  index: number,
  label: string,
  lines: Line[],
  startLine: number,
  endLine: number,
  source: string,
): ReviewerBlock {
  const body = lines.slice(startLine, endLine);
  const points: ReviewPoint[] = [];
  const headings: { from: number; to: number }[] = [];

  // ---- 2. section headings inside the block ------------------------------
  const sections: { title: string | null; start: number; end: number }[] = [];
  let cursor = 0;
  let current: string | null = null;
  body.forEach((line, i) => {
    if (SECTION_RE.test(line.probe) && line.probe.length <= 60) {
      if (i > cursor) sections.push({ title: current, start: cursor, end: i });
      current = line.probe.replace(/:$/, '');
      headings.push({ from: line.from, to: line.to });
      cursor = i + 1;
    }
  });
  if (cursor < body.length) sections.push({ title: current, start: cursor, end: body.length });
  if (sections.length === 0) sections.push({ title: null, start: 0, end: body.length });

  // ---- 3. points inside each section -------------------------------------
  for (const section of sections) {
    const slice = body.slice(section.start, section.end);
    const marked: number[] = [];
    slice.forEach((line, i) => {
      if (NUMBERED_RE.test(line.probe) || BULLET_RE.test(line.probe)) marked.push(i);
    });

    const ranges: { start: number; end: number; reason: string }[] = [];
    if (marked.length > 0) {
      marked.forEach((start, n) => {
        const end = n + 1 < marked.length ? marked[n + 1]! : slice.length;
        const numbered = NUMBERED_RE.test(slice[start]!.probe);
        ranges.push({
          start,
          end,
          reason: numbered
            ? `numbered point${section.title === null ? '' : ` under “${section.title}”`}`
            : `bulleted point${section.title === null ? '' : ` under “${section.title}”`}`,
        });
      });
    } else {
      // No markers: fall back to blank-line-separated paragraphs, which is how
      // an unnumbered "Major comments" block is actually written.
      let start: number | null = null;
      slice.forEach((line, i) => {
        const blank = line.probe === '';
        if (!blank && start === null) start = i;
        if (blank && start !== null) {
          ranges.push({
            start,
            end: i,
            reason: `paragraph${section.title === null ? '' : ` under “${section.title}”`}`,
          });
          start = null;
        }
      });
      if (start !== null) {
        ranges.push({
          start,
          end: slice.length,
          reason: `paragraph${section.title === null ? '' : ` under “${section.title}”`}`,
        });
      }
    }

    for (const range of ranges) {
      const first = slice[range.start];
      const lastIdx = lastNonBlank(slice, range.start, range.end);
      if (first === undefined || lastIdx === null) continue;
      const from = first.from;
      const to = slice[lastIdx]!.to;
      const verbatim = source.slice(from, to);
      if (verbatim.trim().length < MIN_POINT_CHARS) continue;
      points.push({
        id: `r${index}.${points.length + 1}`,
        reviewerIndex: index,
        pointIndex: points.length + 1,
        section: section.title,
        from,
        to,
        verbatim,
        reason: range.reason,
      });
    }
  }

  const from = body[0]?.from ?? 0;
  const to = body[body.length - 1]?.to ?? from;
  return { index, label, from, to, points, headings };
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
  for (const r of reviewers) for (const p of r.points) claimed.push({ from: p.from, to: p.to });
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
  };
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
