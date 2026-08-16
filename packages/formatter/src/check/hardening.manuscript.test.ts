/**
 * Adversarial hardening tests for the manuscript checker: markdown-syntax
 * word-counting attacks, the RNAAS "including references" scope against the
 * real bundled apj-aas profile, and the scope-exclusion fix exercised against
 * the real nature-astronomy profile ("... excluding abstract, Methods,
 * references and figure captions").
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
    const profile = realProfile('apj-aas');
    // RNAAS hard limit 1500 incl. references+captions. Countable tokens in
    // the markdown preamble: Results, We, find, $\chi^2, 1.2$, [@smith2020].
    // = 6 (the '#' and '=' tokens are pure punctuation), so 883 filler words
    // make 889; with abstract 100 + captions 10 and zero references the note
    // stays under the limit.
    const markdown = `# Results\n\nWe find $\\chi^2 = 1.2$ [@smith2020].\n\n${words(883)}`;
    expect(countWords(markdown)).toBe(889);
    const input = makeInput({
      sectionTexts: { 'manuscript.md': markdown },
      referenceCount: 0,
    });
    expect(byId(checkManuscript(input, profile, 'rnaas'), 'ms.word-limit')).toEqual([]);
  });
});

describe('hardening — RNAAS scope pulls references into the total (real apj-aas.json)', () => {
  const profile = realProfile('apj-aas');

  it('the bundled profile states the inclusive scope verbatim', () => {
    const rnaas = profile.manuscript.articleTypes.find((t) => t.id === 'rnaas');
    expect(rnaas?.wordLimit?.scope).toBe('total, including references and captions');
    expect(rnaas?.wordLimit?.hard).toBe(true);
  });

  it('40 references push a 1010-word note over 1500; zero references stay under', () => {
    // 1010 counted + 40 * 15 = 1610 > 1500.
    const over = byId(checkManuscript(makeInput(), profile, 'rnaas'), 'ms.word-limit');
    expect(over).toHaveLength(1);
    expect(over[0]?.severity).toBe('error');
    expect(over[0]?.message).toContain(`~${1010 + 40 * WORDS_PER_REFERENCE_ESTIMATE}`);
    expect(over[0]?.message).toContain('estimated');

    const under = byId(
      checkManuscript(makeInput({ referenceCount: 0 }), profile, 'rnaas'),
      'ms.word-limit',
    );
    expect(under).toEqual([]);
  });
});

describe('hardening — scope exclusions (real nature-astronomy.json)', () => {
  const profile = realProfile('nature-astronomy');

  it('does not count the abstract when the scope excludes it', () => {
    // Article: 3000-word limit, scope "... excluding abstract, Methods,
    // references and figure captions". 2950 section words + 200-word
    // abstract must NOT warn (3150 would, if the abstract were counted).
    const input = makeInput({
      sectionTexts: { 'manuscript.md': words(2950) },
      referenceCount: 0,
    });
    input.manuscript.abstract.content = words(200);
    expect(byId(checkManuscript(input, profile, 'article'), 'ms.word-limit')).toEqual([]);
  });

  it('still warns when the in-scope text alone exceeds the limit', () => {
    const input = makeInput({
      sectionTexts: { 'manuscript.md': words(3050) },
      referenceCount: 0,
    });
    input.manuscript.abstract.content = words(200);
    const wl = byId(checkManuscript(input, profile, 'article'), 'ms.word-limit');
    expect(wl).toHaveLength(1);
    expect(wl[0]?.severity).toBe('warning'); // soft limit
    expect(wl[0]?.message).toContain('3050');
  });

  it('"excluding ... references and figure captions" adds neither references nor captions', () => {
    // 2990 section words; 40 references (600 estimated words) and 10 caption
    // words would overflow if wrongly included.
    const input = makeInput({
      sectionTexts: { 'manuscript.md': words(2990) },
      referenceCount: 40,
    });
    input.manuscript.abstract.content = words(200);
    expect(byId(checkManuscript(input, profile, 'article'), 'ms.word-limit')).toEqual([]);
  });

  it('stageSeverity (real profile): Article word limit warns at initial submission, errors once accepted', () => {
    // "Your initial submission does not need to be specially formatted"
    // (initial-formatting page) — encoded as stageSeverity
    // {initial-submission: warning, accepted: error}.
    const input = makeInput({
      sectionTexts: { 'manuscript.md': words(3050) },
      referenceCount: 0,
    });
    input.manuscript.abstract.content = words(200);

    const initial = byId(checkManuscript(input, profile, 'article'), 'ms.word-limit');
    expect(initial).toHaveLength(1);
    expect(initial[0]?.severity).toBe('warning');

    const accepted = byId(checkManuscript(input, profile, 'article', 'accepted'), 'ms.word-limit');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.severity).toBe('error'); // upgraded past the soft limit's intrinsic warning
  });

  it('a "not including references" scope does not add reference words', () => {
    const p = realProfile('apj-aas');
    const rnaas = p.manuscript.articleTypes.find((t) => t.id === 'rnaas');
    if (rnaas === undefined || rnaas.wordLimit === null) throw new Error('profile changed');
    rnaas.wordLimit = { max: 1015, scope: 'total, not including references', hard: true };
    // 1010 counted words (abstract 100 + sections 900 + captions 0: scope
    // does not mention captions) <= 1015 only if references stay out.
    expect(byId(checkManuscript(makeInput(), p, 'rnaas'), 'ms.word-limit')).toEqual([]);
  });
});
