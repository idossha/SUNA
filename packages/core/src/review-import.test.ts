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
 * are not committed, so the grammar is reproduced here rather than the text.
 * Both real documents were segmented correctly when this was written: five
 * reviewer blocks in one, three in the other, every verbatim contiguous.
 */

const FIVE_REVIEWERS = `Response to Reviewers - TI-Toolbox Manuscript

Dear Editor and Reviewers,

We thank you for the thorough evaluation of our manuscript.

**Reviewer #1**:

The authors present TI-Toolbox, an open-source containerized pipeline.

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

Findlay et al. performed continuous cortico-hippocampal recordings over 48 hours.

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
 * The shape a decision letter has when it arrives from an editorial system:
 * the reviewer label and the reviewer's first paragraph share ONE long line,
 * and the report walks the manuscript using its own section names as
 * dividers. The grammar is reproduced here; the documents are private.
 */
const INLINE_HEADINGS = `Reviewer #1: The authors present a containerized pipeline that unifies the workflow from preprocessing through visualization, accessible via both GUI and CLI, which lowers technical barriers for groups without bespoke infrastructure.

Major comments
Fixing per-pair current while optimizing only electrode positions is inappropriate here, because current allocation is a primary control knob for intensity and focality.

The manuscript relies primarily on one search strategy and discusses the alternative only briefly in the Supplementary Information.

Minor comments
Several figures are low resolution and are effectively unreadable at print scale.

Reviewer #2: The paper represents a kind of white paper report on a new computational tool, which I appreciate, and it is useful to the community.

- the paper is well-written and technically sound, with only very minor typos.

- the second paragraph of the introduction contains inaccuracies that should be revised before acceptance.

The tool is valuable and I recommend acceptance after the introduction is corrected.

Reviewer #3: Dear Authors,

Below I provide detailed comments organized by conceptual domains.

### COMMENTS PER SECTION

OVERALL
This work is technically rigorous, but its dense technical presentation may obscure the take-home message.

INDIVIDUALIZED VS. GENERALIZED MODELS
The finding that individualized models yield large focality benefits is important and deserves expansion.

METHODS

- The modular description is comprehensive but lengthy; a summarizing table would enhance clarity.
- Include brief mention of expected computational time per subject.

RESULTS

- Explicitly indicate whether reported p-values were corrected for multiple comparisons.
`;

describe('inline "Reviewer #N:" headings', () => {
  it('splits reviewers when the label shares a line with the reviewer text', () => {
    // The whole-line rule found ONE reviewer here and dropped the rest into a
    // single block; this is the format every editorial system emails out.
    const r = segmentReviewerReport(INLINE_HEADINGS);
    expect(r.reviewers.map((x) => x.index)).toEqual([1, 2, 3]);
  });

  it('keeps the label out of the reviewer text but the text itself intact', () => {
    const r = segmentReviewerReport(INLINE_HEADINGS);
    const first = r.reviewers[0]?.points[0];
    expect(first?.verbatim).toContain('The authors present a containerized pipeline');
    expect(first?.verbatim).not.toContain('Reviewer #1');
  });

  it('still slices verbatim out of the original source when a block starts mid-line', () => {
    const r = segmentReviewerReport(INLINE_HEADINGS);
    expect(verbatimIsContiguous(r, INLINE_HEADINGS)).toBe(true);
  });

  it('leaves a mid-sentence mention of a reviewer alone', () => {
    const src = `**Reviewer #1**:

