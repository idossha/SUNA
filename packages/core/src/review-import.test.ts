import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  pointCount,
  segmentReviewerReport,
  verbatimIsContiguous,
} from './review-import';

/**
 * feature-plan-12 §6 / document-kinds-ux.md §B.2.
 *
 * The fixtures below reproduce the structural grammar of two real reviewer
 * documents — including the artifacts a .docx → text conversion leaves behind
 * (`**bold**` headings, pandoc's `2\.` escaping, trailing hard-break
 * backslashes, `[…]{.mark}` spans). The documents themselves are private and
 * are not committed; the last block opportunistically runs against them when
 * they happen to be present and skips otherwise.
 */

const FIVE_REVIEWERS = `Response to Reviewers - reply-b Manuscript

Dear Editor and Reviewers,

We thank you for the thorough evaluation of our manuscript.

**Reviewer #1**:

The authors present reply-b, an open-source containerized pipeline.

Major comments\\
Fixing per-pair current at 1 mA while optimizing only electrode positions is inappropriate for TI, where current allocation is a primary control knob.

The manuscript relies primarily on a genetic algorithm and discusses the exhaustive strategy only briefly in the Supplementary Information.

Minor comments\\
Please define all acronyms at first use in the main text and figures.

**Reviewer #2:**

This is a useful contribution and I have only a few remarks about reproducibility.

**Reviewer #3**:

1. The validation section needs a quantitative comparison against ground truth.
2\\. Figure 4 is difficult to read at print size; consider splitting it.

**Reviewer #4:**

Minor but important revisions are deemed sufficient to recommend acceptance of the present work.

**Reviewer #5:**

Minor issues:\\
- The installation instructions omit the container runtime version.
- Table 2 units are inconsistent with the text.
`;

const NUMBERED_WITH_SECTIONS = `Reviewers' Comments: \\

**Reviewer #1 (Comments for the Author):\\**

reply-a et al. [sentence redacted].

**Main issues\\**
1. Is the main claim here that the thalamocortical and hippocampal system have different sleep states? Or more precisely, are the traditional brain states dissociable between the two systems?

2\\. A major source of the confusion is mixing sleep states and SPW states throughout the analysis.

**Minor issues/questions**\\
3\\. The methods do not state how many animals contributed to each panel.

**Reviewer #2 (Comments for the Author):**

The experimental approach is straightforward and without major methodological flaws.
`;

