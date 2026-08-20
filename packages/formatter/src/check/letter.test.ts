import { describe, expect, it } from 'vitest';
import {
  CoverLetterMetaSchema,
  emptyCoverLetterMeta,
  type Author,
  type CoverLetterMeta,
  type LetterRules,
  type PublisherProfile,
} from '@suna/core';
import { getBundledProfile } from '../bundled';
import { checkLetter } from './letter';

/**
 * feature-plan-12 §2d. The acceptance criteria are named in the plan; each
 * one has a test here, including the two that came out of defects in real
 * submitted documents (the wrong journal named in the prose, and a data
 * availability sentence standing in for a named repository).
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
});

describe('letter.assertion-missing', () => {
  it('fires as an error for every required assertion the sidecar does not answer', () => {
    const diags = checkLetter({
      meta: meta(),
      letterText: 'Dear Editor,',
      profile: profileWith(
        rules([requirement('journalFit', 'required'), requirement('competingInterests', 'required')]),
      ),
      authors: authorsWithCorresponding,
    });
    expect(diags.filter((d) => d.id === 'letter.assertion-missing')).toHaveLength(2);
    expect(diags.every((d) => d.severity === 'error')).toBe(true);
    expect(diags[0]?.surface).toBe('letter');
    expect(diags[0]?.target?.assertionId).toBe('journalFit');
  });

  it('does not fire for an optional assertion', () => {
    const diags = checkLetter({
      meta: meta(),
      letterText: '',
      profile: profileWith(rules([requirement('suggestedReviewers', 'optional')])),
      authors: authorsWithCorresponding,
    });
    expect(diags).toEqual([]);
  });

  it('stops asking once the author says they wrote it in their own words', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [{ id: 'journalFit', placement: 'inline-prose', text: null, reason: null }],
      }),
      letterText: 'This work suits your readership because…',
      profile: profileWith(rules([requirement('journalFit', 'required')])),
      authors: authorsWithCorresponding,
    });
    expect(diags).toEqual([]);
  });

  it('accepts not-applicable only with a reason', () => {
    expect(() =>
      meta({ assertions: [{ id: 'animalCare', placement: 'not-applicable', text: null, reason: null }] }),
    ).toThrow();
    const diags = checkLetter({
      meta: meta({
        assertions: [
          { id: 'animalCare', placement: 'not-applicable', text: null, reason: 'no animal work' },
        ],
      }),
      letterText: '',
      profile: profileWith(rules([requirement('animalCare', 'required')])),
      authors: authorsWithCorresponding,
    });
    expect(diags).toEqual([]);
  });

  it('quotes the venue and cites its URL when the profile carries them', () => {
    const diags = checkLetter({
      meta: meta(),
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

describe('letter.assertion-misplaced and -not-rendered', () => {
  it('warns when the venue wants it on the submission form', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [
          { id: 'suggestedReviewers', placement: 'directive', text: 'Dr A, Dr B', reason: null },
        ],
      }),
      letterText: '::assert{suggestedReviewers}',
      profile: profileWith(
        rules([requirement('suggestedReviewers', 'elsewhere', { vehicle: 'submission-form' })]),
      ),
      authors: authorsWithCorresponding,
    });
    expect(diags.map((d) => d.id)).toContain('letter.assertion-misplaced');
  });

  it('warns when an answered directive never appears in the prose', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [
          { id: 'competingInterests', placement: 'directive', text: 'We declare none.', reason: null },
        ],
      }),
      letterText: 'Dear Editor, please find attached.',
      profile: profileWith(rules([requirement('competingInterests', 'required')])),
      authors: authorsWithCorresponding,
    });
    expect(diags.map((d) => d.id)).toContain('letter.assertion-not-rendered');
  });

  it('is satisfied by the ::assert directive naming that id', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [
          { id: 'competingInterests', placement: 'directive', text: 'We declare none.', reason: null },
        ],
      }),
      letterText: 'We have nothing to declare. ::assert{competingInterests}',
      profile: profileWith(rules([requirement('competingInterests', 'required')])),
      authors: authorsWithCorresponding,
    });
    expect(diags.map((d) => d.id)).not.toContain('letter.assertion-not-rendered');
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
      meta: meta({
        assertions: [
          { id: 'dataLocation', placement: 'directive', text: 'Data and analysis code will be made available upon publication.', reason: null },
        ],
      }),
      letterText: 'Data and analysis code will be made available upon publication. ::assert{dataLocation}',
      profile: profileWith(dataRules),
      authors: authorsWithCorresponding,
    });
    const hit = diags.find((d) => d.id === 'letter.data-location-unspecified');
    expect(hit?.severity).toBe('error');
  });

  it('clears once a repository is actually named', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [{ id: 'dataLocation', placement: 'directive', text: 'See Zenodo.', reason: null }],
        dataLocations: [
          { repository: 'Zenodo', accession: '10.5281/zenodo.1', restrictions: null, availableAt: 'on-publication' },
        ],
      }),
      letterText: '::assert{dataLocation}',
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
        meta: meta({
          abbreviatedSummary: s,
          assertions: [{ id: 'abbreviatedSummary', placement: 'directive', text: s, reason: null }],
        }),
        letterText: `::assert{abbreviatedSummary}`,
        profile: profileWith(capped),
        authors: authorsWithCorresponding,
      }).map((d) => d.id);
    expect(run(at)).not.toContain('letter.summary-over-limit');
    expect(run(over)).toContain('letter.summary-over-limit');
  });

  it('counts spaces', () => {
    // 322 characters of text plus two spaces = 324.
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
      meta: meta({
        assertions: [{ id: 'correspondingContact', placement: 'inline-prose', text: null, reason: null }],
      }),
      letterText: '',
      profile: profileWith(contactRules),
      authors: authorsWithoutCorresponding,
    });
    const hit = diags.find((d) => d.id === 'letter.corresponding-contact-missing');
    expect(hit?.severity).toBe('error');
  });

  it('clears when one is', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [{ id: 'correspondingContact', placement: 'inline-prose', text: null, reason: null }],
      }),
      letterText: '',
      profile: profileWith(contactRules),
      authors: authorsWithCorresponding,
    });
    expect(diags.map((d) => d.id)).not.toContain('letter.corresponding-contact-missing');
  });
});

describe('letter.contradicts-manuscript', () => {
  const ciRules = rules([requirement('competingInterests', 'required')]);

  it('warns when the letter declares none and the manuscript declares some', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [
          { id: 'competingInterests', placement: 'directive', text: 'We declare no competing interests.', reason: null },
        ],
      }),
      letterText: '::assert{competingInterests}',
      profile: profileWith(ciRules),
      authors: authorsWithCorresponding,
      manuscriptCompetingInterests: 'A.H. holds equity in Example Therapeutics.',
    });
    expect(diags.map((d) => d.id)).toContain('letter.contradicts-manuscript');
  });

  it('stays quiet when both declare none', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [
          { id: 'competingInterests', placement: 'directive', text: 'We declare no competing interests.', reason: null },
        ],
      }),
      letterText: '::assert{competingInterests}',
      profile: profileWith(ciRules),
      authors: authorsWithCorresponding,
      manuscriptCompetingInterests: 'The authors declare no competing interests.',
    });
    expect(diags.map((d) => d.id)).not.toContain('letter.contradicts-manuscript');
  });

  it('stays quiet when the manuscript says nothing', () => {
    const diags = checkLetter({
      meta: meta({
        assertions: [
          { id: 'competingInterests', placement: 'directive', text: 'We declare none.', reason: null },
        ],
      }),
      letterText: '::assert{competingInterests}',
      profile: profileWith(ciRules),
      authors: authorsWithCorresponding,
      manuscriptCompetingInterests: null,
    });
    expect(diags.map((d) => d.id)).not.toContain('letter.contradicts-manuscript');
  });
});

describe('the seeded skeleton against a real bundled profile', () => {
  it('a PNAS letter produces no assertion-missing, because PNAS does not request one', () => {
    const pnas = getBundledProfile('pnas');
    expect(pnas).not.toBeNull();
    expect(pnas?.letters?.stance.submission).toBe('not-requested');
    const diags = checkLetter({
      meta: meta({ targetProfileId: 'pnas' }),
      letterText: 'Dear Editor,',
      profile: pnas!,
      authors: authorsWithCorresponding,
    });
    expect(diags.filter((d) => d.id === 'letter.assertion-missing')).toEqual([]);
  });

  it('a Science letter with an untouched skeleton flags every required item', () => {
    const science = getBundledProfile('science');
    const required = (science?.letters?.assertions ?? []).filter((a) => a.stance === 'required');
    expect(required.length).toBeGreaterThan(0);
    const diags = checkLetter({
      meta: meta({ targetProfileId: 'science' }),
      letterText: 'Dear Editor,',
      profile: science!,
      authors: authorsWithoutCorresponding,
    });
    expect(diags.filter((d) => d.id === 'letter.assertion-missing')).toHaveLength(required.length);
  });

  it('emptyCoverLetterMeta pre-populates the required set, all unanswered', () => {
    const science = getBundledProfile('science');
    const required = (science?.letters?.assertions ?? [])
      .filter((a) => a.stance === 'required')
      .map((a) => a.id);
    const seeded = emptyCoverLetterMeta({
      letterKind: 'submission',
      targetProfileId: 'science',
      requiredAssertions: required,
      covers: [],
    });
    expect(seeded.assertions.map((a) => a.id)).toEqual(required);
    expect(seeded.assertions.every((a) => a.text === null)).toBe(true);
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
