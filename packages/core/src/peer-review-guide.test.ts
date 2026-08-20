import { describe, expect, it } from 'vitest';
import {
  PEER_REVIEW_FILE,
  PEER_REVIEW_SECTIONS,
  PEER_REVIEW_SEED_MARKER,
  peerReviewIsUnfilled,
  peerReviewSeed,
  peerReviewSuggestion,
  peerReviewAiApproved,
  PeerReviewApprovalSchema,
  type PeerReviewApproval,
} from './peer-review-guide';

describe('peerReviewIsUnfilled', () => {
  it('is true for a missing file — an older project never had one', () => {
    expect(peerReviewIsUnfilled(null)).toBe(true);
  });

  it('is true for the freshly seeded file', () => {
    expect(peerReviewIsUnfilled(peerReviewSeed())).toBe(true);
  });

  it('is true for a file that is only headings and comments', () => {
    expect(
      peerReviewIsUnfilled('# Answering reviewers\n\n<!-- a note -->\n\n## Voice\n\n'),
    ).toBe(true);
  });

  it('is true when every bullet is still an italic placeholder', () => {
    expect(peerReviewIsUnfilled('## Voice\n\n- *(none yet)*\n\n## Rules\n\n*(not filled out yet)*')).toBe(
      true,
    );
  });

  it('is false once the user has written one real line', () => {
    expect(peerReviewIsUnfilled(`${peerReviewSeed()}\n- Never open with thanks.`)).toBe(false);
  });

  it('is false for the accepted suggestion — that IS an answer', () => {
    expect(peerReviewIsUnfilled(peerReviewSuggestion())).toBe(false);
  });

  it('does not need the marker to decide: deleting it leaves an empty file empty', () => {
    const noMarker = peerReviewSeed().replace(PEER_REVIEW_SEED_MARKER, '');
    expect(peerReviewIsUnfilled(noMarker)).toBe(true);
  });

  it('ignores a multi-line HTML comment rather than reading it as content', () => {
    expect(peerReviewIsUnfilled('# X\n\n<!--\nline one\nline two\n-->\n')).toBe(true);
  });
});

describe('the suggested guidelines', () => {
  it('are written as decisions, not as a form of open questions', () => {
    const text = peerReviewSuggestion();
    // One trailing placeholder is deliberate (house conventions); the rest
    // must be usable as-is, or a user who keeps the defaults gets nothing.
    const placeholders = text.match(/\*\([^)]*\)\*/g) ?? [];
    expect(placeholders.length).toBeLessThanOrEqual(1);
  });

  it('carry the conventions read off the real response documents', () => {
    const text = peerReviewSuggestion();
    // Quote the revised text inline; 'Done.' for a trivial fix; answer a
    // shared point once and cross-reference it; disagreement is normal and
    // needs a stated reason.
    expect(text).toContain('quotation marks');
    expect(text).toContain('"Done."');
    expect(text).toMatch(/Reviewer 1, point 3/);
    expect(text).toContain('Disagreement is a normal part');
    expect(text.replace(/\s+/g, ' ')).toContain('"Beyond the scope of this paper" alone is not a reason');
  });

  it('thanks the reviewers once, in the opening — not per point', () => {
    expect(peerReviewSuggestion()).toMatch(/ONCE, in the letter's opening/);
  });

  it('is a Markdown document under the name the context layer seeds', () => {
    expect(PEER_REVIEW_FILE).toBe('PEER-REVIEW.md');
    expect(peerReviewSuggestion().startsWith('# Answering reviewers')).toBe(true);
  });
});

