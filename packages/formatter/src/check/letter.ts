import type {
  Author,
  AssertionRequirement,
  CoverLetterMeta,
  LetterAssertionId,
  PublisherProfile,
} from '@suna/core';
import { assertionAnswered, assertionFor } from '@suna/core';
import type { Diagnostic, DiagnosticSeverity } from './types';
import { sourceSuffix } from './util';

/**
 * Cover-letter compliance checker (feature-plan-12 §2d).
 *
 * Same doctrine as every other checker in this package: the profile's stated
 * rules are flagged, never silently satisfied, and a rule the venue does not
 * state is skipped rather than guessed. What is different here is that most
 * of what is checked is not prose but the ASSERTION SIDECAR — because the
 * claims a cover letter makes are the author's, and reading them out of prose
 * with a heuristic would mean SUNA deciding whether someone declared a
 * competing interest. It reads the structured answer or it reports absence.
 *
 * One rule that is deliberately NOT here: Nature's "avoid repeating
 * information that is already present in the abstract and introduction" is a
 * real stated rule with no stated threshold. It is encoded
 * `stance: 'discouraged'` and surfaced in the Requirements panel as a
 * measurement beside Nature's own sentence — inventing a similarity cutoff is
 * what ADR-002 forbids, and `DiagnosticSeverity` has no member meaning "here
 * is a number, you decide".
 */

export interface LetterCheckInput {
  meta: CoverLetterMeta;
  /** The letter's rendered prose — what an editor would actually read. */
  letterText: string;
  /** The profile the letter TARGETS (meta.targetProfileId), not the project's. */
  profile: PublisherProfile;
  /** authors.json, for the corresponding-contact check. */
  authors: readonly Author[];
  /** manuscript.json's competing-interests statement, when there is one. */
  manuscriptCompetingInterests?: string | null;
  /**
   * Every bundled profile's journalName, for the wrong-journal check. The
   * checker is given them rather than importing the registry so this module
   * stays pure and the caller decides which profiles are in play.
   */
  knownJournalNames?: readonly string[];
}

