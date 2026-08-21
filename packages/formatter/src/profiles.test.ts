import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PublisherProfileSchema, type PublisherProfile, type ArticleTypeRules } from '@suna/core';
import {
  BUNDLED_PROFILE_IDS,
  loadProfile,
  type BundledProfileId,
} from './profiles';

// Robust regardless of runtime: prefer import.meta.dirname (Node >= 20.11),
// fall back to deriving it from import.meta.url.
const here: string = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
// packages/formatter/src -> repo root -> resources/profiles
const profilesDir = join(here, '..', '..', '..', 'resources', 'profiles');

function readProfileJson(id: string): unknown {
  return JSON.parse(readFileSync(join(profilesDir, `${id}.json`), 'utf8'));
}

const profiles: Record<BundledProfileId, PublisherProfile> = Object.fromEntries(
  BUNDLED_PROFILE_IDS.map((id) => [id, loadProfile(readProfileJson(id))]),
) as Record<BundledProfileId, PublisherProfile>;

function articleType(profile: PublisherProfile, id: string): ArticleTypeRules {
  const found = profile.manuscript.articleTypes.find((t) => t.id === id);
  if (!found) {
    throw new Error(`profile ${profile.id} has no article type "${id}"`);
  }
  return found;
}

// feature-plan-6.md §1: journal-profile research pass 2 (2026-08-15) added these
// eight journals; author-guidelines-findings-2.json is the source of every
// non-null value below. lastVerified differs from the first research pass
// (2026-08-13) because these were extracted in a separate session.
const SECOND_PASS_IDS = [
  'nature',
  'neuron',
  'pnas',
  'brain-stimulation',
  'sleep',
  'sleep-advances',
  'jne',
  'jneurosci',
] as const;

/**
 * The house style is bundled but is NOT a journal profile: it states no
 * journal's rules, so every assertion below about official source URLs and
 * research-pass dates applies to the journal profiles only. Its own
 * invariants — which are different, and stricter in one respect — live in
 * "the SUNA house style" at the bottom of this file.
 */
const HOUSE_STYLE_IDS: readonly string[] = ['suna'];
const JOURNAL_PROFILE_IDS = BUNDLED_PROFILE_IDS.filter((id) => !HOUSE_STYLE_IDS.includes(id));

