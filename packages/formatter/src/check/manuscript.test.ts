import { describe, expect, it } from 'vitest';
import {
  checkManuscript,
  countWords,
  WORDS_PER_REFERENCE_ESTIMATE,
  type ManuscriptCheckInput,
} from './manuscript';
import type { Diagnostic } from './types';
import { apjProfile, makeManuscript, makeSectionTexts, words } from './testkit';

function byId(diags: Diagnostic[], id: string): Diagnostic[] {
  return diags.filter((d) => d.id === id);
}

function makeInput(overrides?: Partial<ManuscriptCheckInput>): ManuscriptCheckInput {
  return {
    manuscript: makeManuscript(),
    sectionTexts: makeSectionTexts(),
    referenceCount: 40,
    ...overrides,
  };
}

describe('countWords', () => {
  it('counts markdown words, ignoring pure punctuation tokens', () => {
    expect(countWords('# Heading\n\nSome **bold** text - with 7 words')).toBe(7);
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
    expect(countWords(words(123))).toBe(123);
  });
});

describe('checkManuscript — clean pass and article-type selection', () => {
  it('reports nothing for a compliant ApJ article', () => {
    expect(checkManuscript(makeInput(), apjProfile(), 'apj-article')).toEqual([]);
  });

  it('throws on an unknown article type id', () => {
    expect(() => checkManuscript(makeInput(), apjProfile(), 'nope')).toThrow(/unknown article type/);
  });
});

describe('checkManuscript — abstract word limit', () => {
  it('flags an abstract over the limit with both counts in the message', () => {
    const input = makeInput();
    input.manuscript.abstract.content = words(300);
    const diags = checkManuscript(input, apjProfile(), 'apj-article');
    const abs = byId(diags, 'ms.abstract-words');
    expect(abs).toHaveLength(1);
    expect(abs[0]?.severity).toBe('error');
    expect(abs[0]?.surface).toBe('manuscript');
    expect(abs[0]?.message).toContain('300');
    expect(abs[0]?.message).toContain('250');
    expect(abs[0]?.message).toContain('journals.aas.org');
    expect(abs[0]?.target).toEqual({ sectionPath: 'abstract' });
  });

  it('skips the rule when the profile states no abstract limit', () => {
    const profile = apjProfile();
    const articleType = profile.manuscript.articleTypes[0];
    if (articleType === undefined) throw new Error('fixture profile lost its article type');
    articleType.abstractWordLimit = null;
    const input = makeInput();
    input.manuscript.abstract.content = words(5000);
    expect(byId(checkManuscript(input, profile, 'apj-article'), 'ms.abstract-words')).toEqual([]);
  });
});

describe('checkManuscript — total word limit (RNAAS-style, references included)', () => {
  // Fixture totals: abstract 100 + sections 900 + captions 10 = 1010 counted words.
  it('adds estimated reference words when the scope says "including references"', () => {
    const diags = checkManuscript(makeInput(), apjProfile(), 'rnaas');
    const wl = byId(diags, 'ms.word-limit');
    expect(wl).toHaveLength(1);
    // hard limit -> error severity
    expect(wl[0]?.severity).toBe('error');
    const expectedTotal = 1010 + 40 * WORDS_PER_REFERENCE_ESTIMATE; // 1610
    expect(wl[0]?.message).toContain(`~${expectedTotal}`);
    expect(wl[0]?.message).toContain('1500');
    expect(wl[0]?.message).toContain('including references');
  });

  it('stays under the limit when few enough references are cited', () => {
    // 1010 + 30*15 = 1460 <= 1500.
    const diags = checkManuscript(makeInput({ referenceCount: 30 }), apjProfile(), 'rnaas');
    expect(byId(diags, 'ms.word-limit')).toEqual([]);
  });

  it('does not count references or captions when the scope excludes them', () => {
    const profile = apjProfile();
    const rnaas = profile.manuscript.articleTypes[1];
    if (rnaas === undefined) throw new Error('fixture profile lost its article type');
    rnaas.wordLimit = { max: 1005, scope: 'main text only', hard: true };
    // Counted: abstract 100 + sections 900 = 1000 <= 1005; references/captions excluded.
    expect(byId(checkManuscript(makeInput(), profile, 'rnaas'), 'ms.word-limit')).toEqual([]);
    rnaas.wordLimit = { max: 995, scope: 'main text only', hard: true };
    const wl = byId(checkManuscript(makeInput(), profile, 'rnaas'), 'ms.word-limit');
    expect(wl).toHaveLength(1);
    expect(wl[0]?.message).toContain('1000');
    expect(wl[0]?.message).not.toContain('~');
  });

  it('soft limits produce warnings, not errors', () => {
    const profile = apjProfile();
    const rnaas = profile.manuscript.articleTypes[1];
    if (rnaas === undefined) throw new Error('fixture profile lost its article type');
    rnaas.wordLimit = { max: 1500, scope: 'total, including references and captions', hard: false };
    const wl = byId(checkManuscript(makeInput(), profile, 'rnaas'), 'ms.word-limit');
    expect(wl).toHaveLength(1);
    expect(wl[0]?.severity).toBe('warning');
  });

  it('skips the rule when the profile states no word limit', () => {
    const input = makeInput({ sectionTexts: { 'sections/intro.md': words(90000) } });
    expect(byId(checkManuscript(input, apjProfile(), 'apj-article'), 'ms.word-limit')).toEqual([]);
  });
});