/** Stance → the severity a missing assertion gets. */
function severityForStance(stance: AssertionRequirement['stance']): DiagnosticSeverity | null {
  return stance === 'required' ? 'error' : null;
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

/**
 * The `::assert{id}` directive a letter uses to place an assertion in its
 * prose. Matching is by id, so the author's wording is never parsed.
 */
const ASSERT_DIRECTIVE_RE = /::assert\{\s*([a-zA-Z]+)\s*\}/g;

function renderedAssertionIds(letterText: string): Set<string> {
  const ids = new Set<string>();
  for (const m of letterText.matchAll(ASSERT_DIRECTIVE_RE)) {
    if (m[1] !== undefined) ids.add(m[1]);
  }
  return ids;
}

export function checkLetter(input: LetterCheckInput): Diagnostic[] {
  const { meta, letterText, profile, authors } = input;
  const out: Diagnostic[] = [];
  const rules = profile.letters;
  const documentId = undefined;

  // A profile with no researched letter rules produces no assertion
  // diagnostics at all. Silence is not permission, and it is not a violation
  // either — it is an unknown, and ADR-002 says an unknown is skipped.
  if (rules === undefined) return out;

  const rendered = renderedAssertionIds(letterText);

  for (const req of rules.assertions) {
    const answer = assertionFor(meta, req.id);
    const answered = assertionAnswered(answer);
    const label = LABELS[req.id];

    // 1 — required by the venue, absent from the sidecar.
    const missingSeverity = severityForStance(req.stance);
    if (!answered && missingSeverity !== null) {
      out.push({
        id: 'letter.assertion-missing',
        severity: missingSeverity,
        surface: 'letter',
        message: `${profile.journalName} requires ${label}, and the letter does not state it${quoteSuffix(req)}`,
        target: { documentId, assertionId: req.id },
      });
      continue;
    }
    if (answer === null) continue;

    // 2 — answered, but somewhere the venue did not ask for.
    if (req.stance === 'elsewhere' && req.vehicle !== null && answer.placement === 'directive') {
      out.push({
        id: 'letter.assertion-misplaced',
        severity: 'warning',
        surface: 'letter',
        message: `${profile.journalName} wants ${label} in the ${req.vehicle.replace('-', ' ')}, not in the letter${quoteSuffix(req)}`,
        target: { documentId, assertionId: req.id },
      });
    }
    if (req.stance !== 'elsewhere' && answer.placement === 'submission-form' && req.stance === 'required') {
      out.push({
        id: 'letter.assertion-misplaced',
        severity: 'warning',
        surface: 'letter',
        message: `${profile.journalName} asks for ${label} in the letter itself, and it is marked as being on the submission form${quoteSuffix(req)}`,
        target: { documentId, assertionId: req.id },
      });
    }

    // 3 — declared as a directive, but no ::assert{} names it in the prose.
    if (answer.placement === 'directive' && answer.text !== null && !rendered.has(req.id)) {
      out.push({
        id: 'letter.assertion-not-rendered',
        severity: 'warning',
        surface: 'letter',
        message: `${label} is answered but never placed in the letter — add ::assert{${req.id}} where it belongs`,
        target: { documentId, assertionId: req.id },
      });
    }

    // 4 — stated where the venue discourages it. The abstract-overlap case is
    // measurement, not a diagnostic, and is handled in the Requirements panel.
    if (req.stance === 'discouraged' && answered && req.id !== 'background') {
      out.push({
        id: 'letter.assertion-forbidden',
        severity: 'warning',
        surface: 'letter',
        message: `${profile.journalName} discourages ${label} in the cover letter${quoteSuffix(req)}`,
        target: { documentId, assertionId: req.id },
      });
    }

    // 5 — an assertion the venue caps in length.
    if (req.limit !== null && answer.text !== null) {
      const measured =
        req.limit.unit === 'characters'
          ? answer.text.length
          : answer.text.trim().split(/\s+/).filter((w) => w !== '').length;
      if (measured > req.limit.max) {
        out.push({
          id: 'letter.summary-over-limit',
          severity: 'error',
          surface: 'letter',
          message: `${label} is ${measured} ${req.limit.unit} against ${profile.journalName}'s limit of ${req.limit.max}${quoteSuffix(req)}`,
          target: { documentId, assertionId: req.id },
        });
      }
    }
  }

  // 6 — the abbreviated summary, counted on the rendered string INCLUDING
  // spaces, because that is how the venues that impose it count.
  const summaryReq = rules.assertions.find((a) => a.id === 'abbreviatedSummary');
  if (
    summaryReq?.limit !== undefined &&
    summaryReq.limit !== null &&
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

  // 7 — the wrong journal named in the prose. This is the defect found in a
  // real submitted letter, which offered the paper "as an article in Science"
  // and then pitched "the broad readership of Science Advances".
  const declared = new Set(meta.priorSubmissions.map((p) => p.journal.toLowerCase()));
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
      `${before}${'\u0000'.repeat(hit.length)}${after}`
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

  // 8 — a data location the venue requires, structurally absent. This never
  // reads the prose: "data will be made available upon publication" is a
  // sentence, not a repository.
  const dataReq = rules.assertions.find((a) => a.id === 'dataLocation');
  if (dataReq !== undefined && dataReq.stance === 'required') {
    const named = meta.dataLocations.filter((d) => d.repository.trim() !== '');
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

  // 9 — the letter contradicts the manuscript it covers.
  const ci = assertionFor(meta, 'competingInterests');
  const msCi = input.manuscriptCompetingInterests ?? null;
  if (ci?.text != null && msCi !== null && msCi.trim() !== '') {
    if (declaresNone(ci.text) !== declaresNone(msCi)) {
      out.push({
        id: 'letter.contradicts-manuscript',
        severity: 'warning',
        surface: 'letter',
        message:
          'the letter and the manuscript disagree about competing interests — one declares none and the other declares some',
        target: { documentId, assertionId: 'competingInterests' },
      });
    }
  }

  // 10 — the venue requires a corresponding contact and authors.json has none.
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

/**
 * Whether a competing-interests sentence declares NONE. Deliberately narrow:
 * it recognises the standard forms and nothing else, and a sentence it cannot
 * classify is treated as "declares some" so the check errs toward silence
 * rather than toward accusing an author of contradicting themselves.
 */
function declaresNone(text: string): boolean {
  return /\b(no|none|not any|nothing to declare)\b[^.]*\b(competing|conflict|interest)/i.test(text)
    || /\b(competing|conflict)[^.]*\b(none|no\b)/i.test(text)
    || /\bdeclare no\b/i.test(text);
}