describe('reviewer delimiters', () => {
  it('finds five reviewers in a five-reviewer report, with no model', () => {
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    expect(r.reviewers).toHaveLength(5);
    expect(r.reviewers.map((x) => x.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reads through bold markers and both colon placements', () => {
    // "**Reviewer #1**:" and "**Reviewer #2:**" are the two forms in the wild.
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    expect(r.reviewers[0]?.label).toMatch(/^Reviewer #?1/);
    expect(r.reviewers[1]?.label).toMatch(/^Reviewer #?2/);
  });

  it('keeps the editor preamble out of the reviewer blocks', () => {
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    expect(r.preamble).toContain('Dear Editor and Reviewers');
    for (const rev of r.reviewers) {
      for (const p of rev.points) expect(p.verbatim).not.toContain('Dear Editor');
    }
  });

  it('handles "Reviewer #N (Comments for the Author)"', () => {
    const r = segmentReviewerReport(NUMBERED_WITH_SECTIONS);
    expect(r.reviewers).toHaveLength(2);
    expect(r.reviewers[0]?.label).toContain('Comments for the Author');
  });

  it('does not mistake a sentence mentioning a reviewer for a delimiter', () => {
    const src = `**Reviewer #1**:

We agree with the point Reviewer 2 raised about normalization, and have addressed it in the revised methods section at length.
`;
    expect(segmentReviewerReport(src).reviewers).toHaveLength(1);
  });

  it('treats an undelimited report as a single reviewer rather than failing', () => {
    const src = `1. The introduction is too long and should be cut by a third.

2. Figure 2 needs error bars on every panel.
`;
    const r = segmentReviewerReport(src);
    expect(r.reviewers).toHaveLength(1);
    expect(pointCount(r)).toBe(2);
  });
});

describe('sections and points', () => {
  it('splits numbered points, including pandoc-escaped "2\\."', () => {
    const r = segmentReviewerReport(NUMBERED_WITH_SECTIONS);
    const r1 = r.reviewers[0]!;
    expect(r1.points.length).toBeGreaterThanOrEqual(3);
    expect(r1.points.some((p) => p.verbatim.includes('mixing sleep states'))).toBe(true);
  });

  it('records the section a point sat under', () => {
    const r = segmentReviewerReport(NUMBERED_WITH_SECTIONS);
    const sections = r.reviewers[0]!.points.map((p) => p.section);
    expect(sections.some((s) => s !== null && /main issues/i.test(s))).toBe(true);
    expect(sections.some((s) => s !== null && /minor/i.test(s))).toBe(true);
  });

  it('splits an unnumbered section into paragraphs', () => {
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    const r1 = r.reviewers[0]!;
    const major = r1.points.filter((p) => p.section !== null && /major/i.test(p.section));
    expect(major.length).toBe(2);
    expect(major[0]?.reason).toMatch(/paragraph/);
  });

  it('splits bulleted points', () => {
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    const r5 = r.reviewers.find((x) => x.index === 5)!;
    expect(r5.points.length).toBe(2);
    expect(r5.points[0]?.reason).toMatch(/bulleted/);
  });

  it('gives every point a reason a human can check', () => {
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    for (const rev of r.reviewers) {
      for (const p of rev.points) expect(p.reason.length).toBeGreaterThan(3);
    }
  });

  it('numbers point ids stably within a reviewer', () => {
    const r = segmentReviewerReport(NUMBERED_WITH_SECTIONS);
    expect(r.reviewers[0]?.points.map((p) => p.id)).toEqual(
      r.reviewers[0]!.points.map((_, i) => `r1.${i + 1}`),
    );
  });

  it('does not promote a short prose line to a section heading', () => {
    const src = `**Reviewer #1**:

1. Major revisions to the statistics are needed before this can be assessed properly.
`;
    const r = segmentReviewerReport(src);
    expect(pointCount(r)).toBe(1);
    expect(r.reviewers[0]?.points[0]?.verbatim).toContain('Major revisions');
  });
});

describe('the verbatim guarantee', () => {
  it('every point is a contiguous slice of the source', () => {
    for (const src of [FIVE_REVIEWERS, NUMBERED_WITH_SECTIONS]) {
      const r = segmentReviewerReport(src);
      expect(verbatimIsContiguous(r, src)).toBe(true);
    }
  });

  it('keeps the reviewer’s own markup rather than a cleaned rewrite', () => {
    const r = segmentReviewerReport(NUMBERED_WITH_SECTIONS);
    const escaped = r.reviewers[0]!.points.find((p) => p.verbatim.includes('major source'));
    // The probe strips "2\." for MATCHING; the stored text keeps it.
    expect(escaped?.verbatim.startsWith('2\\.')).toBe(true);
  });
});

describe('nothing is silently dropped', () => {
  it('reports coverage and unassigned spans that account for the source', () => {
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    expect(r.coverage).toBeGreaterThan(0.5);
    expect(r.coverage).toBeLessThanOrEqual(1);
    for (const u of r.unassigned) {
      expect(FIVE_REVIEWERS.slice(u.from, u.to)).toBe(u.text);
    }
  });

  it('surfaces a paragraph that fell outside every point', () => {
    // Reviewer 2's single paragraph and Reviewer 4's are prose with no marker
    // and no section — they must still become points, not vanish.
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    const r2 = r.reviewers.find((x) => x.index === 2)!;
    expect(r2.points.length).toBe(1);
    expect(r2.points[0]?.verbatim).toContain('reproducibility');
  });

  it('does not report blank lines between points as lost text', () => {
    const r = segmentReviewerReport(NUMBERED_WITH_SECTIONS);
    for (const u of r.unassigned) expect(u.text.trim().length).toBeGreaterThan(11);
  });

  it('names reviewers it could not split, for the AI-split offer', () => {
    const r = segmentReviewerReport(FIVE_REVIEWERS);
    // Reviewers 2 and 4 are one paragraph each.
    expect(r.unsplitReviewers).toContain(2);
    expect(r.unsplitReviewers).toContain(4);
    expect(r.unsplitReviewers).not.toContain(1);
  });
});

describe('degenerate input', () => {
  it('an empty string produces one empty reviewer and no crash', () => {
    const r = segmentReviewerReport('');
    expect(pointCount(r)).toBe(0);
    expect(r.coverage).toBe(1);
  });

  it('whitespace only produces no points', () => {
    expect(pointCount(segmentReviewerReport('\n\n   \n'))).toBe(0);
  });

  it('drops a point too short to be one', () => {
    const r = segmentReviewerReport('**Reviewer #1**:\n\n1. ok\n');
    expect(pointCount(r)).toBe(0);
  });
});

/**
 * Opportunistic: when the real documents happen to be on this machine, run
 * against them. They are private and are never committed, so this skips
 * everywhere else.
 */
const REAL_DIR =
  '/private/tmp/claude-501/-Users-example-00-development-SUNA/fcb4ad38-3e58-4990-9831-03253b7ca4fd/scratchpad/ex';

describe.skipIf(!existsSync(`${REAL_DIR}/reply-b.md`))(
  'against the real documents',
  () => {
    it('finds five reviewers in the reply-b report', () => {
      const src = readFileSync(`${REAL_DIR}/reply-b.md`, 'utf8');
      const r = segmentReviewerReport(src);
      expect(r.reviewers.map((x) => x.index)).toEqual([1, 2, 3, 4, 5]);
      expect(verbatimIsContiguous(r, src)).toBe(true);
      expect(pointCount(r)).toBeGreaterThan(10);
    });

    it('finds three reviewers in the reply-a reply', () => {
      const src = readFileSync(`${REAL_DIR}/reply-a.md`, 'utf8');
      const r = segmentReviewerReport(src);
      expect(r.reviewers.map((x) => x.index)).toEqual([1, 2, 3]);
      expect(verbatimIsContiguous(r, src)).toBe(true);
    });
  },
);