describe('checkManuscript — title and running head', () => {
  it('flags a title over the stated character limit', () => {
    const profile = apjProfile();
    const articleType = profile.manuscript.articleTypes[0];
    if (articleType === undefined) throw new Error('fixture profile lost its article type');
    articleType.titleLimitChars = 20;
    const diags = checkManuscript(makeInput(), profile, 'apj-article');
    const title = byId(diags, 'ms.title-chars');
    expect(title).toHaveLength(1);
    // 'Star formation in dwarf galaxies' is 32 characters.
    expect(title[0]?.message).toContain('32');
    expect(title[0]?.message).toContain('20');
  });

  it('flags a running head over the limit and skips when unstated', () => {
    const profile = apjProfile();
    profile.manuscript.runningHeadLimitChars = 10;
    const diags = checkManuscript(makeInput(), profile, 'apj-article');
    const rh = byId(diags, 'ms.running-head');
    expect(rh).toHaveLength(1);
    // 'Dwarf star formation' is 20 characters.
    expect(rh[0]?.message).toContain('20');
    expect(rh[0]?.message).toContain('10');

    profile.manuscript.runningHeadLimitChars = null;
    expect(byId(checkManuscript(makeInput(), profile, 'apj-article'), 'ms.running-head')).toEqual(
      [],
    );
  });
});

