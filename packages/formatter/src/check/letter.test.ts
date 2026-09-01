import { describe, expect, it } from 'vitest';
import {
  CoverLetterMetaSchema,
  type Author,
  type CoverLetterMeta,
  type LetterRules,
  type PublisherProfile,
} from '@suna/core';
import { getBundledProfile } from '../bundled';
import { checkLetter, letterRequirements } from './letter';

/**
 * ARCHITECTURE §12.1, reworked without the assertion sidecar: the letter is
 * plain prose, so venue-required claims surface as unverifiable warnings and
 * only the structural checks (journal names, authors.json, data locations,
 * the abbreviated summary) remain findings SUNA stands behind. The two
 * defects from real submitted documents (the wrong journal named in the
 * prose, an availability sentence standing in for a named repository) keep
 * their tests.
 */

const authorsWithCorresponding: Author[] = [
  {
    id: 'a1',
    given: 'Aviad',
    family: 'Hai',
    affiliationRefs: ['1'],
    corresponding: true,
    email: 'ahai@example.edu',
    orcid: null,
    equalContribution: false,
  } as unknown as Author,
];

const authorsWithoutCorresponding: Author[] = [
  {
    id: 'a1',
    given: 'Aviad',
    family: 'Hai',
    affiliationRefs: ['1'],
    corresponding: false,
    email: null,
    orcid: null,
    equalContribution: false,
  } as unknown as Author,
];

/** A minimal profile carrying only the letter rules a given test needs. */
function profileWith(letters: LetterRules | undefined, journalName = 'Science'): PublisherProfile {
  const base = getBundledProfile('science');
  if (base === null) throw new Error('science profile missing');
  return { ...base, journalName, letters } as PublisherProfile;
}

const rules = (assertions: LetterRules['assertions']): LetterRules => ({
  stance: { submission: 'required' },
  requiredForArticleTypes: [],
  assertions,
  confidentialToEditor: true,
  sources: ['https://example.org/guide'],
});

const requirement = (
  id: LetterRules['assertions'][number]['id'],
  stance: LetterRules['assertions'][number]['stance'],
  extra: Partial<LetterRules['assertions'][number]> = {},
): LetterRules['assertions'][number] => ({
  id,
  stance,
  vehicle: null,
  limit: null,
  quote: null,
  source: 'https://example.org/guide',
  basis: null,
  ...extra,
});

const meta = (over: Partial<CoverLetterMeta> = {}): CoverLetterMeta =>
  CoverLetterMetaSchema.parse({
    schemaVersion: 1,
    kind: 'cover-letter',
    letterKind: 'submission',
    targetProfileId: 'science',
    salutation: 'Dear Editor,',
    identityId: null,
    signerIds: [],
    covers: [{ documentId: 'manuscript', siblingProjectPath: null, title: 'T', articleType: 'article', authorsLine: null }],
    ...over,
  });

describe('a profile with no researched letter rules', () => {
  it('produces nothing at all — silence is an unknown, not a violation', () => {
    const diags = checkLetter({
      meta: meta(),
      letterText: 'Dear Editor, please find attached.',
      profile: profileWith(undefined),
      authors: authorsWithCorresponding,
    });
    expect(diags).toEqual([]);
  });

  it('letterRequirements returns [] for it', () => {
    expect(letterRequirements(profileWith(undefined))).toEqual([]);
  });
});

describe('letter.requirement-unverified', () => {
  it('fires as a warning for every venue-required claim SUNA cannot read from prose', () => {
    const diags = checkLetter({
      letterText: 'Dear Editor,',
      profile: profileWith(
        rules([requirement('journalFit', 'required'), requirement('competingInterests', 'required')]),
      ),
      authors: authorsWithCorresponding,
    });
    const hits = diags.filter((d) => d.id === 'letter.requirement-unverified');
    expect(hits).toHaveLength(2);
    expect(hits.every((d) => d.severity === 'warning')).toBe(true);
    expect(hits[0]?.surface).toBe('letter');
    expect(hits[0]?.target?.assertionId).toBe('journalFit');
    expect(hits[0]?.message).toContain('cannot verify');
  });

  it('does not fire for optional, discouraged, or elsewhere entries', () => {
    const diags = checkLetter({
      letterText: '',
      profile: profileWith(
        rules([
          requirement('suggestedReviewers', 'optional'),
          requirement('background', 'discouraged'),
          requirement('excludedReviewers', 'elsewhere', { vehicle: 'submission-form' }),
        ]),
      ),
      authors: authorsWithCorresponding,
    });
    expect(diags).toEqual([]);
  });

  it('does not duplicate the structural checks for dataLocation and correspondingContact', () => {
    const diags = checkLetter({
      meta: meta(),
      letterText: '',
      profile: profileWith(
        rules([
          requirement('dataLocation', 'required'),
          requirement('correspondingContact', 'required'),
        ]),
      ),
      authors: authorsWithoutCorresponding,
    });
    expect(diags.filter((d) => d.id === 'letter.requirement-unverified')).toEqual([]);
    expect(diags.map((d) => d.id)).toContain('letter.data-location-unspecified');
    expect(diags.map((d) => d.id)).toContain('letter.corresponding-contact-missing');
  });

  it('quotes the venue and cites its URL when the profile carries them', () => {
    const diags = checkLetter({
      letterText: '',
      profile: profileWith(
        rules([
          requirement('journalFit', 'required', {
            quote: 'Tell us why this paper belongs in our pages.',
            basis: 'documented',
            source: 'https://example.org/g',
          }),
        ]),
      ),
      authors: authorsWithCorresponding,
    });
    expect(diags[0]?.message).toContain('Tell us why this paper belongs');
    expect(diags[0]?.message).toContain('https://example.org/g');
  });
});