describe('composing the file from chosen sections', () => {
  it('defaults to every section', () => {
    const all = peerReviewSuggestion();
    for (const section of PEER_REVIEW_SECTIONS) {
      expect(all).toContain(`## ${section.title}`);
    }
  });

  it('keeps only what was chosen, and keeps it in the canonical order', () => {
    const text = peerReviewSuggestion(['evidence', 'voice']);
    expect(text).toContain('## Voice');
    expect(text).toContain('## Evidence');
    expect(text).not.toContain('## Cross-references');
    // Declaration order, not click order — the file should read the same way
    // however the user got there.
    expect(text.indexOf('## Voice')).toBeLessThan(text.indexOf('## Evidence'));
  });

  it('an empty choice is a header alone, not an error — "I will write this myself"', () => {
    const text = peerReviewSuggestion([]);
    expect(text).toContain('# Answering reviewers');
    expect(text).not.toContain('## ');
    // And that file still counts as unanswered, so the offer can come back.
    expect(peerReviewIsUnfilled(text)).toBe(true);
  });

  it('ignores an id that names no section rather than emitting an empty heading', () => {
    expect(peerReviewSuggestion(['voice', 'nonexistent'])).not.toContain('undefined');
  });

  it('every section carries a card summary distinct from its body', () => {
    for (const section of PEER_REVIEW_SECTIONS) {
      expect(section.summary.length).toBeGreaterThan(20);
      expect(section.summary).not.toContain('\n');
      expect(section.body.startsWith('-')).toBe(true);
    }
  });
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function approval(over: Partial<PeerReviewApproval> = {}): PeerReviewApproval {
  return PeerReviewApprovalSchema.parse({
    approvedAt: '2026-08-20T12:00:00.000Z',
    approvedBy: 'A. Author',
    source: 'suggested',
    contentHash: HASH_A,
    learnedFrom: null,
    ...over,
  });
}

describe('the approval gate', () => {
  it('is closed when nothing has been approved', () => {
    expect(peerReviewAiApproved(undefined)).toBe(false);
    expect(peerReviewAiApproved(null)).toBe(false);
    expect(peerReviewAiApproved({})).toBe(false);
    expect(peerReviewAiApproved({ peerReviewAi: null })).toBe(false);
  });

  it('is open once an approval is recorded', () => {
    expect(peerReviewAiApproved({ peerReviewAi: approval() })).toBe(true);
  });

  it('will not accept a hash that is not a sha256', () => {
    expect(() => approval({ contentHash: 'nope' })).toThrow();
    expect(() => approval({ contentHash: 'A'.repeat(64) })).toThrow();
  });

  it('will not accept an anonymous approval', () => {
    expect(() => approval({ approvedBy: '' })).toThrow();
  });

  it('will not accept a route it does not know', () => {
    expect(() => approval({ source: 'vibes' as PeerReviewApproval['source'] })).toThrow();
  });

  it('records which document the conventions were learned from', () => {
    expect(approval({ source: 'imported', learnedFrom: '/x/letter.docx' }).learnedFrom).toBe(
      '/x/letter.docx',
    );
  });
});

/**
 * SUNA's house rule for every Markdown file it writes (suna-context
 * MANUSCRIPT.md): a paragraph is ONE unbroken line, never hard-wrapped at a
 * column width, because a newline starts a new block. A bullet wrapped to fit
 * 80 columns in the source becomes a sentence broken in half in the file the
 * author opens, and in the prompt the AI reads.
 */
function continuationLines(markdown: string): string[] {
  const lines = markdown.split('\n');
  // A continuation is a line that carries on the one above it. A block that
  // stands alone after a blank line is a paragraph, not a broken sentence,
  // so only lines whose PREDECESSOR is non-blank can be at fault.
  return lines.filter(
    (line, i) =>
      line.trim() !== '' &&
      i > 0 &&
      lines[i - 1]!.trim() !== '' &&
      !/^(#{1,6} |- |<!--)/.test(line),
  );
}

describe('the emitted Markdown is never hard-wrapped', () => {
  it('holds for the full suggestion', () => {
    expect(continuationLines(peerReviewSuggestion())).toEqual([]);
  });

  it('holds for every section on its own', () => {
    for (const section of PEER_REVIEW_SECTIONS) {
      expect(continuationLines(section.body), `section "${section.title}"`).toEqual([]);
    }
  });

  it('holds for the seeded file', () => {
    expect(continuationLines(peerReviewSeed())).toEqual([]);
  });

  it('would catch a wrapped bullet if one were reintroduced', () => {
    expect(continuationLines('- A sentence that was\n  wrapped at a column.')).toEqual([
      '  wrapped at a column.',
    ]);
  });

  it('leaves long lines long — length is not the thing being checked', () => {
    const longest = peerReviewSuggestion()
      .split('\n')
      .reduce((n, line) => Math.max(n, line.length), 0);
    expect(longest).toBeGreaterThan(120);
  });
});
