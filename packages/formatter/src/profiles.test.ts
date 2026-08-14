import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PublisherProfileSchema, type PublisherProfile, type ArticleTypeRules } from '@suna/core';
import { BUNDLED_PROFILE_IDS, loadProfile, type BundledProfileId } from './profiles';

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

describe('bundled publisher profiles', () => {
  it('lists exactly the four bundled ids', () => {
    expect([...BUNDLED_PROFILE_IDS].sort()).toEqual(
      ['apj-aas', 'mnras', 'nature-astronomy', 'science'].sort(),
    );
  });

  for (const id of BUNDLED_PROFILE_IDS) {
    describe(id, () => {
      const profile = profiles[id];

      it('validates against PublisherProfileSchema', () => {
        const parsed = PublisherProfileSchema.parse(readProfileJson(id));
        expect(parsed.schemaVersion).toBe(3);
      });

      it('id matches its filename and lastVerified is the extraction date', () => {
        expect(profile.id).toBe(id);
        expect(profile.lastVerified).toBe('2026-08-13');
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

describe('apj-aas facts from the AAS author guidelines', () => {
  const apj = profiles['apj-aas'];

  it('figures: 6 pt minimum font, 0.5 pt minimum line weight, 300 dpi raster floor', () => {
    expect(apj.figures.minFontPt).toBe(6);
    expect(apj.figures.lineWeightPt.min).toBe(0.5);
    expect(apj.figures.formats.minDpi).toBe(300);
  });

  it('citations: author-year with initials, ampersand joiner, et al. from 3 authors, ADS abbreviations', () => {
    expect(apj.citations.mode).toBe('author-year');
    expect(apj.citations.authorYear?.includeInitials).toBe(true);
    expect(apj.citations.authorYear?.twoAuthorJoiner).toBe('&');
    expect(apj.citations.authorYear?.etAlFromNAuthors).toBe(3);
    expect(apj.citations.referenceList.journalAbbreviation).toBe('ads');
    expect(apj.citations.referenceList.sortOrder).toBe('alphabetical');
    expect(apj.citations.referenceList.authorTruncation).toEqual({
      etAlAllowed: true,
      truncateWhenMoreThan: 5,
      keepFirstN: 3,
    });
  });

  it('RNAAS: hard 1500-word total limit including references and captions, 150-word abstract', () => {
    const rnaas = articleType(apj, 'rnaas');
    expect(rnaas.wordLimit).toEqual({
      max: 1500,
      scope: 'total, including references and captions',
      hard: true,
    });
    expect(rnaas.abstractWordLimit).toBe(150);
    expect(rnaas.maxDisplayItems).toBe(1);
  });

  it('manuscript: 250-word abstract, 44-char running head, soft 3500-word ApJL limit, line numbers required', () => {
    expect(articleType(apj, 'apj-article').abstractWordLimit).toBe(250);
    expect(apj.manuscript.runningHeadLimitChars).toBe(44);
    const letter = articleType(apj, 'apj-letter');
    expect(letter.wordLimit?.max).toBe(3500);
    expect(letter.wordLimit?.hard).toBe(false);
    expect(apj.manuscript.submissionFormat.lineNumbers).toBe(true);
  });
});

describe('nature-astronomy facts from Nature Portfolio guidelines', () => {
  const nat = profiles['nature-astronomy'];

  it('citations: numeric superscript with collapsed ranges, cited in order of appearance', () => {
    expect(nat.citations.mode).toBe('numeric-superscript');
    expect(nat.citations.collapseRanges).toBe(true);
    expect(nat.citations.authorYear).toBeNull();
    expect(nat.citations.referenceList.sortOrder).toBe('appearance');
    expect(nat.citations.referenceList.authorTruncation.truncateWhenMoreThan).toBe(5);
    expect(nat.citations.referenceList.authorTruncation.keepFirstN).toBe(1);
  });

  it('figures: 88/180 mm columns, 5-7 pt text, 0.25-1 pt lines, required Wong colorblind-safe palette', () => {
    expect(nat.figures.widthPresetsMm.single).toBe(88);
    expect(nat.figures.widthPresetsMm.double).toBe(180);
    expect(nat.figures.minFontPt).toBe(5);
    expect(nat.figures.maxFontPt).toBe(7);
    expect(nat.figures.lineWeightPt).toEqual({ min: 0.25, max: 1 });
    expect(nat.figures.palette.requirement).toBe('colorblind-safe-required');
    expect(nat.figures.palette.suggestedHex).toHaveLength(8);
    expect(nat.figures.palette.suggestedHex).toContain('#e69f00');
    expect(nat.figures.panelLabel).toEqual({ letterCase: 'lower', weight: 'bold', wrapper: 'none' });
  });

  it('manuscript: Article 3000 words / 200-word abstract / 6 display items / 50 refs, data availability mandatory', () => {
    const article = articleType(nat, 'article');
    expect(article.wordLimit?.max).toBe(3000);
    expect(article.abstractWordLimit).toBe(200);
    expect(article.maxDisplayItems).toBe(6);
    expect(article.maxReferences).toBe(50);
    expect(nat.manuscript.availabilityStatements.data).toBe(true);
  });
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

describe('mnras facts from the OUP instructions to authors', () => {
  const mnras = profiles['mnras'];

  it('citations: author-year; current official page examples include first initials', () => {
    expect(mnras.citations.mode).toBe('author-year');
    // The official page's own examples — '(J. Brown 1999)', 'J. Brown & P. Jones (1991)' —
    // include initials (unlike traditional mnras.bst output; see profile notes).
    expect(mnras.citations.authorYear?.includeInitials).toBe(true);
    expect(mnras.citations.authorYear?.twoAuthorJoiner).toBe('&');
    expect(mnras.citations.authorYear?.etAlFromNAuthors).toBe(4);
    expect(mnras.citations.referenceList.sortOrder).toBe('alphabetical');
    expect(mnras.citations.referenceList.authorTruncation).toEqual({
      etAlAllowed: true,
      truncateWhenMoreThan: 8,
      keepFirstN: 1,
    });
  });

  it('figures: 80 mm single column, 0.3 pt minimum line weight, red/green discouraged, lowercase (a) labels', () => {
    expect(mnras.figures.widthPresetsMm.single).toBe(80);
    expect(mnras.figures.lineWeightPt.min).toBe(0.3);
    expect(mnras.figures.palette.redGreenDiscouraged).toBe(true);
    expect(mnras.figures.panelLabel.letterCase).toBe('lower');
    expect(mnras.figures.panelLabel.wrapper).toBe('parens');
  });

  it('manuscript: 250/200-word abstracts, mandatory Data Availability, single spacing', () => {
    expect(articleType(mnras, 'mnras-paper').abstractWordLimit).toBe(250);
    expect(articleType(mnras, 'mnras-letter').abstractWordLimit).toBe(200);
    expect(mnras.manuscript.availabilityStatements.data).toBe(true);
    expect(
      mnras.manuscript.requiredSections.some((s) => s.id === 'data-availability' && s.required),
    ).toBe(true);
    expect(mnras.manuscript.submissionFormat.doubleSpacing).toBe(false);
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
    for (const id of BUNDLED_PROFILE_IDS) {
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

  it('nature-astronomy marks collapseRanges as inferred (not stated on official pages)', () => {
    const entry = profiles['nature-astronomy'].citations.provenance?.find((e) =>
      e.claim.startsWith('collapseRanges'),
    );
    expect(entry?.basis).toBe('inferred');
    expect(entry?.source).toBeNull();
  });

  it('science records BOTH sides of the official column-width and line-weight conflicts', () => {
    const claims = (profiles['science'].figures.provenance ?? []).map((e) => e.claim);
    expect(claims.some((c) => c.startsWith('widthPresetsMm'))).toBe(true);
    expect(claims.some((c) => c.includes('conflicting official widths'))).toBe(true);
    expect(claims.some((c) => c.startsWith('lineWeightPt'))).toBe(true);
    expect(claims.some((c) => c.includes('conflicting official line-weight'))).toBe(true);
  });

  it('apj-aas documents its stated figure minima from the graphics guide', () => {
    const figures = profiles['apj-aas'].figures.provenance ?? [];
    const minFont = figures.find((e) => e.claim.startsWith('minFontPt'));
    expect(minFont?.basis).toBe('documented');
    expect(minFont?.source).toBe('https://journals.aas.org/graphics-guide/');
  });

  it('nature-astronomy states the initial-submission stage severity downgrade', () => {
    const nat = profiles['nature-astronomy'];
    expect(nat.manuscript.stageSeverity).toEqual({
      'initial-submission': 'warning',
      accepted: 'error',
    });
    const entry = nat.manuscript.provenance?.find((e) => e.claim.startsWith('stageSeverity'));
    expect(entry?.basis).toBe('inferred');
  });

  it('the other bundled profiles state no stage severity mapping', () => {
    for (const id of ['apj-aas', 'mnras', 'science'] as const) {
      expect(profiles[id].manuscript.stageSeverity).toBeUndefined();
    }
  });
});

describe('loadProfile', () => {
  it('returns the parsed profile for valid input', () => {
    const parsed = loadProfile(readProfileJson('apj-aas'));
    expect(parsed.id).toBe('apj-aas');
  });

  it('throws a friendly error listing field paths for invalid input', () => {
    expect(() => loadProfile({})).toThrowError(/Invalid publisher profile:\n/);
    expect(() => loadProfile({})).toThrowError(/citations/);
  });

  it('names the offending profile when the document has an id', () => {
    const broken = JSON.parse(JSON.stringify(readProfileJson('mnras'))) as {
      id: string;
      citations: { mode: string };
    };
    broken.citations.mode = 'footnotes';
    expect(() => loadProfile(broken)).toThrowError(/Invalid publisher profile "mnras":/);
    expect(() => loadProfile(broken)).toThrowError(/citations\.mode/);
  });

  it('rejects non-object input', () => {
    expect(() => loadProfile('not a profile')).toThrowError(/Invalid publisher profile/);
    expect(() => loadProfile(null)).toThrowError(/Invalid publisher profile/);
  });
});