describe('letterRequirements', () => {
  it('returns every entry with its label, stance and provenance', () => {
    const profile = profileWith(
      rules([
        requirement('journalFit', 'required', {
          quote: 'Why us?',
          basis: 'documented',
          source: 'https://example.org/g',
        }),
        requirement('background', 'discouraged'),
      ]),
    );
    expect(letterRequirements(profile)).toEqual([
      {
        id: 'journalFit',
        label: 'why this work suits this journal',
        stance: 'required',
        quote: 'Why us?',
        source: 'https://example.org/g',
      },
      {
        id: 'background',
        label: 'background for a non-specialist editor',
        stance: 'discouraged',
        quote: null,
        source: 'https://example.org/guide',
      },
    ]);
  });
});

describe('letter.journal-name-mismatch — the defect from a real submitted letter', () => {
  const text =
    'we hereby submit for consideration as an article in Science. … we believe this paper will be of great interest to the broad readership of Science Advances.';

  it('fires as an error when the prose names a different journal', () => {
    const diags = checkLetter({
      meta: meta(),
      letterText: text,
      profile: profileWith(rules([]), 'Science'),
      authors: authorsWithCorresponding,
      knownJournalNames: ['Science', 'Science Advances', 'Nature'],
    });
    const hit = diags.find((d) => d.id === 'letter.journal-name-mismatch');
    expect(hit?.severity).toBe('error');
    expect(hit?.message).toContain('Science Advances');
  });

  it('works without any meta at all', () => {
    const diags = checkLetter({
      letterText: text,
      profile: profileWith(rules([]), 'Science'),
      authors: authorsWithCorresponding,
      knownJournalNames: ['Science', 'Science Advances', 'Nature'],
    });
    expect(diags.map((d) => d.id)).toContain('letter.journal-name-mismatch');
  });

  it('is cleared by recording that journal in the prior-submission history', () => {
    const diags = checkLetter({
      meta: meta({
        priorSubmissions: [{ journal: 'Science Advances', outcome: 'rejected', date: null, note: null }],
      }),
      letterText: text,
      profile: profileWith(rules([]), 'Science'),
      authors: authorsWithCorresponding,
      knownJournalNames: ['Science', 'Science Advances', 'Nature'],
    });
    expect(diags.map((d) => d.id)).not.toContain('letter.journal-name-mismatch');
  });

  it('does not fire on the target journal appearing inside its own family name', () => {
    // "Science" is a substring of "Science Advances"; a letter to Science
    // Advances that never mentions plain Science must stay clean.
    const diags = checkLetter({
      meta: meta(),
      letterText: 'submitted to Science Advances for consideration.',
      profile: profileWith(rules([]), 'Science Advances'),
      authors: authorsWithCorresponding,
      knownJournalNames: ['Science', 'Science Advances'],
    });
    expect(diags.map((d) => d.id)).not.toContain('letter.journal-name-mismatch');
  });
});

