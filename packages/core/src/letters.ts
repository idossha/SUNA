import { z } from 'zod';

/**
 * Cover letters and letters to the editor (ARCHITECTURE §4.2, ARCHITECTURE §14.3).
 *
 * A letter is `manuscript/letters/<id>.md` (prose, the source of truth) plus
 * `manuscript/letters/<id>.json` (this sidecar). It lives under `manuscript/`
 * so it inherits the comment gutter, the rail, ⌘⇧M, three-way merge and the
 * AI-diff review bar on the day it is created.
 *
 * The organising rule, and the reason `assertions` is structured rather than
 * prose: **a letter makes factual claims on the author's behalf.** That the
 * work is not under consideration elsewhere, that there are no competing
 * interests, that a named colleague has seen the draft. SUNA never writes
 * those words and an agent must never assert them — the sidecar records what
 * the AUTHOR said, and the checker flags absence. See document-kinds-ux.md
 * §A.4: the AI drafts the argument, the human answers the affidavit.
 */

export const LetterKindSchema = z.enum([
  'submission',
  'revision',
  'appeal',
  'presubmission-enquiry',
]);
export type LetterKind = z.infer<typeof LetterKindSchema>;

/**
 * Every claim a venue is known to ask for somewhere in the letter family.
 * A profile's `letters.assertions` picks from this list and says where that
 * venue wants each one; a letter's `assertions` says what the author did.
 */
export const LETTER_ASSERTION_IDS = [
  'dualPublication',
  'relatedManuscripts',
  'priorSubmission',
  'competingInterests',
  'dataLocation',
  'codeLocation',
  'humanConsent',
  'animalCare',
  'authorship',
  'correspondingContact',
  'presubmissionDiscussion',
  'colleaguesShown',
  'suggestedReviewers',
  'excludedReviewers',
  'abbreviatedSummary',
  'preregistration',
  'extendedFormatJustification',
  'acceleratedPublication',
  'consortium',
  'journalFit',
  'background',
  'conceptualAdvance',
  'revisionSummary',
  'appealGrounds',
] as const;
export const LetterAssertionIdSchema = z.enum(LETTER_ASSERTION_IDS);
export type LetterAssertionId = z.infer<typeof LetterAssertionIdSchema>;

/**
 * Where the author put this assertion, compared against where the profile
 * says it belongs.
 *
 * 'inline-prose' means "I wrote it in my own words somewhere in the letter"
 * and the checker stops asking — an author who has said it their way should
 * not be nagged into a directive. 'not-applicable' requires a reason, so
 * dismissing a venue's requirement leaves a record of why.
 */
export const AssertionPlacementSchema = z.enum([
  'directive',
  'inline-prose',
  'submission-form',
  'not-applicable',
]);
export type AssertionPlacement = z.infer<typeof AssertionPlacementSchema>;

export const LetterAssertionSchema = z
  .object({
    id: LetterAssertionIdSchema,
    placement: AssertionPlacementSchema,
    /** The AUTHOR's words. SUNA never writes this; it only flags absence. */
    text: z.string().min(1).nullable(),
    reason: z.string().min(1).nullable(),
  })
  .superRefine((a, ctx) => {
    if (a.placement === 'not-applicable' && a.reason === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message:
          "placement 'not-applicable' needs a reason — dismissing a venue's stated requirement should leave a record of why",
      });
    }
  });
export type LetterAssertion = z.infer<typeof LetterAssertionSchema>;

/**
 * Structural, so "no repository named" is a FACT the checker can read rather
 * than a prose heuristic. `letter.data-location-unspecified` fires off this
 * array being empty and never off the sentence "data will be made available
 * upon publication", which is exactly the sentence that makes a prose check
 * unreliable.
 */
export const DataLocationSchema = z.object({
  repository: z.string().min(1),
  accession: z.string().min(1).nullable(),
  restrictions: z.string().min(1).nullable(),
  availableAt: z.enum(['now', 'on-publication', 'on-request']),
});
export type DataLocation = z.infer<typeof DataLocationSchema>;

/** One paper this letter covers. Companion submissions add further entries. */
export const LetterCoverageSchema = z.object({
  /** Registry id of a document in THIS project, when the paper is here. */
  documentId: z.string().min(1).nullable(),
  /** Hand-entered path to a sibling project, read-only. */
  siblingProjectPath: z.string().min(1).nullable(),
  title: z.string().min(1).nullable(),
  articleType: z.string().min(1).nullable(),
  authorsLine: z.string().min(1).nullable(),
});
export type LetterCoverage = z.infer<typeof LetterCoverageSchema>;

export const PriorSubmissionSchema = z.object({
  journal: z.string().min(1),
  outcome: z.enum(['rejected', 'transferred', 'withdrawn', 'under-appeal', 'in-press']),
  date: z.iso.date().nullable(),
  note: z.string().nullable(),
});
export type PriorSubmission = z.infer<typeof PriorSubmissionSchema>;

export const CoverLetterMetaSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('cover-letter'),
  letterKind: LetterKindSchema,
  /**
   * The journal this letter addresses. NEVER silently inherited from
   * suna.json:activeProfileId — a letter to a journal you are no longer
   * targeting is a real thing to have on disk, and inheriting would rewrite
   * history the moment the author switched profiles.
   */
  targetProfileId: z.string().min(1),
  salutation: z.string().min(1).nullable(),
  /** ~/SunaConfig/identities/<id>.json — letterhead. */
  identityId: z.string().min(1).nullable(),
  /** Identity ids of the people signing, in signature-block order. */
  signerIds: z.array(z.string().min(1)).default([]),
  /** >=1. First is the primary paper; further entries are companion papers. */
  covers: z.array(LetterCoverageSchema).min(1),
  assertions: z.array(LetterAssertionSchema).default([]),
  dataLocations: z.array(DataLocationSchema).default([]),
  /** Counted on the RENDERED string, including spaces. */
  abbreviatedSummary: z.string().nullable().default(null),
  priorSubmissions: z.array(PriorSubmissionSchema).default([]),
  /** Set when letterKind is 'revision' — the round this letter accompanies. */
  reviewRoundId: z.string().min(1).nullable().default(null),
});
export type CoverLetterMeta = z.infer<typeof CoverLetterMetaSchema>;