describe('bundled publisher profiles', () => {
  it('lists exactly the nine journal ids, plus the house style', () => {
    expect([...BUNDLED_PROFILE_IDS].sort()).toEqual([...JOURNAL_PROFILE_IDS, 'suna'].sort());
    expect([...JOURNAL_PROFILE_IDS].sort()).toEqual(
      [
        'science',
        'nature',
        'neuron',
        'pnas',
        'brain-stimulation',
        'sleep',
        'sleep-advances',
        'jne',
        'jneurosci',
      ].sort(),
    );
  });

  for (const id of BUNDLED_PROFILE_IDS) {
    describe(id, () => {
      const profile = profiles[id];

      it('validates against PublisherProfileSchema', () => {
        const parsed = PublisherProfileSchema.parse(readProfileJson(id));
        expect(parsed.schemaVersion).toBe(3);
      });

      if (HOUSE_STYLE_IDS.includes(id)) return;

      it('id matches its filename and lastVerified is the extraction date', () => {
        expect(profile.id).toBe(id);
        // brain-stimulation was re-verified against the LIVE ScienceDirect
        // guide on 2026-08-17 (the earlier pass was 403-blocked).
        const expectedDate =
          id === 'brain-stimulation'
            ? '2026-08-17'
            : (SECOND_PASS_IDS as readonly string[]).includes(id)
              ? '2026-08-15'
              : '2026-08-13';
        expect(profile.lastVerified).toBe(expectedDate);
      });

      it('every section carries at least one official source URL', () => {
        for (const sources of [
          profile.citations.sources,
          profile.figures.sources,
          profile.manuscript.sources,
        ]) {
          expect(sources.length).toBeGreaterThanOrEqual(1);
          for (const url of sources) {
            expect(url).toMatch(/^https?:\/\//);
          }
        }
      });
    });
  }
});

describe('science facts from AAAS instructions', () => {
  const sci = profiles['science'];

  it('citations: parenthetical numeric in order of appearance, ranges collapsed, et al. banned', () => {
    expect(sci.citations.mode).toBe('parenthetical-numeric');
    expect(sci.citations.collapseRanges).toBe(true);
    expect(sci.citations.referenceList.sortOrder).toBe('appearance');
    expect(sci.citations.referenceList.authorTruncation.etAlAllowed).toBe(false);
  });

  it('figures: 9/18.3 cm column presets from the 2025 guide, sans-serif, bold uppercase panel letters', () => {
    expect(sci.figures.widthPresetsMm.single).toBe(90);
    expect(sci.figures.widthPresetsMm.double).toBe(183);
    expect(sci.figures.preferredFontFamilies).toContain('Arial');
    expect(sci.figures.lineWeightPt.min).toBe(0.28);
    expect(sci.figures.panelLabel).toEqual({ letterCase: 'upper', weight: 'bold', wrapper: 'none' });
    expect(sci.figures.palette.redGreenDiscouraged).toBe(true);
  });

  it('manuscript: Research Article 3000 words / 125-word abstract / 96-char title / ~50 refs, single spacing', () => {
    const ra = articleType(sci, 'research-article');
    expect(ra.wordLimit?.max).toBe(3000);
    expect(ra.abstractWordLimit).toBe(125);
    expect(ra.titleLimitChars).toBe(96);
    expect(ra.maxReferences).toBe(50);
    expect(sci.manuscript.submissionFormat.doubleSpacing).toBe(false);
    expect(sci.manuscript.availabilityStatements).toEqual({ data: true, code: true });
  });
});

// The eight describe blocks below cover the journals added by the second
// research pass (feature-plan-6.md §1); every assertion cites the specific
// finding in docs/design/author-guidelines-findings-2.json it traces to.

describe('nature facts from the flagship Nature formatting guide', () => {
  const nat = profiles['nature'];

  it('citations: numeric superscript, >5-author et al. truncation, 50-ref guideline', () => {
    // findings-2.json Nature.citations: "reference numbers are superscript...";
    // "more than five, in which case only the first author...followed by 'et al.'"
    expect(nat.citations.mode).toBe('numeric-superscript');
    expect(nat.citations.authorYear).toBeNull();
    expect(nat.citations.referenceList.authorTruncation).toEqual({
      etAlAllowed: true,
      truncateWhenMoreThan: 5,
      keepFirstN: 1,
    });
    expect(articleType(nat, 'article').maxReferences).toBe(50);
  });

  it('figures: 89/183 mm columns (final-submission spec), 5-7 pt text, 0.25-1 pt lines, no palette requirement', () => {
    // findings-2.json Nature.figureRules: Final submission page numbers, chosen
    // over the conflicting Formatting-guide numbers (recorded in provenance).
    expect(nat.figures.widthPresetsMm.single).toBe(89);
    expect(nat.figures.widthPresetsMm.double).toBe(183);
    expect(nat.figures.minFontPt).toBe(5);
    expect(nat.figures.maxFontPt).toBe(7);
    expect(nat.figures.lineWeightPt).toEqual({ min: 0.25, max: 1 });
    // The flagship pages state no colorblind-safe palette rule — this
    // profile must not borrow one from a branded Nature journal.
    expect(nat.figures.palette.requirement).toBe('none-stated');
    expect(nat.figures.palette.suggestedHex).toBeNull();
  });

  it('manuscript: only "article" exists (no Letter format), 75-char title, 200-word summary, double-spaced with line numbers', () => {
    // findings-2.json Nature.notes: "NATURE HAS NO 'LETTER' OR 'BRIEF
    // COMMUNICATION' RESEARCH FORMAT".
    expect(nat.manuscript.articleTypes.map((t) => t.id)).toEqual(['article']);
    const article = articleType(nat, 'article');
    expect(article.titleLimitChars).toBe(75);
    expect(article.abstractWordLimit).toBe(200);
    expect(article.wordLimit?.hard).toBe(false);
    expect(nat.manuscript.submissionFormat.doubleSpacing).toBe(true);
    expect(nat.manuscript.submissionFormat.lineNumbers).toBe(true);
    expect(nat.manuscript.availabilityStatements).toEqual({ data: true, code: true });
  });
});

describe('neuron facts from the Cell Press guidelines', () => {
  const neuron = profiles['neuron'];

  it('citations: numeric superscript, et al. only after 10 authors', () => {
    // findings-2.json Neuron.citations: Cell Press referencing-style
    // announcement, "'Et al.' should be used only after 10 author names".
    expect(neuron.citations.mode).toBe('numeric-superscript');
    expect(neuron.citations.referenceList.authorTruncation).toEqual({
      etAlAllowed: true,
      truncateWhenMoreThan: 10,
      keepFirstN: 10,
    });
  });

  it('manuscript: Article 7000 words / 150-word Summary / 8 items; Report 4000 words / 4 items', () => {
    // findings-2.json Neuron.manuscriptLimits.
    const article = articleType(neuron, 'article');
    expect(article.wordLimit?.max).toBe(7000);
    expect(article.abstractWordLimit).toBe(150);
    expect(article.maxDisplayItems).toBe(8);
    const report = articleType(neuron, 'report');
    expect(report.wordLimit?.max).toBe(4000);
    expect(report.maxDisplayItems).toBe(4);
    expect(neuron.manuscript.availabilityStatements).toEqual({ data: true, code: true });
  });

  it('figures: 300 dpi floor from the tiered color/grayscale/line-art resolution rule', () => {
    // findings-2.json Neuron.figureRules: "at least 300 dpi is required...
    // at least 500 dpi... at least 1,000 dpi".
    expect(neuron.figures.formats.minDpi).toBe(300);
  });
});

describe('pnas facts from the PNAS author center', () => {
  const pnas = profiles['pnas'];

  it('citations: parenthetical numeric (not italic, not superscript), order of appearance', () => {
    // findings-2.json PNAS.citations: "(1, 2)" not italicized, distinguishing
    // it from Science's italic-parenthetical style.
    expect(pnas.citations.mode).toBe('parenthetical-numeric');
    expect(pnas.citations.referenceList.sortOrder).toBe('appearance');
  });

  it('manuscript: Research Report ~4000 words/50 refs/4 items, 250-word abstract; Brief Report 1600 words/15 refs', () => {
    // findings-2.json PNAS.manuscriptLimits.
    const report = articleType(pnas, 'research-report');
    expect(report.wordLimit?.max).toBe(4000);
    expect(report.abstractWordLimit).toBe(250);
    expect(report.maxReferences).toBe(50);
    expect(report.maxDisplayItems).toBe(4);
    const brief = articleType(pnas, 'brief-report');
    expect(brief.wordLimit?.max).toBe(1600);
    expect(brief.maxReferences).toBe(15);
  });

  it('requiredSections places Results before Materials and Methods (PNAS-distinctive ordering)', () => {
    const ids = pnas.manuscript.requiredSections.map((s) => s.id);
    expect(ids.indexOf('results')).toBeLessThan(ids.indexOf('materials-methods'));
  });
});

describe('brain-stimulation facts from the LIVE Elsevier guide for authors (2026-08-17)', () => {
  const brainStim = profiles['brain-stimulation'];

  it('citations: square-bracket Vancouver numbered, first 6 authors then et al., LTWA abbreviations', () => {
    // "Indicate references by number(s) in square brackets in line in the
    // text"; "for more than 6 authors the first 6 should be listed followed
    // by 'et al.'"; "Abbreviate journal names according to the List of Title
    // Word Abbreviations (LTWA)".
    expect(brainStim.citations.mode).toBe('parenthetical-numeric');
    expect(brainStim.citations.referenceList.sortOrder).toBe('appearance');
    expect(brainStim.citations.referenceList.authorTruncation).toEqual({
      etAlAllowed: true,
      truncateWhenMoreThan: 6,
      keepFirstN: 6,
    });
    expect(brainStim.citations.referenceList.journalAbbreviation).toBe('iso4');
  });

  it('manuscript: the article-type table — 4,000-word Original Research, 1,000-word strict Letters', () => {
    // "4,000 word limit (not including abstract / references / title page)";
    // "Structured abstract of up to 250 words"; Letters: "1,000 word body of
    // the letter strict limit", "Maximum of 10 references", "Maximum 1 table
    // or figure".
    const original = articleType(brainStim, 'original-research');
    expect(original.wordLimit?.max).toBe(4000);
    expect(original.abstractWordLimit).toBe(250);
    const letter = articleType(brainStim, 'letter-to-editor');
    expect(letter.wordLimit).toEqual({
      max: 1000,
      scope: 'body of the letter — excludes figure legends and tables',
      hard: true,
    });
    expect(letter.abstractWordLimit).toBeNull();
    expect(letter.maxReferences).toBe(10);
    expect(letter.maxDisplayItems).toBe(1);
    expect(articleType(brainStim, 'editorial').wordLimit?.max).toBe(3000);
  });

  it('manuscript: required Highlights, 1-7 keywords, CRediT contributions', () => {
    // "You are required to provide article highlights at submission … 3 to 5
    // bullet points, each a maximum of 85 characters"; "You are required to
    // provide 1 to 7 keywords"; "Corresponding authors are required to
    // acknowledge co-author contributions using CRediT".
    const ids = brainStim.manuscript.requiredSections.filter((s) => s.required).map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(['highlights', 'keywords', 'credit-contributions', 'competing-interests']),
    );
  });

  it('figures: EPS/PDF vector preferred, 300 dpi halftone floor, widths derived from stated pixel minimums', () => {
    // "Vector drawings: Save as EPS or PDF files"; "minimum of 300 dpi (for
    // single column width: min. 1063 pixels, full page width: 2244 pixels)"
    // -> 90 mm / 190 mm at 300 dpi.
    expect(brainStim.figures.formats.vectorPreferred).toEqual(['eps', 'pdf']);
    expect(brainStim.figures.formats.minDpi).toBe(300);
    expect(brainStim.figures.formats.rasterAccepted).toEqual(
      expect.arrayContaining(['tiff', 'jpg', 'png']),
    );
    expect(brainStim.figures.widthPresetsMm.single).toBe(90);
    expect(brainStim.figures.widthPresetsMm.double).toBe(190);
    expect(brainStim.figures.palette.requirement).toBe('colorblind-safe-recommended');
  });

  it('submission format: double spacing and line numbers are genuinely not stated', () => {
    expect(brainStim.manuscript.submissionFormat.doubleSpacing).toBeNull();
    expect(brainStim.manuscript.submissionFormat.lineNumbers).toBeNull();
  });
});

