import type {
  Author,
  AssertionRequirement,
  CoverLetterMeta,
  LetterAssertionId,
  PublisherProfile,
} from '@suna/core';
import type { Diagnostic } from './types';
import { sourceSuffix } from './util';

/**
 * Cover-letter compliance checker (feature-plan-12 §2d, reworked without the
 * assertion sidecar).
 *
 * Same doctrine as every other checker in this package: the profile's stated
 * rules are flagged, never silently satisfied, and a rule the venue does not
 * state is skipped rather than guessed. The letter is now plain prose with no
 * `::assert{}` directives and no structured answers, so SUNA can no longer
 * VERIFY that a prose claim is made — reading "we declare no competing
 * interests" out of free text with a heuristic would mean SUNA deciding
 * whether someone declared a competing interest. What it can still do:
 *
 *  - check the structured inputs it does have (authors.json, the letter
 *    meta's data locations and prior-submission history, the prose's journal
 *    names against the target), and
 *  - SURFACE each venue-required claim as a warning the author confirms by
 *    reading, never an error SUNA pretends to have verified
 *    (`letter.requirement-unverified`).
 *
 * Discouraged/optional/elsewhere entries are panel material
 * (`letterRequirements`), not findings.
 */

export interface LetterCheckInput {
  /**
   * cover-letter meta, when the letter has one. Only its STRUCTURED fields
   * are read (prior submissions, data locations, the abbreviated summary) —
   * the assertion sidecar is gone and nothing here depends on it.
   */
  meta?: CoverLetterMeta;
  /** The letter's rendered prose — what an editor would actually read. */
  letterText: string;
  /** The profile the letter TARGETS, not the project's. */
  profile: PublisherProfile;
  /** authors.json, for the corresponding-contact check. */
  authors: readonly Author[];
  /**
   * Every bundled profile's journalName, for the wrong-journal check. The
   * checker is given them rather than importing the registry so this module
   * stays pure and the caller decides which profiles are in play.
   */
  knownJournalNames?: readonly string[];
}

/** The venue's own sentence, when it is short enough to read inline. */
function quoteSuffix(req: AssertionRequirement): string {
  const src = req.source === null ? '' : sourceSuffix([req.source]);
  if (req.quote === null) return src;
  const q = req.quote.length > 160 ? `${req.quote.slice(0, 160)}…` : req.quote;
  return ` — the journal says: “${q}”${src}`;
}

const LABELS: Record<LetterAssertionId, string> = {
  dualPublication: 'a statement that the work is not under consideration elsewhere',
  relatedManuscripts: 'related manuscripts submitted or in press',
  priorSubmission: 'the prior submission history',
  competingInterests: 'a competing-interests statement',
  dataLocation: 'where the data can be found',
  codeLocation: 'where the analysis code can be found',
  humanConsent: 'human-subjects consent',
  animalCare: 'animal-care approval',
  authorship: 'a statement that all authors approved the submission',
  correspondingContact: 'the corresponding author’s contact details',
  presubmissionDiscussion: 'any pre-submission discussion with the editors',
  colleaguesShown: 'colleagues who have seen the draft',
  suggestedReviewers: 'suggested reviewers',
  excludedReviewers: 'excluded reviewers',
  abbreviatedSummary: 'the abbreviated summary',
  preregistration: 'the preregistration',
  extendedFormatJustification: 'a justification for the extended format',
  acceleratedPublication: 'the case for accelerated publication',
  consortium: 'the consortium authorship arrangement',
  journalFit: 'why this work suits this journal',
  background: 'background for a non-specialist editor',
  conceptualAdvance: 'the conceptual advance',
  revisionSummary: 'a summary of what changed in this revision',
  appealGrounds: 'the grounds for the appeal',
};

/** One row of the Requirements panel: the venue's letter asks, verbatim provenance included. */
export interface LetterRequirement {
  id: LetterAssertionId;
  label: string;
  stance: AssertionRequirement['stance'];
  quote: string | null;
  source: string | null;
}

/**
 * The profile's letter requirement list, for UI panels. Every stance is
 * included — the panel shows what the venue asks, discourages, or wants
 * elsewhere; only `checkLetter` narrows to findings. Returns [] when the
 * profile has no researched letter rules.
 */
export function letterRequirements(profile: PublisherProfile): LetterRequirement[] {
  return (profile.letters?.assertions ?? []).map((req) => ({
    id: req.id,
    label: LABELS[req.id],
    stance: req.stance,
    quote: req.quote,
    source: req.source,
  }));
}

/**
 * Requirements whose presence SUNA verifies STRUCTURALLY (dedicated
 * diagnostics below read authors.json / meta.dataLocations), so the generic
 * "cannot verify from prose" warning would be noise beside a real finding.
 */
const STRUCTURALLY_CHECKED: ReadonlySet<LetterAssertionId> = new Set([
  'dataLocation',
  'correspondingContact',
]);