/**
 * There is deliberately NO `date` field. The letter's date is derived from the
 * clock at export, which is what stops a stale date being baked into the file
 * the way it is baked into every hand-managed letter filename in the wild
 * ("…042826 Science.docx"). Numbering and dates are derived, never stored.
 */

/* ------------------------------------------------------------------ */
/* Confidential lists — a separate, gitignored sidecar                  */
/* ------------------------------------------------------------------ */

/**
 * `manuscript/letters/<id>.private.json`. Suggested and excluded reviewers
 * carry other people's names, emails and — in the excluded case — a reason
 * that is frequently a personal conflict. That does not belong in a
 * repository the whole author list can read, so the creator writes the
 * `.gitignore` line BEFORE it writes the file.
 */
export const ReviewerSuggestionSchema = z.object({
  name: z.string().min(1),
  email: z.email().nullable(),
  affiliation: z.string().min(1).nullable(),
  /** Required on an exclusion; a bare name is not a case an editor can act on. */
  reason: z.string().min(1).nullable(),
});
export type ReviewerSuggestion = z.infer<typeof ReviewerSuggestionSchema>;

export const LetterPrivateSchema = z.object({
  schemaVersion: z.literal(1),
  suggestedReviewers: z.array(ReviewerSuggestionSchema).default([]),
  excludedReviewers: z.array(ReviewerSuggestionSchema).default([]),
  colleaguesShown: z.array(ReviewerSuggestionSchema).default([]),
});
export type LetterPrivate = z.infer<typeof LetterPrivateSchema>;

/** The one pattern the creator adds to .gitignore. */
export const LETTER_PRIVATE_GITIGNORE_LINE = 'manuscript/**/*.private.json';

/* ------------------------------------------------------------------ */
/* Per-user identity (DECISIONS 2026-08-19)                              */
/* ------------------------------------------------------------------ */

/**
 * A lab crest and a PI's signature are neither manuscript data nor journal
 * data, and they are reused across every project that person ever writes —
 * so they live in `~/SunaConfig/identities/`, beside library.json, and are
 * referenced by path and embedded only at export.
 */
export const IdentitySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['letterhead', 'signer']),
  organization: z.string().min(1).nullable(),
  unit: z.string().min(1).nullable(),
  postal: z
    .object({
      street: z.string(),
      city: z.string(),
      region: z.string(),
      postalCode: z.string(),
      country: z.string(),
    })
    .nullable(),
  phone: z.string().nullable(),
  fax: z.string().nullable(),
  web: z.url().nullable(),
  /** Config-relative asset paths; embedded ONLY at export. */
  logoPaths: z.array(z.string().min(1)).default([]),
  /** Join to an authors.json entry, when this signer is also an author. */
  authorId: z.string().min(1).nullable(),
  displayName: z.string().min(1).nullable(),
  /** "MD, PhD" — authors.json has no such field, and letters always show it. */
  postNominals: z.string().min(1).nullable(),
  titles: z.array(z.string().min(1)).default([]),
  email: z.email().nullable(),
  signatureImagePath: z.string().min(1).nullable(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export const IdentityFileSchema = z.object({
  schemaVersion: z.literal(1),
  identities: z.array(IdentitySchema),
});
export type IdentityFile = z.infer<typeof IdentityFileSchema>;

export function emptyIdentityFile(): IdentityFile {
  return { schemaVersion: 1, identities: [] };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** The author's assertion for an id, or null. */
export function assertionFor(
  meta: CoverLetterMeta,
  id: LetterAssertionId,
): LetterAssertion | null {
  return meta.assertions.find((a) => a.id === id) ?? null;
}

/**
 * True when the author has answered this assertion at all — in a directive,
 * in their own prose, on the submission form, or by declaring it
 * inapplicable with a reason. Absence is the only thing the checker flags.
 */
export function assertionAnswered(a: LetterAssertion | null): boolean {
  if (a === null) return false;
  if (a.placement === 'not-applicable') return a.reason !== null;
  if (a.placement === 'submission-form' || a.placement === 'inline-prose') return true;
  return a.text !== null;
}

/** A new letter sidecar with every required assertion present and unanswered. */
export function emptyCoverLetterMeta(input: {
  letterKind: LetterKind;
  targetProfileId: string;
  requiredAssertions: readonly LetterAssertionId[];
  covers: readonly LetterCoverage[];
}): CoverLetterMeta {
  return CoverLetterMetaSchema.parse({
    schemaVersion: 1,
    kind: 'cover-letter',
    letterKind: input.letterKind,
    targetProfileId: input.targetProfileId,
    salutation: null,
    identityId: null,
    signerIds: [],
    covers: input.covers.length > 0 ? input.covers : [
      { documentId: null, siblingProjectPath: null, title: null, articleType: null, authorsLine: null },
    ],
    // Pre-populated with what the venue requires, all unanswered: the letter
    // starts by showing the author the affidavit they have to sign.
    assertions: input.requiredAssertions.map((id) => ({
      id,
      placement: 'directive' as const,
      text: null,
      reason: null,
    })),
    dataLocations: [],
    abbreviatedSummary: null,
    priorSubmissions: [],
    reviewRoundId: null,
  });
}
