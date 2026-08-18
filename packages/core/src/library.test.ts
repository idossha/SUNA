import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIBRARY_CONFIG,
  DEFAULT_LIBRARY_ROOTS,
  DOWNLOAD_POLICIES,
  DownloadPolicySchema,
  LIBRARY_CONFIG_FILENAME,
  LibraryConfigSchema,
  MATCH_CONFIDENCE,
  MatchConfidenceSchema,
  PDF_ACQUISITIONS,
  PDF_EVIDENCE_IDS,
  PdfAcquisitionSchema,
  PdfEvidenceIdSchema,
  PdfMatchSchema,
  StudyResolutionSchema,
  type PdfMatch,
  type StudyResolution,
} from './library';
import type { LitResult } from './lit';

const gunn1972: LitResult = {
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

const lookalike: LitResult = {
  ...gunn1972,
  source: 'openalex',
  id: 'W2035723945',
  doi: '10.1086/151606',
  title: 'On the infall of matter into clusters of galaxies II',
};

describe('LibraryConfigSchema', () => {
  it('parses DEFAULT_LIBRARY_CONFIG unchanged', () => {
    expect(LibraryConfigSchema.parse(DEFAULT_LIBRARY_CONFIG)).toEqual(DEFAULT_LIBRARY_CONFIG);
    expect(LIBRARY_CONFIG_FILENAME).toBe('library.json');
  });

  it('defaults to the user-chosen publisher policy and the bounded-walk limits', () => {
    expect(DEFAULT_LIBRARY_CONFIG.download).toBe('publisher');
    expect(DEFAULT_LIBRARY_CONFIG.useSpotlight).toBe(true);
    expect(DEFAULT_LIBRARY_CONFIG.maxDepth).toBe(6);
    expect(DEFAULT_LIBRARY_CONFIG.maxFilesScanned).toBe(20_000);
  });

  it('keeps the default roots portable — `~`-prefixed, never absolute', () => {
    expect([...DEFAULT_LIBRARY_ROOTS]).toEqual([
      '~/Downloads',
      '~/Documents',
      '~/Zotero/storage',
      '~/Papers',
    ]);
    expect(DEFAULT_LIBRARY_CONFIG.roots).toEqual([...DEFAULT_LIBRARY_ROOTS]);
    for (const root of DEFAULT_LIBRARY_CONFIG.roots) {
      expect(root.startsWith('~/')).toBe(true);
    }
  });

  it('rejects an out-of-range maxDepth on either side, and a fractional one', () => {
    expect(LibraryConfigSchema.safeParse({ ...DEFAULT_LIBRARY_CONFIG, maxDepth: 0 }).success).toBe(
      false,
    );
    expect(LibraryConfigSchema.safeParse({ ...DEFAULT_LIBRARY_CONFIG, maxDepth: 13 }).success).toBe(
      false,
    );
    expect(LibraryConfigSchema.safeParse({ ...DEFAULT_LIBRARY_CONFIG, maxDepth: 6.5 }).success).toBe(
      false,
    );
    expect(LibraryConfigSchema.parse({ ...DEFAULT_LIBRARY_CONFIG, maxDepth: 12 }).maxDepth).toBe(12);
  });

  it('bounds maxFilesScanned so one misconfigured root cannot walk the disk', () => {
    expect(
      LibraryConfigSchema.safeParse({ ...DEFAULT_LIBRARY_CONFIG, maxFilesScanned: 99 }).success,
    ).toBe(false);
    expect(
      LibraryConfigSchema.safeParse({ ...DEFAULT_LIBRARY_CONFIG, maxFilesScanned: 200_001 }).success,
    ).toBe(false);
    expect(
      LibraryConfigSchema.parse({ ...DEFAULT_LIBRARY_CONFIG, maxFilesScanned: 200_000 })
        .maxFilesScanned,
    ).toBe(200_000);
  });

  it('rejects a wrong schemaVersion, an empty root, and a field left off', () => {
    expect(
      LibraryConfigSchema.safeParse({ ...DEFAULT_LIBRARY_CONFIG, schemaVersion: 2 }).success,
    ).toBe(false);
    expect(LibraryConfigSchema.safeParse({ ...DEFAULT_LIBRARY_CONFIG, roots: [''] }).success).toBe(
      false,
    );
    const { useSpotlight: _useSpotlight, ...withoutSpotlight } = DEFAULT_LIBRARY_CONFIG;
    expect(LibraryConfigSchema.safeParse(withoutSpotlight).success).toBe(false);
  });
});

describe('DownloadPolicySchema', () => {
  it('accepts exactly off, open-access and publisher', () => {
    expect([...DOWNLOAD_POLICIES]).toEqual(['off', 'open-access', 'publisher']);
    for (const policy of DOWNLOAD_POLICIES) expect(DownloadPolicySchema.parse(policy)).toBe(policy);
    expect(DownloadPolicySchema.safeParse('any').success).toBe(false);
    expect(DownloadPolicySchema.safeParse('sci-hub').success).toBe(false);
  });
});

describe('PdfMatchSchema', () => {
  const byteMatch: PdfMatch = {
    path: '/Users/someone/Zotero/storage/ABCD1234/Gunn_1972_Infall.pdf',
    sizeBytes: 481_302,
    confidence: 'high',
    evidence: ['doi-in-bytes', 'filename-author-year'],
  };

  it('parses a byte-level match with its evidence', () => {
    expect(PdfMatchSchema.parse(byteMatch)).toEqual(byteMatch);
  });

  it('requires at least one evidence entry — a match with none is a guess', () => {
    expect(PdfMatchSchema.safeParse({ ...byteMatch, evidence: [] }).success).toBe(false);
    const { evidence: _evidence, ...withoutEvidence } = byteMatch;
    expect(PdfMatchSchema.safeParse(withoutEvidence).success).toBe(false);
    expect(
      PdfMatchSchema.parse({ ...byteMatch, confidence: 'low', evidence: ['filename-title-words'] })
        .evidence,
    ).toEqual(['filename-title-words']);
  });

  it('rejects an unknown evidence id, an empty path and a negative size', () => {
    expect([...PDF_EVIDENCE_IDS]).toEqual([
      'doi-in-bytes',
      'arxiv-id-in-bytes',
      'title-in-bytes',
      'filename-doi',
      'filename-arxiv-id',
      'filename-author-year',
      'filename-title-words',
      'spotlight-content-hit',
    ]);
    for (const id of PDF_EVIDENCE_IDS) expect(PdfEvidenceIdSchema.parse(id)).toBe(id);
    expect(PdfMatchSchema.safeParse({ ...byteMatch, evidence: ['vibes'] }).success).toBe(false);
    expect(PdfMatchSchema.safeParse({ ...byteMatch, path: '' }).success).toBe(false);
    expect(PdfMatchSchema.safeParse({ ...byteMatch, sizeBytes: -1 }).success).toBe(false);
  });
});

describe('MatchConfidenceSchema / PdfAcquisitionSchema', () => {
  it('ladders confidence high → medium → low', () => {
    expect([...MATCH_CONFIDENCE]).toEqual(['high', 'medium', 'low']);
    for (const level of MATCH_CONFIDENCE) expect(MatchConfidenceSchema.parse(level)).toBe(level);
    expect(MatchConfidenceSchema.safeParse('certain').success).toBe(false);
  });

  it('names the four acquisition outcomes in preference order, and unresolved is not one', () => {
    expect([...PDF_ACQUISITIONS]).toEqual([
      'already-present',
      'copied-local',
      'downloaded',
      'metadata-only',
    ]);
    for (const outcome of PDF_ACQUISITIONS) expect(PdfAcquisitionSchema.parse(outcome)).toBe(outcome);
    // 'unresolved' is a failure to identify the work, carried by chosen === null.
    expect(PdfAcquisitionSchema.safeParse('unresolved').success).toBe(false);
  });
});

describe('StudyResolutionSchema', () => {
  it('accepts chosen: null while still carrying alternatives and provider errors', () => {
    const ambiguous: StudyResolution = {
      chosen: null,
      confidence: 'low',
      alternatives: [gunn1972, lookalike],
      providersTried: ['crossref', 'openalex', 'biorxiv', 'arxiv'],
      errors: ['OpenAlex is rate-limited or out of budget (HTTP 429).'],
    };
    const parsed = StudyResolutionSchema.parse(ambiguous);
    expect(parsed.chosen).toBeNull();
    expect(parsed.alternatives).toHaveLength(2);
    // An unanswered provider is an error string, never evidence that no such paper exists.
    expect(parsed.errors[0]).toContain('429');
    expect(parsed.providersTried).toContain('openalex');
  });

  it('parses an outright win with no alternatives and no errors', () => {
    const decisive: StudyResolution = {
      chosen: gunn1972,
      confidence: 'high',
      alternatives: [],
      providersTried: ['crossref'],
      errors: [],
    };
    expect(StudyResolutionSchema.parse(decisive)).toEqual(decisive);
  });

  it('requires every field to be present — null is stated, never implied by omission', () => {
    const { chosen: _chosen, ...withoutChosen } = {
      chosen: null,
      confidence: 'low',
      alternatives: [],
      providersTried: ['crossref'],
      errors: [],
    };
    expect(StudyResolutionSchema.safeParse(withoutChosen).success).toBe(false);
    expect(
      StudyResolutionSchema.safeParse({
        chosen: gunn1972,
        confidence: 'high',
        alternatives: [],
        providersTried: ['crossref'],
      }).success,
    ).toBe(false);
    expect(
      StudyResolutionSchema.safeParse({
        chosen: gunn1972,
        confidence: 'high',
        alternatives: [],
        providersTried: [''],
        errors: [],
      }).success,
    ).toBe(false);
  });
});