describe('letter.data-location-unspecified — never reads the prose', () => {
  const dataRules = rules([requirement('dataLocation', 'required')]);

  it('fires even when the letter promises availability in words', () => {
    const diags = checkLetter({
      meta: meta(),
      letterText: 'Data and analysis code will be made available upon publication.',
      profile: profileWith(dataRules),
      authors: authorsWithCorresponding,
    });
    const hit = diags.find((d) => d.id === 'letter.data-location-unspecified');
    expect(hit?.severity).toBe('error');
  });

  it('fires when no meta is supplied at all', () => {
    const diags = checkLetter({
      letterText: 'Data at Zenodo.',
      profile: profileWith(dataRules),
      authors: authorsWithCorresponding,
    });
    expect(diags.map((d) => d.id)).toContain('letter.data-location-unspecified');
  });

  it('clears once a repository is actually named', () => {
    const diags = checkLetter({
      meta: meta({
        dataLocations: [
          { repository: 'Zenodo', accession: '10.5281/zenodo.1', restrictions: null, availableAt: 'on-publication' },
        ],
      }),
      letterText: '',
      profile: profileWith(dataRules),
      authors: authorsWithCorresponding,
    });
    expect(diags.map((d) => d.id)).not.toContain('letter.data-location-unspecified');
  });
});

describe('letter.summary-over-limit — counted including spaces', () => {
  const capped = rules([
    requirement('abbreviatedSummary', 'required', {
      limit: { unit: 'characters', max: 323 },
    }),
  ]);

  it('passes at exactly the limit and fails one character over', () => {
    const at = 'x'.repeat(323);
    const over = 'x'.repeat(324);
    const run = (s: string): string[] =>
      checkLetter({
        meta: meta({ abbreviatedSummary: s }),
        letterText: '',
        profile: profileWith(capped),
        authors: authorsWithCorresponding,
      }).map((d) => d.id);
    expect(run(at)).not.toContain('letter.summary-over-limit');
    expect(run(over)).toContain('letter.summary-over-limit');
  });

  it('counts spaces', () => {
    // 322 characters of text plus two spaces = 324 with the trailing z.
    const s = `${'x'.repeat(160)} ${'y'.repeat(161)} `;
    expect(s.length).toBe(323);
    const diags = checkLetter({
      meta: meta({ abbreviatedSummary: `${s}z` }),
      letterText: '',
      profile: profileWith(capped),
      authors: authorsWithCorresponding,
    });
    expect(diags.map((d) => d.id)).toContain('letter.summary-over-limit');
  });
});

describe('letter.corresponding-contact-missing', () => {
  const contactRules = rules([requirement('correspondingContact', 'required')]);

  it('fires when no author is corresponding with an e-mail', () => {
    const diags = checkLetter({
      letterText: '',
      profile: profileWith(contactRules),
      authors: authorsWithoutCorresponding,
    });
    const hit = diags.find((d) => d.id === 'letter.corresponding-contact-missing');
    expect(hit?.severity).toBe('error');
  });

  it('clears when one is', () => {
    const diags = checkLetter({
      letterText: '',
      profile: profileWith(contactRules),
      authors: authorsWithCorresponding,
    });
    expect(diags.map((d) => d.id)).not.toContain('letter.corresponding-contact-missing');
  });
});

describe('against the real bundled profiles', () => {
  it('a PNAS letter produces no requirement warnings, because PNAS does not request one', () => {
    const pnas = getBundledProfile('pnas');
    expect(pnas).not.toBeNull();
    expect(pnas?.letters?.stance.submission).toBe('not-requested');
    const diags = checkLetter({
      letterText: 'Dear Editor,',
      profile: pnas!,
      authors: authorsWithCorresponding,
    });
    expect(diags.filter((d) => d.id === 'letter.requirement-unverified')).toEqual([]);
  });

  it('a Science letter surfaces every required, non-structural item as an unverified warning', () => {
    const science = getBundledProfile('science');
    const required = (science?.letters?.assertions ?? []).filter(
      (a) =>
        a.stance === 'required' &&
        a.id !== 'dataLocation' &&
        a.id !== 'correspondingContact',
    );
    expect(required.length).toBeGreaterThan(0);
    const diags = checkLetter({
      letterText: 'Dear Editor,',
      profile: science!,
      authors: authorsWithoutCorresponding,
    });
    expect(diags.filter((d) => d.id === 'letter.requirement-unverified')).toHaveLength(
      required.length,
    );
  });
});

describe('the shipped profiles honour the quote-provenance gate', () => {
  it('no bundled letters block ships a quote whose basis is documented-indexed', () => {
    for (const id of ['science', 'nature', 'pnas']) {
      const p = getBundledProfile(id);
      for (const a of p?.letters?.assertions ?? []) {
        if (a.quote !== null) expect(a.basis).not.toBe('documented-indexed');
      }
    }
  });

  it('every shipped assertion still carries a source URL', () => {
    for (const id of ['science', 'nature']) {
      const p = getBundledProfile(id);
      for (const a of p?.letters?.assertions ?? []) {
        expect(a.source).not.toBeNull();
      }
    }
  });
});