describe('sleep facts from the Oxford Academic author guidelines', () => {
  const sleep = profiles['sleep'];

  it('citations: bracketed numeric with hyphenated ranges, truncation starting AT 7 authors', () => {
    // findings-2.json SLEEP.citations: "Arabic numerals placed in brackets";
    // "a hyphen should be used to join the first and last numbers of a
    // series"; "Provide all authors' names when fewer than seven; when seven
    // or more, list the first three and add et al."
    expect(sleep.citations.collapseRanges).toBe(true);
    expect(sleep.citations.referenceList.authorTruncation).toEqual({
      etAlAllowed: true,
      // 6, not 7: the field is "the largest author count still printed in
      // full", and SLEEP truncates AT seven authors. Encoding 7 here would
      // print all seven names on a 7-author reference, which the rule forbids.
      truncateWhenMoreThan: 6,
      keepFirstN: 3,
    });
  });

  /**
   * Guards the off-by-one directly, in the consumer's terms: `maxAuthorsFor`
   * (export-content.ts) truncates only when `authorCount > truncateWhenMoreThan`,
   * so the boundary between six and seven authors is where SLEEP's rule bites.
   */
  it('citations: a 6-author reference stays full, a 7-author one truncates', () => {
    const { truncateWhenMoreThan } = sleep.citations.referenceList.authorTruncation;
    expect(truncateWhenMoreThan).not.toBeNull();
    const truncatesAt = (authorCount: number): boolean =>
      authorCount > (truncateWhenMoreThan as number);
    expect(truncatesAt(6)).toBe(false);
    expect(truncatesAt(7)).toBe(true);
  });

  it('manuscript: 250-word abstract, 120-word Statement of Significance section, no running title', () => {
    // findings-2.json SLEEP.manuscriptLimits.
    expect(articleType(sleep, 'original-article').abstractWordLimit).toBe(250);
    expect(
      sleep.manuscript.requiredSections.some((s) => s.id === 'statement-of-significance'),
    ).toBe(true);
    expect(sleep.manuscript.runningHeadLimitChars).toBeNull();
  });

  it('submissionFormat: double-spaced but explicitly NO line numbers (opposite of Nature)', () => {
    // findings-2.json SLEEP.submissionFormat: "Do not number the lines."
    expect(sleep.manuscript.submissionFormat.doubleSpacing).toBe(true);
    expect(sleep.manuscript.submissionFormat.lineNumbers).toBe(false);
  });
});

