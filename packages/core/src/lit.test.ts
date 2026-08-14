import { describe, expect, it } from 'vitest';
import {
  LIT_PROVIDER_IDS,
  LIT_PROVIDER_META,
  LitProviderIdSchema,
  LitResultSchema,
  LitSearchResponseSchema,
  type LitResult,
} from './lit';

const crossrefHit: LitResult = {
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
};

describe('LitProviderIdSchema', () => {
  it('accepts exactly the four probed providers', () => {
    expect([...LIT_PROVIDER_IDS]).toEqual(['crossref', 'openalex', 'ads', 'arxiv']);
    for (const id of LIT_PROVIDER_IDS) {
      expect(LitProviderIdSchema.parse(id)).toBe(id);
    }
    expect(LitProviderIdSchema.safeParse('semanticscholar').success).toBe(false);
  });

  it('marks ADS as the only provider that cannot be called without a key', () => {
    const keyless = LIT_PROVIDER_IDS.filter((id) => LIT_PROVIDER_META[id].keyless);
    expect([...keyless]).toEqual(['crossref', 'openalex', 'arxiv']);
    expect(LIT_PROVIDER_META.ads.keyless).toBe(false);
  });
});

describe('LitResultSchema', () => {
  it('parses a fully populated result', () => {
    expect(LitResultSchema.parse(crossrefHit)).toEqual(crossrefHit);
  });

  it('accepts null for every unknown field', () => {
    const sparse: LitResult = {
      source: 'arxiv',
      id: 'arXiv:2401.00001',
      doi: null,
      title: 'A best-effort preprint',
      authors: [],
      year: null,
      venue: null,
      citedByCount: null,
      openAccessUrl: null,
      abstract: null,
    };
    expect(LitResultSchema.parse(sparse)).toEqual(sparse);
  });

  it('rejects an empty title, a missing id, and a fractional year', () => {
    expect(LitResultSchema.safeParse({ ...crossrefHit, title: '' }).success).toBe(false);
    expect(LitResultSchema.safeParse({ ...crossrefHit, id: '' }).success).toBe(false);
    expect(LitResultSchema.safeParse({ ...crossrefHit, year: 1972.5 }).success).toBe(false);
  });

  it('rejects an undefined field where null is the contract', () => {
    const { doi: _doi, ...withoutDoi } = crossrefHit;
    expect(LitResultSchema.safeParse(withoutDoi).success).toBe(false);
  });
});

describe('LitSearchResponseSchema', () => {
  it('carries an honest error next to an empty result list', () => {
    const res = LitSearchResponseSchema.parse({
      results: [],
      error: 'OpenAlex is rate-limited or out of budget (HTTP 429).',
    });
    expect(res.results).toEqual([]);
    expect(res.error).toContain('429');
  });

  it('requires the error field to be present (null when fine)', () => {
    expect(LitSearchResponseSchema.safeParse({ results: [crossrefHit] }).success).toBe(false);
    expect(
      LitSearchResponseSchema.parse({ results: [crossrefHit], error: null }).error,
    ).toBeNull();
  });
});
