import { z } from 'zod';
import type { Author } from './authors';
import type { LetterAssertionId, LetterKind } from './letters';

/**
 * The seeded letter skeleton (feature-plan-12 §2e).
 *
 * PURE, on purpose: the New Letter sheet previews exactly what `letter:new`
 * writes, and neither can drift from the other. Same discipline as
 * `buildProjectManifest` in the onboarding wizard.
 *
 * "Seeded" is the default start-from mode in document-kinds-ux.md §A.3 because
 * it is instant, offline and correct. It produces the opening, the statements
 * and the sign-off — the mechanical ~60% of a real letter. It deliberately
 * does NOT produce the two paragraphs that argue the paper's case: those are
 * the author's, or the AI-draft mode's, and a machine-written argument that
 * reads like boilerplate is worse than a blank space that reads like a
 * prompt.
 *
 * It also never writes an assertion's text. Every required assertion appears
 * as an unanswered marker, which is what the checker reports and what the
 * Assertions panel lists.
 */

/**
 * The only part of manuscript.json a letter reads.
 *
 * Deliberately NARROW: demanding a fully valid manuscript.json would make
 * "create a cover letter" fail because some unrelated block is mid-edit. The
 * manuscript checker validates the manuscript; the letter creator only needs
 * the few fields it seeds from.
 */
export const LetterSeedSourceSchema = z.object({
  title: z.string().min(1),
  articleType: z.string().min(1).nullable().default(null),
  abstract: z.object({ content: z.string().nullable().optional() }).nullable().optional(),
  significance: z.string().nullable().optional(),
});
export type LetterSeedSource = z.infer<typeof LetterSeedSourceSchema>;

export interface LetterSeedInput {
  letterKind: LetterKind;
  /** The venue's display name, e.g. "Science". */
  journalName: string;
  manuscript: LetterSeedSource;
  authors: readonly Author[];
  /** Assertion ids the venue requires, from the profile. */
  requiredAssertions: readonly LetterAssertionId[];
  /** Salutation override; defaults to the venue-neutral form. */
  salutation?: string | null;
}

/** The unanswered-assertion marker. Visible in the editor, blocks export. */
export function unansweredMarker(id: LetterAssertionId): string {
  return `⟦ unanswered — ${id} ⟧`;
}

/** Every unanswered marker present in a letter's prose. */
export function unansweredIn(letterText: string): LetterAssertionId[] {
  const out: LetterAssertionId[] = [];
  for (const m of letterText.matchAll(/⟦ unanswered — ([a-zA-Z]+) ⟧/g)) {
    if (m[1] !== undefined) out.push(m[1] as LetterAssertionId);
  }
  return out;
}

function correspondingAuthor(authors: readonly Author[]): Author | null {
  return authors.find((a) => a.corresponding === true) ?? authors[0] ?? null;
}

function displayName(a: Author | null): string {
  if (a === null) return '';
  return `${a.given} ${a.family}`.trim();
}

const KIND_OPENING: Record<LetterKind, (journal: string) => string> = {
  submission: (j) => `which we submit for your consideration in ${j}.`,
  revision: (j) => `which we resubmit to ${j} following review.`,
  appeal: (j) => `regarding the editorial decision on our submission to ${j}.`,
  'presubmission-enquiry': (j) =>
    `which we would like to ask whether ${j} would consider.`,
};

/**
 * Build the skeleton. Every seeded sentence is composed only of facts already
 * on disk — title, article type, venue name, corresponding author. Nothing is
 * paraphrased, summarised or invented.
 */
export function buildLetterSkeleton(input: LetterSeedInput): string {
  const { journalName, manuscript, authors, requiredAssertions, letterKind } = input;
  const corresponding = correspondingAuthor(authors);
  const salutation = input.salutation ?? 'Dear Editor,';
  const title = manuscript.title.trim();
  const kindPhrase = KIND_OPENING[letterKind](journalName);

  const lines: string[] = [];
  lines.push(salutation, '');
  lines.push(
    `Please find enclosed our manuscript entitled “${title}”, ${kindPhrase}`,
    '',
  );

  // The case for the paper — left for a human or the AI-draft mode. The
  // abstract is NOT pasted here: several venues ask explicitly that the
  // letter not repeat it, and seeding the thing the venue asks you not to do
  // would be a poor default. It arrives as a comment on this paragraph
  // instead, which is the existing comment path and keeps the checker from
  // ever checking SUNA's own output.
  lines.push(
    '<!-- Why this work matters, and why it belongs in this journal. Two or',
    '     three paragraphs in your own words. The abstract is available as a',
    '     comment on this paragraph rather than pasted in. -->',
    '',
  );

  if (requiredAssertions.length > 0) {
    lines.push('');
    for (const id of requiredAssertions) {
      // The directive marks WHERE the assertion belongs; the marker says it
      // has no answer yet. Both survive into the rendered letter, and the
      // marker is what blocks export.
      lines.push(`${unansweredMarker(id)} ::assert{${id}}`, '');
    }
  }

  lines.push('Thank you for considering our submission.', '');
  lines.push('Sincerely,', '');
  const signer = displayName(corresponding);
  if (signer !== '') lines.push(signer);
  if (corresponding?.email != null && corresponding.email !== '') {
    lines.push(corresponding.email);
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * The abstract seed, delivered as an agent comment on the opening paragraph
 * rather than as prose (feature-plan-12 §2e).
 */
export function abstractSeedComment(
  manuscript: LetterSeedInput['manuscript'],
  journalName: string,
): string | null {
  const abstract = manuscript.abstract?.content ?? null;
  const significance = manuscript.significance ?? null;
  const body = significance ?? abstract;
  if (body === null || body.trim() === '') return null;
  const source = significance !== null ? 'significance statement' : 'abstract';
  return (
    `Seeded from the manuscript's ${source}, for reference while you write:\n\n` +
    `${body.trim()}\n\n` +
    `Several venues — ${journalName} may be one — ask that the letter make the ` +
    `case in your own words rather than repeat the abstract, so this is a ` +
    `comment and not prose.`
  );
}
