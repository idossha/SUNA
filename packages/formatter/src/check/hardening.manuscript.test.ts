/**
 * Adversarial hardening tests for the manuscript checker: markdown-syntax
 * word-counting attacks, the PNAS "includes ... references" scope against the
 * real bundled pnas profile, and the scope-exclusion fix exercised against
 * the real brain-stimulation profile ("body text only — excludes abstract,
 * references and title page").
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PublisherProfile } from '@suna/core';
import { loadProfile } from '../profiles';
import {
  checkManuscript,
  countWords,
  WORDS_PER_REFERENCE_ESTIMATE,
  type ManuscriptCheckInput,
} from './manuscript';
import type { Diagnostic } from './types';
import { makeManuscript, makeSectionTexts, words } from './testkit';

const here: string = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const profilesDir = join(here, '..', '..', '..', '..', 'resources', 'profiles');

function realProfile(id: string): PublisherProfile {
  return loadProfile(JSON.parse(readFileSync(join(profilesDir, `${id}.json`), 'utf8')));
}

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

describe('hardening — word counting is not fooled by markdown syntax', () => {
  it('counts a pandoc citation [@key] as exactly one word', () => {
    expect(countWords('We measured the flux [@smith2020] carefully')).toBe(6);
    expect(countWords('[@smith2020]')).toBe(1);
  });

  it('counts inline math $...$ as words, not zero', () => {
    // Tokens: "The", "energy", "$E", "=", "mc^2$", "grows" — "=" is pure
    // punctuation and does not count; both math tokens contain letters/digits.
    expect(countWords('The energy $E = mc^2$ grows')).toBe(5);
    expect(countWords('$\\alpha_1$')).toBe(1);
  });

  it('counts heading text but not the # markers', () => {
    expect(countWords('# Introduction')).toBe(1);
    expect(countWords('## A Deeper Section\n\nBody text here.')).toBe(6);
  });

  it('ignores pure-punctuation tokens (rules, emphasis markers, bullets)', () => {
    expect(countWords('--- *** > - | :')).toBe(0);
    expect(countWords('**bold** _em_ `code`')).toBe(3);
  });

  it('markdown-heavy section text feeds the total honestly', () => {
    const profile = realProfile('pnas');
    // Research Report: 4000 words, scope includes references. Countable
    // tokens in the markdown preamble: Results, We, find, $\chi^2, 1.2$,
    // [@smith2020] = 6 (the '#' and '=' tokens are pure punctuation), so 883
    // filler words make 889; with abstract 100 and zero references the report
    // stays well under the limit.
    const markdown = `# Results\n\nWe find $\\chi^2 = 1.2$ [@smith2020].\n\n${words(883)}`;
    expect(countWords(markdown)).toBe(889);
    const input = makeInput({
      sectionTexts: { 'manuscript.md': markdown },
      referenceCount: 0,
    });
    expect(byId(checkManuscript(input, profile, 'research-report'), 'ms.word-limit')).toEqual([]);
  });
});

describe('hardening — an inclusive scope pulls references into the total (real pnas.json)', () => {
  const profile = realProfile('pnas');

  it('the bundled profile states the inclusive scope verbatim', () => {
    const report = profile.manuscript.articleTypes.find((t) => t.id === 'research-report');
    expect(report?.wordLimit?.scope).toContain('references');
    expect(report?.wordLimit?.max).toBe(4000);
    // A page budget, not a hard cap — over it warns rather than errors.
    expect(report?.wordLimit?.hard).toBe(false);
  });

  it('40 references push a 3450-word report over 4000; zero references stay under', () => {
    // abstract 100 + 3450 counted + 40 * 15 = 4150 > 4000.
    const input = makeInput({ sectionTexts: { 'manuscript.md': words(3450) } });
    const over = byId(checkManuscript(input, profile, 'research-report'), 'ms.word-limit');
    expect(over).toHaveLength(1);
    expect(over[0]?.severity).toBe('warning');
    expect(over[0]?.message).toContain(`~${100 + 3450 + 40 * WORDS_PER_REFERENCE_ESTIMATE}`);
    expect(over[0]?.message).toContain('estimated');

    const under = byId(
      checkManuscript(
        makeInput({ sectionTexts: { 'manuscript.md': words(3450) }, referenceCount: 0 }),
        profile,
        'research-report',
      ),
      'ms.word-limit',
    );
    expect(under).toEqual([]);
  });
});

describe('hardening — scope exclusions (real brain-stimulation.json)', () => {
  const profile = realProfile('brain-stimulation');

  it('does not count the abstract when the scope excludes it', () => {
    // Original research: 4000-word limit, scope "body text only — excludes
    // abstract, references and title page". 3950 section words + a 200-word
    // abstract must NOT warn (4150 would, if the abstract were counted).
    const input = makeInput({
      sectionTexts: { 'manuscript.md': words(3950) },
      referenceCount: 0,
    });
    input.manuscript.abstract.content = words(200);
    expect(byId(checkManuscript(input, profile, 'original-research'), 'ms.word-limit')).toEqual([]);
  });

  it('still warns when the in-scope text alone exceeds the limit', () => {
    const input = makeInput({
      sectionTexts: { 'manuscript.md': words(4050) },
      referenceCount: 0,
    });
    input.manuscript.abstract.content = words(200);
    const wl = byId(checkManuscript(input, profile, 'original-research'), 'ms.word-limit');
    expect(wl).toHaveLength(1);
    expect(wl[0]?.severity).toBe('warning'); // soft limit
    expect(wl[0]?.message).toContain('4050');
  });

  it('"excludes ... references" adds no reference words', () => {
    // 3990 section words; 40 references (600 estimated words) would overflow
    // if wrongly included.
    const input = makeInput({
      sectionTexts: { 'manuscript.md': words(3990) },
      referenceCount: 40,
    });
    input.manuscript.abstract.content = words(200);
    expect(byId(checkManuscript(input, profile, 'original-research'), 'ms.word-limit')).toEqual([]);
  });

  it('a "not including references" scope does not add reference words', () => {
    const p = realProfile('pnas');
    const report = p.manuscript.articleTypes.find((t) => t.id === 'research-report');
    if (report === undefined || report.wordLimit === null) throw new Error('profile changed');
    report.wordLimit = { max: 1015, scope: 'total, not including references', hard: true };
    // 1000 counted words (abstract 100 + sections 900 + captions 0: scope
    // does not mention captions) <= 1015 only if references stay out.
    expect(byId(checkManuscript(makeInput(), p, 'research-report'), 'ms.word-limit')).toEqual([]);
  });
});