export function checkLetter(input: LetterCheckInput): Diagnostic[] {
  const { meta, letterText, profile, authors } = input;
  const out: Diagnostic[] = [];
  const rules = profile.letters;
  const documentId = undefined;

  // A profile with no researched letter rules produces no requirement
  // diagnostics at all. Silence is not permission, and it is not a violation
  // either — it is an unknown, and ADR-002 says an unknown is skipped.
  if (rules === undefined) return out;

  // 1 — each claim the venue requires the letter to make. SUNA cannot verify
  // a prose claim (there is no sidecar any more, and heuristics over free
  // text would have SUNA deciding what an author declared), so this is a
  // warning the author confirms by reading, never an error.
  for (const req of rules.assertions) {
    if (req.stance !== 'required') continue;
    if (STRUCTURALLY_CHECKED.has(req.id)) continue;
    out.push({
      id: 'letter.requirement-unverified',
      severity: 'warning',
      surface: 'letter',
      message: `${profile.journalName} requires ${LABELS[req.id]} — SUNA cannot verify this from prose; confirm the letter covers it${quoteSuffix(req)}`,
      target: { documentId, assertionId: req.id },
    });
  }

  // 2 — the abbreviated summary, counted on the string INCLUDING spaces,
  // because that is how the venues that impose it count.
  const summaryReq = rules.assertions.find((a) => a.id === 'abbreviatedSummary');
  if (
    summaryReq?.limit !== undefined &&
    summaryReq.limit !== null &&
    meta !== undefined &&
    meta.abbreviatedSummary !== null
  ) {
    const measured =
      summaryReq.limit.unit === 'characters'
        ? meta.abbreviatedSummary.length
        : meta.abbreviatedSummary.trim().split(/\s+/).filter((w) => w !== '').length;
    if (measured > summaryReq.limit.max) {
      out.push({
        id: 'letter.summary-over-limit',
        severity: 'error',
        surface: 'letter',
        message: `the abbreviated summary is ${measured} ${summaryReq.limit.unit} against ${profile.journalName}'s limit of ${summaryReq.limit.max}, counted including spaces${quoteSuffix(summaryReq)}`,
        target: { documentId, assertionId: 'abbreviatedSummary' },
      });
    }
  }

  // 3 — the wrong journal named in the prose. This is the defect found in a
  // real submitted letter, which offered the paper "as an article in Science"
  // and then pitched "the broad readership of Science Advances".
  const declared = new Set(
    (meta?.priorSubmissions ?? []).map((p) => p.journal.toLowerCase()),
  );
  // LONGEST NAME FIRST, masking as we go. One journal's name is routinely a
  // prefix of another's — "Science" sits inside "Science Advances" — so a
  // naive word-boundary match reports the family journal in every letter that
  // names the parent, and reports the parent in every letter that names the
  // family journal. Masking each match before testing shorter names makes the
  // longest name at a position the one that owns it.
  let masked = letterText;
  const byLength = [...(input.knownJournalNames ?? [])].sort((a, b) => b.length - a.length);
  for (const name of byLength) {
    if (name === '') continue;
    const re = new RegExp(`(^|[^\\w])(${escapeRe(name)})([^\\w]|$)`, 'g');
    if (!re.test(masked)) continue;
    re.lastIndex = 0;
    masked = masked.replace(re, (_m, before: string, hit: string, after: string) =>
      `${before}${' '.repeat(hit.length)}${after}`
    );
    if (name === profile.journalName) continue;
    if (declared.has(name.toLowerCase())) continue;
    out.push({
      id: 'letter.journal-name-mismatch',
      severity: 'error',
      surface: 'letter',
      message: `the letter names ${name} but is addressed to ${profile.journalName} — say which you mean, or record ${name} in the prior-submission history`,
      target: { documentId },
    });
  }

  // 4 — a data location the venue requires, structurally absent. This never
  // reads the prose: "data will be made available upon publication" is a
  // sentence, not a repository.
  const dataReq = rules.assertions.find((a) => a.id === 'dataLocation');
  if (dataReq !== undefined && dataReq.stance === 'required') {
    const named = (meta?.dataLocations ?? []).filter((d) => d.repository.trim() !== '');
    if (named.length === 0) {
      out.push({
        id: 'letter.data-location-unspecified',
        severity: 'error',
        surface: 'letter',
        message: `${profile.journalName} requires the letter to say where the data can be found, and no repository is named${quoteSuffix(dataReq)}`,
        target: { documentId, assertionId: 'dataLocation' },
      });
    }
  }

  // 5 — the venue requires a corresponding contact and authors.json has none.
  const contactReq = rules.assertions.find((a) => a.id === 'correspondingContact');
  if (contactReq !== undefined && contactReq.stance === 'required') {
    const ok = authors.some((a) => a.corresponding === true && (a.email ?? '') !== '');
    if (!ok) {
      out.push({
        id: 'letter.corresponding-contact-missing',
        severity: 'error',
        surface: 'letter',
        message: `${profile.journalName} requires the corresponding author's contact details, and no author in authors.json is marked corresponding with an e-mail${quoteSuffix(contactReq)}`,
        target: { documentId, assertionId: 'correspondingContact' },
      });
    }
  }

  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