describe('sleep-advances facts from the Oxford Academic author guidelines', () => {
  const sleepAdv = profiles['sleep-advances'];

  it('does not inherit SLEEP\'s citation rules — every citation-mode field is a flagged placeholder', () => {
    // findings-2.json Sleep Advances.citations: the page is silent on
    // citation style; no-sibling-inference rule forbids borrowing SLEEP's.
    const entry = sleepAdv.citations.provenance?.find((e) => e.claim.includes('mode / collapseRanges'));
    expect(entry?.basis).toBe('inferred');
    expect(entry?.source).toBeNull();
    expect(sleepAdv.citations.referenceList.authorTruncation.truncateWhenMoreThan).toBeNull();
  });

  it('manuscript: Brief Research Report (2000 words/4 items/no abstract) is SLEEP-Advances-specific', () => {
    // findings-2.json Sleep Advances.manuscriptLimits.
    const brief = articleType(sleepAdv, 'brief-research-report');
    expect(brief.wordLimit).toEqual({
      max: 2000,
      scope: 'excluding figure/table legends and references',
      hard: true,
    });
    expect(brief.maxDisplayItems).toBe(4);
    // Editorial differs from SLEEP's own 1200-word limit.
    expect(articleType(sleepAdv, 'editorial').wordLimit?.max).toBe(1500);
  });

  it('figures section is genuinely empty (page fetched in full, states nothing) not a retrieval gap', () => {
    expect(sleepAdv.figures.palette.requirement).toBe('none-stated');
    expect(sleepAdv.figures.formats.vectorPreferred).toEqual([]);
  });
});

