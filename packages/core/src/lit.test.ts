import { describe, expect, it } from 'vitest';
import {
  LIT_CLI_IDS,
  LIT_CLI_PREFERENCE_IDS,
  LIT_PROVIDER_IDS,
  LIT_PROVIDER_META,
  LIT_RESULT_SOURCE_IDS,
  LitCliIdSchema,
  LitCliPreferenceSchema,
  LitProviderIdSchema,
  LitResultSchema,
  LitResultSourceSchema,
  LitSearchResponseSchema,
  UI_LIT_PROVIDER_IDS,
  UiLitProviderIdSchema,
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
    expect([...LIT_PROVIDER_IDS]).toEqual(['crossref', 'openalex', 'biorxiv', 'arxiv']);
    for (const id of LIT_PROVIDER_IDS) {
      expect(LitProviderIdSchema.parse(id)).toBe(id);
    }
    expect(LitProviderIdSchema.safeParse('semanticscholar').success).toBe(false);
    expect(LitProviderIdSchema.safeParse('ads').success).toBe(false);
  });

  it('marks every provider keyless (OpenAlex takes an optional key for budget)', () => {
    const keyless = LIT_PROVIDER_IDS.filter((id) => LIT_PROVIDER_META[id].keyless);
    expect([...keyless]).toEqual([...LIT_PROVIDER_IDS]);
    expect(LIT_PROVIDER_META.biorxiv.label).toBe('bioRxiv / medRxiv');
  });
});

describe('LitCliIdSchema / LitCliPreferenceSchema', () => {
  it('accepts exactly claude and codex', () => {
    expect([...LIT_CLI_IDS]).toEqual(['claude', 'codex']);
    for (const id of LIT_CLI_IDS) expect(LitCliIdSchema.parse(id)).toBe(id);
    expect(LitCliIdSchema.safeParse('gemini').success).toBe(false);
  });

  it('lit.cli preference is auto or a specific CLI', () => {
    expect([...LIT_CLI_PREFERENCE_IDS]).toEqual(['auto', 'claude', 'codex']);
    for (const id of LIT_CLI_PREFERENCE_IDS) expect(LitCliPreferenceSchema.parse(id)).toBe(id);
    expect(LitCliPreferenceSchema.safeParse('claude-code').success).toBe(false);
  });
});

describe('LitResultSourceSchema / UiLitProviderIdSchema', () => {
  it('LitResult.source widens LitProviderId with ai-cli, without widening LitProviderId itself', () => {
    expect([...LIT_RESULT_SOURCE_IDS]).toEqual(['crossref', 'openalex', 'biorxiv', 'arxiv', 'ai-cli']);
    for (const id of LIT_RESULT_SOURCE_IDS) expect(LitResultSourceSchema.parse(id)).toBe(id);
    expect(LitResultSourceSchema.safeParse('scholar').success).toBe(false);
    // the four dispatchable HTTP providers are unchanged — MCP/searchLiterature
    // still switch exhaustively over exactly these, never 'ai-cli'.
    expect([...LIT_PROVIDER_IDS]).toEqual(['crossref', 'openalex', 'biorxiv', 'arxiv']);
    expect(LitProviderIdSchema.safeParse('ai-cli').success).toBe(false);
  });

  it('the UI provider picker lists ai-cli first, then the four HTTP providers', () => {
    expect([...UI_LIT_PROVIDER_IDS]).toEqual(['ai-cli', 'crossref', 'openalex', 'biorxiv', 'arxiv']);
    for (const id of UI_LIT_PROVIDER_IDS) expect(UiLitProviderIdSchema.parse(id)).toBe(id);
  });
});

describe('LitResultSchema', () => {
  it('parses a fully populated result', () => {
    expect(LitResultSchema.parse(crossrefHit)).toEqual(crossrefHit);
  });

  it('also accepts an ai-cli-sourced result (widened source enum)', () => {
    const aiCliHit: LitResult = { ...crossrefHit, source: 'ai-cli', id: crossrefHit.doi as string };
    expect(LitResultSchema.parse(aiCliHit)).toEqual(aiCliHit);
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