We disagree with the claim that Reviewer 2 made about normalization, and the revised methods now address it directly and at length.
`;
    expect(segmentReviewerReport(src).reviewers).toHaveLength(1);
  });
});

describe('section headings beyond "Major/Minor comments"', () => {
  it('reads manuscript sections, ALL-CAPS domains and ATX headings as dividers', () => {
    const r = segmentReviewerReport(INLINE_HEADINGS);
    const sections = r.reviewers[2]!.points.map((p) => p.section);
    expect(sections).toContain('OVERALL');
    expect(sections).toContain('METHODS');
    expect(sections).toContain('RESULTS');
  });

  it('does not lose an ALL-CAPS heading containing a period', () => {
    // "INDIVIDUALIZED VS. GENERALIZED MODELS" — rejecting it glued the whole
    // block onto the end of the point above.
    const r = segmentReviewerReport(INLINE_HEADINGS);
    const sections = r.reviewers[2]!.points.map((p) => p.section);
    expect(sections).toContain('INDIVIDUALIZED VS. GENERALIZED MODELS');
    for (const p of r.reviewers[2]!.points) {
      expect(p.verbatim).not.toContain('INDIVIDUALIZED VS.');
    }
  });

  it('never absorbs a heading into the point above it', () => {
    const r = segmentReviewerReport(INLINE_HEADINGS);
    for (const rev of r.reviewers) {
      for (const p of rev.points) {
        expect(p.verbatim).not.toMatch(/\n(METHODS|RESULTS|OVERALL|Minor comments)\s*$/);
      }
    }
  });
});

describe('blocks that mix paragraphs and bullets', () => {
  it('keeps the paragraph before the first bullet and the one after the last', () => {
    // Taking the marker path wholesale dropped everything before the first
    // bullet and let the last bullet swallow the closing paragraph.
    const r = segmentReviewerReport(INLINE_HEADINGS);
    const texts = r.reviewers[1]!.points.map((p) => p.verbatim);
    expect(texts.some((t) => t.includes('white paper report'))).toBe(true);
    expect(texts.some((t) => t.trimStart().startsWith('The tool is valuable'))).toBe(true);
    const bullet = texts.find((t) => t.includes('well-written and technically sound'));
    expect(bullet).not.toContain('The tool is valuable');
  });

  it('accounts for every word of a real-shaped report', () => {
    const r = segmentReviewerReport(INLINE_HEADINGS);
    expect(r.unassigned).toEqual([]);
    expect(r.coverage).toBe(1);
  });
});

describe('re-importing a response document', () => {
  const RESPONSE = `**Reviewer #1**:

The manuscript relies primarily on a genetic algorithm and should report wall-clock runtimes for both approaches. RE1: Thank you for this point. We now added a benchmarking table as Table 1.

Figure 4 requires clarification, because the channel layout appears unevenly spaced. RE2: We have standardized the projection so the spacing is uniform.

The placement of Section 3.4 feels disconnected from the paper's main thread. RE4: We have moved the variability analysis to follow Section 3.3.
`;

  it('cuts the author reply off the reviewer verbatim', () => {
    const r = segmentReviewerReport(RESPONSE);
    const first = r.reviewers[0]!.points[0]!;
    expect(first.verbatim).toContain('wall-clock runtimes');
    expect(first.verbatim).not.toContain('RE1:');
    expect(first.verbatim).not.toContain('benchmarking table');
    expect(first.reply?.number).toBe(1);
    expect(first.reply?.text).toContain('benchmarking table');
  });

  it('keeps the reviewer verbatim a contiguous slice after the reply is cut', () => {
    const r = segmentReviewerReport(RESPONSE);
    expect(verbatimIsContiguous(r, RESPONSE)).toBe(true);
    for (const p of r.reviewers[0]!.points) {
      expect(RESPONSE.slice(p.reply!.from, p.reply!.to)).toBe(p.reply!.text);
    }
  });

  it('reports a skipped reply number rather than letting it pass', () => {
    // The evidence document numbered replies to RE83 with RE58 missing. A
    // hand-maintained sequence cannot see its own gap; this can.
    expect(segmentReviewerReport(RESPONSE).replyGaps).toEqual([3]);
  });

  it('counts a reply as accounted-for text, not as a lost paragraph', () => {
    const r = segmentReviewerReport(RESPONSE);
    expect(r.unassigned).toEqual([]);
  });

  it('does not invent a gap when one paragraph answers two comments', () => {
    // A point carrying "RE5:" and "RE6:" attaches only the first as its
    // reply. Counting ATTACHED replies then reports RE6 as missing — on the
    // real document that turned one true gap into seven, six of them wrong.
    const src = `**Reviewer #1**:

The first concern is runtime and the second is focality. RE5: We added Table 1. RE6: We added a focality column to it.

Figure 4 is hard to read at print size. RE7: We split it into two panels.
`;
    expect(segmentReviewerReport(src).replyGaps).toEqual([]);
  });

  it('reports no gaps for a report that carries no replies', () => {
    expect(segmentReviewerReport(INLINE_HEADINGS).replyGaps).toEqual([]);
  });
});