describe('jne facts from the IOP Publishing support pages', () => {
  const jne = profiles['jne'];

  it('citations: iopart-num numbered style, >10-author et al., appearance order', () => {
    // findings-2.json JNE.citations: iopart-num CTAN docs; "For more than
    // ten authors, the name of the first author should be given followed by
    // et al."
    expect(jne.citations.referenceList.sortOrder).toBe('appearance');
    expect(jne.citations.referenceList.authorTruncation).toEqual({
      etAlAllowed: true,
      truncateWhenMoreThan: 10,
      keepFirstN: 1,
    });
  });

  it('figures: 85/150 mm columns, 8-12 pt text, lowercase parenthesized panel labels, color discouraged as sole delimiter', () => {
    // findings-2.json JNE.figureRules.
    expect(jne.figures.widthPresetsMm.single).toBe(85);
    expect(jne.figures.widthPresetsMm.double).toBe(150);
    expect(jne.figures.minFontPt).toBe(8);
    expect(jne.figures.maxFontPt).toBe(12);
    expect(jne.figures.panelLabel).toEqual({ letterCase: 'lower', weight: null, wrapper: 'parens' });
    expect(jne.figures.palette.colorAsSoleDelimiter).toBe('discouraged');
  });

  it('manuscript: Paper 12000 words, structured 300-word abstract (Objective/Approach/Main results/Significance)', () => {
    // findings-2.json JNE.manuscriptLimits.
    const paper = articleType(jne, 'paper');
    expect(paper.wordLimit?.max).toBe(12000);
    expect(paper.abstractWordLimit).toBe(300);
    expect(jne.manuscript.availabilityStatements.data).toBe(true);
    expect(jne.manuscript.submissionFormat.lineNumbers).toBe(false);
  });
});

describe('jneurosci facts from the Society for Neuroscience information for authors', () => {
  const jneuro = profiles['jneurosci'];

  it('citations: author-year (parenthetical, NOT numbered), 6-author reference-list truncation', () => {
    // findings-2.json JNeurosci.citations: "actually uses an author-date
    // (parenthetical) citation system rather than a numbered format";
    // "List all authors unless there are more than six...list the first six".
    expect(jneuro.citations.mode).toBe('author-year');
    expect(jneuro.citations.referenceList.authorTruncation).toEqual({
      etAlAllowed: true,
      truncateWhenMoreThan: 6,
      keepFirstN: 6,
    });
  });

  it('manuscript: Research Article has no whole-document word cap — 650/1500-word Intro/Discussion budgets instead', () => {
    // findings-2.json JNeurosci.manuscriptLimits: "restricted to 650-word
    // introductions and 1,500-word discussions"; "no limit on the number of
    // figures, diagrams, or references".
    const ra = articleType(jneuro, 'research-article');
    expect(ra.wordLimit).toBeNull();
    expect(ra.maxReferences).toBeNull();
    expect(
      jneuro.manuscript.requiredSections.find((s) => s.id === 'introduction')?.label,
    ).toContain('650-word');
    const review = articleType(jneuro, 'review');
    expect(review.abstractWordLimit).toBe(250);
  });

  it('submissionFormat: double-spaced text including references', () => {
    expect(jneuro.manuscript.submissionFormat.doubleSpacing).toBe(true);
  });
});