describe('checkManuscript — required sections', () => {
  it('maps acknowledgments to backMatter.acknowledgements', () => {
    const input = makeInput();
    input.manuscript.backMatter.acknowledgements = null;
    const diags = checkManuscript(input, apjProfile(), 'apj-article');
    const missing = byId(diags, 'ms.section-missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('Acknowledgments');
    expect(missing[0]?.target).toEqual({ sectionPath: 'acknowledgments' });
  });

  it('matches generic required sections against body headings', () => {
    const profile = apjProfile();
    profile.manuscript.requiredSections.push({ id: 'methods', label: 'Methods', required: true });
    expect(byId(checkManuscript(makeInput(), profile, 'apj-article'), 'ms.section-missing')).toEqual(
      [],
    );

    const input = makeInput();
    input.manuscript.body = input.manuscript.body.filter(
      (node) => node.kind !== 'section' || node.heading !== 'Methods',
    );
    const missing = byId(checkManuscript(input, profile, 'apj-article'), 'ms.section-missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('Methods');
  });

  it('matches headings case-insensitively and through punctuation', () => {
    const profile = apjProfile();
    profile.manuscript.requiredSections.push({
      id: 'materials-methods',
      label: 'Materials & Methods',
      required: true,
    });
    const input = makeInput();
    const methods = input.manuscript.body[1];
    if (methods === undefined || methods.kind !== 'section') throw new Error('fixture body changed');
    methods.heading = 'MATERIALS  &  METHODS';
    expect(byId(checkManuscript(input, profile, 'apj-article'), 'ms.section-missing')).toEqual([]);
  });

  it('ignores sections the profile lists as not required', () => {
    const profile = apjProfile();
    profile.manuscript.requiredSections.push({ id: 'appendix', label: 'Appendix', required: false });
    expect(byId(checkManuscript(makeInput(), profile, 'apj-article'), 'ms.section-missing')).toEqual(
      [],
    );
  });
});

describe('checkManuscript — availability statements', () => {
  it('flags a required data statement that is empty', () => {
    const input = makeInput();
    input.manuscript.availability.data = '   ';
    const diags = checkManuscript(input, apjProfile(), 'apj-article');
    const data = byId(diags, 'ms.availability-data');
    expect(data).toHaveLength(1);
    expect(data[0]?.severity).toBe('error');
    expect(data[0]?.target).toEqual({ sectionPath: 'availability.data' });
  });

  it('skips the code statement when the profile does not state it (null)', () => {
    const input = makeInput();
    input.manuscript.availability.code = '';
    // apj profile: availabilityStatements.code === null -> skipped.
    expect(byId(checkManuscript(input, apjProfile(), 'apj-article'), 'ms.availability-code')).toEqual(
      [],
    );
  });

  it('flags a required code statement that is empty', () => {
    const profile = apjProfile();
    profile.manuscript.availabilityStatements.code = true;
    const input = makeInput();
    input.manuscript.availability.code = '';
    const code = byId(checkManuscript(input, profile, 'apj-article'), 'ms.availability-code');
    expect(code).toHaveLength(1);
  });
});

describe('checkManuscript — display items and reference count', () => {
  it('flags display items over the article-type limit (figures + tables)', () => {
    const input = makeInput({ referenceCount: 10 });
    input.manuscript.tables.push({
      id: 'tab1',
      namespace: 'main',
      source: 'native',
      caption: { title: 'A table' },
      footnotes: [],
    });
    const diags = checkManuscript(input, apjProfile(), 'rnaas');
    const items = byId(diags, 'ms.display-items');
    expect(items).toHaveLength(1);
    expect(items[0]?.message).toContain('2 display items');
    expect(items[0]?.message).toContain('limit of 1');
  });

  it('flags reference count over the article-type limit', () => {
    const profile = apjProfile();
    const articleType = profile.manuscript.articleTypes[0];
    if (articleType === undefined) throw new Error('fixture profile lost its article type');
    articleType.maxReferences = 30;
    const refs = byId(
      checkManuscript(makeInput({ referenceCount: 40 }), profile, 'apj-article'),
      'ms.max-references',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.message).toContain('40');
    expect(refs[0]?.message).toContain('30');
  });

  it('falls back to the citations-level maxReferences when the article type states none', () => {
    const profile = apjProfile();
    profile.citations.maxReferences = 35;
    expect(
      byId(
        checkManuscript(makeInput({ referenceCount: 40 }), profile, 'apj-article'),
        'ms.max-references',
      ),
    ).toHaveLength(1);
    expect(
      byId(
        checkManuscript(makeInput({ referenceCount: 35 }), profile, 'apj-article'),
        'ms.max-references',
      ),
    ).toEqual([]);
  });
});

describe('checkManuscript — null-rule profile skips everything', () => {
  it('reports nothing when the journal states no rules at all', () => {
    const profile = apjProfile();
    profile.manuscript.articleTypes = [
      {
        id: 'anything-goes',
        name: 'Anything Goes',
        wordLimit: null,
        abstractWordLimit: null,
        titleLimitChars: null,
        maxDisplayItems: null,
        maxReferences: null,
      },
    ];
    profile.manuscript.runningHeadLimitChars = null;
    profile.manuscript.requiredSections = [];
    profile.manuscript.availabilityStatements = { data: null, code: null };
    profile.citations.maxReferences = null;

    const input = makeInput({ referenceCount: 10_000 });
    input.manuscript.abstract.content = words(5000);
    input.manuscript.availability.data = '';
    input.manuscript.availability.code = '';
    input.manuscript.backMatter.acknowledgements = null;
    expect(checkManuscript(input, profile, 'anything-goes')).toEqual([]);
  });
});
