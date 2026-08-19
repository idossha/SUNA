import { describe, expect, it } from 'vitest';
import {
  checkManuscript,
  countWords,
  scanFigureReferences,
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
    const input = makeInput({ sectionTexts: { 'manuscript.md': words(90000) } });
    expect(byId(checkManuscript(input, apjProfile(), 'apj-article'), 'ms.word-limit')).toEqual([]);
  });
});

describe('checkManuscript — title', () => {
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

  it('matches generic required sections against the prose headings', () => {
    const profile = apjProfile();
    profile.manuscript.requiredSections.push({ id: 'methods', label: 'Methods', required: true });
    expect(byId(checkManuscript(makeInput(), profile, 'apj-article'), 'ms.section-missing')).toEqual(
      [],
    );

    // Drop the Methods heading from manuscript.md — the section is gone.
    const input = makeInput({
      sectionTexts: { 'manuscript.md': '# Introduction\n\nintro\n\n# Results\n\nresults' },
    });
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
    const input = makeInput({
      sectionTexts: { 'manuscript.md': '## MATERIALS  &  METHODS\n\nwe did things' },
    });
    expect(byId(checkManuscript(input, profile, 'apj-article'), 'ms.section-missing')).toEqual([]);
  });

  it('a "#" inside a fenced code block is code, not a section heading', () => {
    const profile = apjProfile();
    profile.manuscript.requiredSections.push({ id: 'methods', label: 'Methods', required: true });
    const input = makeInput({
      sectionTexts: { 'manuscript.md': '# Introduction\n\n```sh\n# Methods\n```\n' },
    });
    const missing = byId(checkManuscript(input, profile, 'apj-article'), 'ms.section-missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('Methods');
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

describe('scanFigureReferences — own vs foreign figures', () => {
  it('collects plain references in all spellings', () => {
    const scan = scanFigureReferences(['Figure 1 shows X. See also Fig. 2 and fig 3b.']);
    expect([...scan.cited].sort()).toEqual([1, 2, 3]);
    expect(scan.foreign.size).toBe(0);
  });

  it('expands lists and ranges: "Figs. 2, 3 and 5" and "Figures 1–3"', () => {
    expect([...scanFigureReferences(['Figs. 2, 3 and 5 agree.']).cited].sort()).toEqual([2, 3, 5]);
    expect([...scanFigureReferences(['Figures 1–3 agree.']).cited].sort()).toEqual([1, 2, 3]);
  });

  it('a bare capitalized surname before the figure word is author-adjacent (Gao Figure 2D)', () => {
    const scan = scanFigureReferences(['This mirrors the morphology in Gao Figure 2D.']);
    expect(scan.cited.size).toBe(0);
    expect([...scan.foreign]).toEqual([2]);
  });

  it('"(Author et al. Figure 3)" is foreign', () => {
    const scan = scanFigureReferences(['The excess was reported before (Nandra et al. Figure 3).']);
    expect(scan.cited.size).toBe(0);
    expect([...scan.foreign]).toEqual([3]);
  });

  it('the tricky trailing form "as shown in Figure 2 of Gao et al." is foreign', () => {
    const scan = scanFigureReferences(['The bar is prominent, as shown in Figure 2 of Gao et al.']);
    expect(scan.cited.size).toBe(0);
    expect([...scan.foreign]).toEqual([2]);
  });

  it('"Figure 3 in Smith (2020)" and "Figure 4 from Zhang" are foreign', () => {
    const scan = scanFigureReferences(['Compare Figure 3 in Smith (2020) and Figure 4 from Zhang.']);
    expect(scan.cited.size).toBe(0);
    expect([...scan.foreign].sort()).toEqual([3, 4]);
  });

  it('sentence-start and common capitalized words are NOT author-adjacent', () => {
    const scan = scanFigureReferences([
      'Figure 1 shows the field. See Figure 2. In Figure 3 we mark the bar. Compare Figure 4.',
    ]);
    expect([...scan.cited].sort()).toEqual([1, 2, 3, 4]);
    expect(scan.foreign.size).toBe(0);
  });

  it('a sentence-ending period breaks author adjacency ("...of Gao. Figure 2 shows")', () => {
    const scan = scanFigureReferences(['We follow the cuts of Gao. Figure 2 shows the result.']);
    expect([...scan.cited]).toEqual([2]);
    expect(scan.foreign.size).toBe(0);
  });

  it('once a number is author-adjacent it stays foreign for the whole document, in either order', () => {
    const forward = scanFigureReferences([
      'A bar appears in Gao Figure 3.',
      'Figure 3 is striking in that regard.',
    ]);
    expect(forward.cited.size).toBe(0);
    expect([...forward.foreign]).toEqual([3]);

    const backward = scanFigureReferences([
      'Figure 3 is striking in that regard.',
      'A bar appears in Gao Figure 3.',
    ]);
    expect(backward.cited.size).toBe(0);
    expect([...backward.foreign]).toEqual([3]);
  });

  it("a possessive surname is author-adjacent even at sentence start (Gao's Figure 3)", () => {
    const scan = scanFigureReferences(["Gao's Figure 3 shows a comparable bar."]);
    expect(scan.cited.size).toBe(0);
    expect([...scan.foreign]).toEqual([3]);
  });

  it('Extended Data and Supplementary figures are neither cited nor foreign', () => {
    const scan = scanFigureReferences(['Extended Data Figure 7 and Supplementary Figure 9 expand on this.']);
    expect(scan.cited.size).toBe(0);
    expect(scan.foreign.size).toBe(0);
  });
});

describe('checkManuscript — figure cross-references ignore foreign figures', () => {
  function inputWithProse(prose: string, figureCount = 1): ManuscriptCheckInput {
    const input = makeInput();
    input.sectionTexts = { 'manuscript.md': prose };
    for (let i = 2; i <= figureCount; i++) {
      input.manuscript.figures.push({
        id: `fig${i}`,
        namespace: 'main',
        canvasRef: `figures/fig${i}/figure.svg`,
        widthPreset: 'single',
        caption: { title: words(3), body: words(4) },
        panels: [],
      });
    }
    return input;
  }

  it('a compliant prose citing every figure reports nothing', () => {
    const input = inputWithProse('Figure 1 shows the field and Figure 2 the residuals.', 2);
    expect(checkManuscript(input, apjProfile(), 'apj-article')).toEqual([]);
  });

  it('flags a prose reference to a figure that does not exist', () => {
    const input = inputWithProse('Figure 1 shows the field; Figure 3 shows residuals.', 1);
    const unknown = byId(checkManuscript(input, apjProfile(), 'apj-article'), 'ms.figure-ref-unknown');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.severity).toBe('error');
    expect(unknown[0]?.message).toContain('Figure 3');
    expect(unknown[0]?.message).toContain('only 1 main figure');
  });

  it("does NOT flag other papers' figures: 'Gao Figure 2D' with a single own figure", () => {
    const input = inputWithProse('Our map matches Gao Figure 2D closely.', 1);
    expect(byId(checkManuscript(input, apjProfile(), 'apj-article'), 'ms.figure-ref-unknown')).toEqual([]);
  });

  it("the trailing form 'as shown in Figure 2 of Gao et al.' does not count as citing our Figure 2", () => {
    const input = inputWithProse(
      'Figure 1 shows the disc, as shown in Figure 2 of Gao et al. for their sample.',
      2,
    );
    const diags = checkManuscript(input, apjProfile(), 'apj-article');
    expect(byId(diags, 'ms.figure-ref-unknown')).toEqual([]);
    const uncited = byId(diags, 'ms.figure-uncited');
    expect(uncited).toHaveLength(1);
    expect(uncited[0]?.severity).toBe('warning');
    expect(uncited[0]?.target).toEqual({ figureId: 'fig2' });
    expect(uncited[0]?.message).toContain('author names');
  });

  it('a number stays foreign document-wide: later bare "Figure 3" is not flagged as unknown', () => {
    const input = inputWithProse(
      'Figure 1 shows the field. A bar appears in Gao Figure 3. Figure 3 is striking.',
      1,
    );
    expect(byId(checkManuscript(input, apjProfile(), 'apj-article'), 'ms.figure-ref-unknown')).toEqual([]);
  });

  it('warns on an uncited own figure once the prose cites figures at all', () => {
    const input = inputWithProse('Only Figure 1 is discussed here.', 2);
    const uncited = byId(checkManuscript(input, apjProfile(), 'apj-article'), 'ms.figure-uncited');
    expect(uncited).toHaveLength(1);
    expect(uncited[0]?.message).toContain('Figure 2');
    expect(uncited[0]?.target).toEqual({ figureId: 'fig2' });
  });

  it('stays silent on uncited figures while the prose has no figure references (early draft)', () => {
    expect(checkManuscript(makeInput(), apjProfile(), 'apj-article')).toEqual([]);
  });

  it('Extended Data references neither satisfy nor break main-figure checks', () => {
    const input = inputWithProse('Figure 1 shows the field; Extended Data Figure 9 expands it.', 1);
    expect(checkManuscript(input, apjProfile(), 'apj-article')).toEqual([]);
  });
});

describe('checkManuscript — stageSeverity remaps limit severities by submission stage', () => {
  function stagedProfile() {
    const profile = apjProfile();
    profile.manuscript.stageSeverity = { 'initial-submission': 'warning', accepted: 'error' };
    return profile;
  }

  it('downgrades limit errors to warnings at the default initial-submission stage', () => {
    const input = makeInput();
    input.manuscript.abstract.content = words(300);
    const abs = byId(checkManuscript(input, stagedProfile(), 'apj-article'), 'ms.abstract-words');
    expect(abs).toHaveLength(1);
    expect(abs[0]?.severity).toBe('warning');
  });

  it('downgrades even a hard word limit at initial submission, and restores it when accepted', () => {
    const initial = byId(checkManuscript(makeInput(), stagedProfile(), 'rnaas'), 'ms.word-limit');
    expect(initial).toHaveLength(1);
    expect(initial[0]?.severity).toBe('warning');

    const accepted = byId(
      checkManuscript(makeInput(), stagedProfile(), 'rnaas', 'accepted'),
      'ms.word-limit',
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.severity).toBe('error');
  });

  it('a stage without an entry keeps intrinsic severities', () => {
    const input = makeInput();
    input.manuscript.abstract.content = words(300);
    const abs = byId(
      checkManuscript(input, stagedProfile(), 'apj-article', 'revision'),
      'ms.abstract-words',
    );
    expect(abs[0]?.severity).toBe('error');
  });

  it('never remaps structural checks: a missing required section stays an error', () => {
    const input = makeInput();
    input.manuscript.backMatter.acknowledgements = null;
    const missing = byId(
      checkManuscript(input, stagedProfile(), 'apj-article'),
      'ms.section-missing',
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]?.severity).toBe('error');
  });

  it('profiles without stageSeverity behave identically at every stage', () => {
    const input = makeInput();
    input.manuscript.abstract.content = words(300);
    for (const stage of ['initial-submission', 'revision', 'accepted'] as const) {
      const abs = byId(
        checkManuscript(input, apjProfile(), 'apj-article', stage),
        'ms.abstract-words',
      );
      expect(abs[0]?.severity).toBe('error');
    }
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