describe('no profile is bundled for a journal the findings marked found:false', () => {
  it('every journal in author-guidelines-findings-2.json with found:false has no matching resources/profiles/*.json', () => {
    const findingsPath = join(here, '..', '..', '..', 'docs', 'design', 'author-guidelines-findings-2.json');
    const findings = JSON.parse(readFileSync(findingsPath, 'utf8')) as Array<{
      journals: Array<{ name: string; found: boolean }>;
    }>;
    const dropped = findings[0]?.journals.filter((j) => !j.found) ?? [];
    // This asserts the mechanism holds even though the current research pass
    // found guidelines for all nine requested journals (nothing was dropped
    // this round) — if a future pass records found:false, this test starts
    // enforcing it automatically.
    for (const journal of dropped) {
      const slug = journal.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      expect(
        (BUNDLED_PROFILE_IDS as readonly string[]).some((id) => id === slug),
      ).toBe(false);
    }
  });
});

describe('provenance annotations on the bundled profiles', () => {
  it('every bundled profile annotates all three sections', () => {
    for (const id of BUNDLED_PROFILE_IDS) {
      const p = profiles[id];
      for (const section of [p.citations, p.figures, p.manuscript]) {
        expect(section.provenance, `${id} section missing provenance`).toBeDefined();
        expect(section.provenance?.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("documented entries carry a source URL; inferred entries may carry null", () => {
    for (const id of JOURNAL_PROFILE_IDS) {
      const p = profiles[id];
      for (const section of [p.citations, p.figures, p.manuscript]) {
        for (const entry of section.provenance ?? []) {
          if (entry.basis === 'documented') {
            expect(entry.source, `${id}: "${entry.claim}"`).toMatch(/^https?:\/\//);
          }
        }
      }
    }
  });

  it('science records BOTH sides of the official column-width and line-weight conflicts', () => {
    const claims = (profiles['science'].figures.provenance ?? []).map((e) => e.claim);
    expect(claims.some((c) => c.startsWith('widthPresetsMm'))).toBe(true);
    expect(claims.some((c) => c.includes('conflicting official widths'))).toBe(true);
    expect(claims.some((c) => c.startsWith('lineWeightPt'))).toBe(true);
    expect(claims.some((c) => c.includes('conflicting official line-weight'))).toBe(true);
  });

  it('no bundled profile states a stage severity mapping', () => {
    for (const id of BUNDLED_PROFILE_IDS) {
      expect(profiles[id].manuscript.stageSeverity).toBeUndefined();
    }
  });
});

describe('loadProfile', () => {
  it('returns the parsed profile for valid input', () => {
    const parsed = loadProfile(readProfileJson('science'));
    expect(parsed.id).toBe('science');
  });

  it('throws a friendly error listing field paths for invalid input', () => {
    expect(() => loadProfile({})).toThrowError(/Invalid publisher profile:\n/);
    expect(() => loadProfile({})).toThrowError(/citations/);
  });

  it('names the offending profile when the document has an id', () => {
    const broken = JSON.parse(JSON.stringify(readProfileJson('science'))) as {
      id: string;
      citations: { mode: string };
    };
    broken.citations.mode = 'footnotes';
    expect(() => loadProfile(broken)).toThrowError(/Invalid publisher profile "science":/);
    expect(() => loadProfile(broken)).toThrowError(/citations\.mode/);
  });

  it('rejects non-object input', () => {
    expect(() => loadProfile('not a profile')).toThrowError(/Invalid publisher profile/);
    expect(() => loadProfile(null)).toThrowError(/Invalid publisher profile/);
  });
});

/**
 * The SUNA house style. Its job is the opposite of a journal profile's: it
 * must never invent a rule to enforce, and it must state its typography in
 * full, because that typography IS the feature ("SUNA style").
 */
describe('the SUNA house style', () => {
  const suna = profiles['suna'];

  /**
   * DocumentStyle became a partial DELTA over the always-on SUNA default
   * (export-style.ts's resolveDocumentStyle): the house style still states
   * its typography IN FULL — that completeness is what makes "SUNA style"
   * reproducible — while a journal profile may carry only the small
   * convention fields its guidelines actually state.
   */
  const TYPOGRAPHY_FIELDS = [
    'name',
    'page',
    'fonts',
    'sizesPt',
    'lineSpacing',
    'bodySpaceAfterPt',
    'referenceHangingMm',
    'figureWidthMm',
    'figureCaptionPosition',
    'tableCaptionPosition',
    'pageBreakAfterFrontMatter',
  ] as const;
  const CONVENTION_FIELDS = [
    'figureLabel',
    'figurePlacement',
    'tablePlacement',
    'referencesStartNewPage',
  ] as const;

  it('states every typography field in full', () => {
    expect(suna.documentStyle).toBeDefined();
    for (const field of TYPOGRAPHY_FIELDS) {
      expect(suna.documentStyle?.[field], `suna documentStyle.${field}`).toBeDefined();
    }
    // The nested groups are complete too — a partial house style would let
    // silent fallbacks hide behind the schema's optionality.
    expect(Object.keys(suna.documentStyle?.page ?? {}).sort()).toEqual(
      ['heightMm', 'marginMm', 'widthMm'].sort(),
    );
    expect(Object.keys(suna.documentStyle?.fonts ?? {}).sort()).toEqual(['body', 'mono'].sort());
    expect(Object.keys(suna.documentStyle?.sizesPt ?? {})).toHaveLength(10);
  });

  it('journal profiles carry at most convention deltas, never typography', () => {
    for (const id of JOURNAL_PROFILE_IDS) {
      const style = profiles[id].documentStyle;
      if (style === undefined) continue;
      for (const key of Object.keys(style)) {
        expect(
          (CONVENTION_FIELDS as readonly string[]).includes(key),
          `${id} documentStyle.${key} is typography — journals must not invent page setup (ADR-002)`,
        ).toBe(true);
      }
    }
  });

  it('sleep states exactly its guideline-documented conventions', () => {
    expect(profiles['sleep'].documentStyle).toEqual({
      figureLabel: 'Figure',
      figurePlacement: 'captions-list',
      tablePlacement: 'end',
      referencesStartNewPage: true,
    });
  });

  it("brain-stimulation states the 'Fig.' label its pages document; nobody else does", () => {
    // Elsevier's appendix-numbering format ("Table A.1; Fig. A.1, etc.") is
    // the guide's stated label form, generalized — see the profile's notes.
    expect(profiles['brain-stimulation'].documentStyle).toEqual({ figureLabel: 'Fig.' });
    for (const id of JOURNAL_PROFILE_IDS) {
      if (id === 'brain-stimulation') continue;
      expect(
        profiles[id].documentStyle?.figureLabel,
        `${id} must not state a figure label its guidelines never gave`,
      ).not.toBe('Fig.');
    }
  });

  it('reproduces docx-tools geometry: US Letter, 0.5 in margins, TNR 11 pt at 1.15', () => {
    const style = suna.documentStyle;
    // US Letter in mm, and 0.5 in = 12.7 mm on all four sides.
    expect(style?.page?.widthMm).toBeCloseTo(215.9, 1);
    expect(style?.page?.heightMm).toBeCloseTo(279.4, 1);
    expect(style?.page?.marginMm).toBeCloseTo(12.7, 1);
    expect(style?.fonts?.body).toBe('Times New Roman');
    expect(style?.sizesPt?.body).toBe(11);
    expect(style?.lineSpacing).toBeCloseTo(1.15, 2);
  });

  it('states every role size docx-tools sets, including the small author line', () => {
    const s = suna.documentStyle?.sizesPt;
    expect(s?.title).toBe(14);
    // 8 pt authors above 9 pt affiliations is docx-tools' own choice
    // (authors.py) and is deliberate here, not a transposition.
    expect(s?.author).toBe(8);
    expect(s?.affiliation).toBe(9);
    expect(s?.heading1).toBe(13);
    expect(s?.heading2).toBe(11);
    expect(s?.caption).toBe(10);
    expect(s?.reference).toBe(10);
    expect(s?.footer).toBe(9);
  });

  it('places captions the way docx-tools does: figures below, tables above', () => {
    expect(suna.documentStyle?.figureCaptionPosition).toBe('below');
    expect(suna.documentStyle?.tableCaptionPosition).toBe('above');
  });

  it('breaks to a new page after the front matter, and hangs references 0.5 in', () => {
    expect(suna.documentStyle?.pageBreakAfterFrontMatter).toBe(true);
    expect(suna.documentStyle?.referenceHangingMm).toBeCloseTo(12.7, 1);
  });

  it('defaults figures to docx-tools 5 in width', () => {
    expect(suna.documentStyle?.figureWidthMm).toBeCloseTo(127, 0);
  });

  it('enforces NOTHING: no word limits, no required availability statements', () => {
    for (const type of suna.manuscript.articleTypes) {
      expect(type.wordLimit, `${type.id} must not impose a word limit`).toBeNull();
      expect(type.abstractWordLimit).toBeNull();
      expect(type.maxReferences).toBeNull();
      expect(type.maxDisplayItems).toBeNull();
    }
    expect(suna.manuscript.availabilityStatements.data).toBeNull();
    expect(suna.manuscript.availabilityStatements.code).toBeNull();
    expect(suna.manuscript.runningHeadLimitChars).toBeNull();
  });

  it('states its own submission conventions: single-spaced, unnumbered lines, page numbers on', () => {
    // Unlike a journal profile, the house style is ALLOWED to have an
    // opinion — these are our conventions, not a transcription of anyone's
    // guidelines. They seed the export checkboxes; the user can still
    // override any of them for a given export.
    expect(suna.manuscript.submissionFormat.doubleSpacing).toBe(false);
    expect(suna.manuscript.submissionFormat.lineNumbers).toBe(false);
    expect(suna.manuscript.submissionFormat.pageNumbers).toBe(true);
  });

  it('exchanges exactly the three formats SUNA exports', () => {
    expect(suna.manuscript.submissionFormat.acceptedFileTypes).toEqual(['docx', 'pdf', 'html']);
  });

  it('offers the three documents we actually write', () => {
    expect(suna.manuscript.articleTypes.map((t) => t.id)).toEqual([
      'draft',
      'letter',
      'internal-report',
    ]);
    expect(suna.manuscript.articleTypes.map((t) => t.name)).toEqual([
      'Draft manuscript',
      'Letter',
      'Internal report',
    ]);
  });

  it('requires no section at all — a draft may be half-written', () => {
    expect(suna.manuscript.requiredSections).toEqual([]);
  });

  it('asks for 600 dpi rasters, above every journal floor', () => {
    // Figures are authored as vector SVG here, so a raster is only ever a
    // rendering of something sharper; 600 dpi is our own bar, not a
    // journal's 300 dpi minimum for supplied artwork.
    // Hoisted so the comparison below is on a `number`: minDpi is nullable on
    // the type (a journal may not state one), and the assertion above pins
    // ours to 600 rather than narrowing it.
    const houseMinDpi = suna.figures.formats.minDpi;
    expect(houseMinDpi).toBe(600);
    for (const id of JOURNAL_PROFILE_IDS) {
      expect(
        (houseMinDpi ?? 0) >= (profiles[id].figures.formats.minDpi ?? 0),
        `the house style must not ask for less than ${id}`,
      ).toBe(true);
    }
  });

  it('is declared as ours, not sourced from anybody', () => {
    // Every provenance entry on a house-style block is 'inferred' or points
    // at our own repo — never at a publisher page. This is the assertion
    // that keeps someone from quietly turning SUNA style into a journal.
    for (const block of [suna.citations, suna.figures, suna.manuscript]) {
      for (const entry of block.provenance ?? []) {
        // A null source cites nothing, which is exactly what this wants.
        expect(
          (entry.source ?? '').startsWith('http'),
          `house-style provenance cites ${entry.source}`,
        ).toBe(false);
      }
    }
    expect(suna.notes?.[0]).toMatch(/OUR OWN invented house style/);
  });

  it('cites author-year, matching docx-tools APA default', () => {
    expect(suna.citations.mode).toBe('author-year');
    expect(suna.citations.referenceList.sortOrder).toBe('alphabetical');
  });

  it('claims no journal as its source', () => {
    expect(suna.citations.sources).toEqual([]);
    expect(suna.figures.sources).toEqual([]);
    expect(suna.manuscript.sources).toEqual([]);
    expect(suna.journalName).toBe('SUNA style');
  });
});
