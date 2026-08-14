import { describe, expect, it } from 'vitest';
import type { LitResult } from '@suna/core';
import { generateCiteKey, litResultToBibEntry } from './lit-entry.js';
import { parseBibtex } from './parse.js';
import { serializeEntry } from './serialize.js';

function result(overrides: Partial<LitResult> = {}): LitResult {
  return {
    source: 'crossref',
    id: '10.1086/151605',
    doi: '10.1086/151605',
    title: 'On the infall of matter into clusters of galaxies',
    authors: ['James E. Gunn', 'J. Richard Gott'],
    year: 1972,
    venue: 'The Astrophysical Journal',
    citedByCount: 3021,
    openAccessUrl: null,
    abstract: null,
    ...overrides,
  };
}

describe('generateCiteKey', () => {
  it('builds firstauthorYEARfirstsignificantword, skipping stopwords', () => {
    expect(generateCiteKey(result(), [])).toBe('gunn1972infall');
  });

  it('dedupes against existing keys with a/b/c suffixes', () => {
    const existing = ['gunn1972infall', 'gunn1972infalla', 'gunn1972infallb'];
    expect(generateCiteKey(result(), existing)).toBe('gunn1972infallc');
  });

  it('does not touch keys that do not collide', () => {
    expect(generateCiteKey(result(), ['someoneelse1999other'])).toBe('gunn1972infall');
  });

  it('falls back to "anon" for a missing author and "nd" for a missing year', () => {
    expect(generateCiteKey(result({ authors: [], year: null }), [])).toBe('anonndinfall');
  });

  it('falls back to "untitled" when every title word is a stopword', () => {
    expect(generateCiteKey(result({ title: 'The Of A' }), [])).toBe('gunn1972untitled');
  });

  it('folds non-ASCII author names to plain ASCII', () => {
    expect(
      generateCiteKey(result({ authors: ['Inés Fernández'], title: 'Sérsic profiles' }), []),
    ).toBe('fernandez1972sersic');
  });

  it('produces the same base for a single-name author (no given name)', () => {
    expect(generateCiteKey(result({ authors: ['Prospero'] }), [])).toBe('prospero1972infall');
  });
});

describe('litResultToBibEntry', () => {
  it('converts a Crossref article result to a citable @article entry', () => {
    const entry = litResultToBibEntry(result());
    expect(entry.entryType).toBe('article');
    expect(entry.title).toBe('On the infall of matter into clusters of galaxies');
    expect(entry.authors).toEqual([
      { kind: 'person', family: 'Gunn', given: 'James E.' },
      { kind: 'person', family: 'Gott', given: 'J. Richard' },
    ]);
    expect(entry.year).toBe('1972');
    expect(entry.journal).toBe('The Astrophysical Journal');
    expect(entry.doi).toBe('10.1086/151605');
    expect(entry.key).toBe('gunn1972infall');
  });

  it('marks an arXiv-only result as a preprint (@misc + arxivId, no journal)', () => {
    const entry = litResultToBibEntry(
      result({
        source: 'arxiv',
        id: 'arXiv:2401.00001',
        doi: null,
        venue: 'arXiv',
        openAccessUrl: 'https://arxiv.org/abs/2401.00001',
      }),
    );
    expect(entry.entryType).toBe('misc');
    expect(entry.arxivId).toBe('2401.00001');
    expect(entry.journal).toBeUndefined();
    expect(entry.raw['archiveprefix']).toBe('arXiv');
  });

  it('leaves year/journal/doi/url unset when the source has none', () => {
    const entry = litResultToBibEntry(
      result({ year: null, venue: null, doi: null, openAccessUrl: null }),
    );
    expect(entry.year).toBeUndefined();
    expect(entry.journal).toBeUndefined();
    expect(entry.doi).toBeUndefined();
    expect(entry.url).toBeUndefined();
  });

  it('splits a single-token author name into a bare family with no given name', () => {
    const entry = litResultToBibEntry(result({ authors: ['Prospero'] }));
    expect(entry.authors).toEqual([{ kind: 'person', family: 'Prospero' }]);
  });

  it('carries the abstract through raw so it survives serialization losslessly', () => {
    const entry = litResultToBibEntry(result({ abstract: 'A study of infall.' }));
    expect(entry.raw['abstract']).toBe('A study of infall.');
  });

  it('preserves non-ASCII author names untransliterated in the entry itself', () => {
    const entry = litResultToBibEntry(result({ authors: ['Inés Fernández'] }));
    expect(entry.authors).toEqual([{ kind: 'person', family: 'Fernández', given: 'Inés' }]);
  });

  it('round-trips through serializeEntry + parseBibtex back to an equivalent entry', () => {
    const entry = litResultToBibEntry(result());
    const bibtex = serializeEntry(entry);
    const parsed = parseBibtex(bibtex);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.key).toBe(entry.key);
    expect(parsed.entries[0]?.title).toBe(entry.title);
    expect(parsed.entries[0]?.doi).toBe(entry.doi);
  });
});
