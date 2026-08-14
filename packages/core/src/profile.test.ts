import { describe, expect, it } from 'vitest';
import { PublisherProfileSchema, type PublisherProfile } from './profile';

const apj: PublisherProfile = {
  schemaVersion: 2,
  id: 'apj-aas',
  journalName: 'The Astrophysical Journal',
  publisher: 'AAS / IOP',
  lastVerified: '2026-08-13',
  citations: {
    mode: 'author-year',
    collapseRanges: false,
    textualTokens: { ref: 'ref.', refs: 'refs' },
    authorYear: {
      includeInitials: true,
      twoAuthorJoiner: '&',
      etAlFromNAuthors: 3,
      sameYearSuffixes: true,
    },
    referenceList: {
      entryTemplates: {
        article: '{authors} {year}, {journalAbbrev}, {volume}, {firstPage}, doi:{doi}',
        book: null,
        preprint: '{authors} {year}, arXiv e-prints, arXiv:{id}',
        software: '{author} {year}, {title}, {version}, {publisher}, {prefix}:{identifier}',
      },
      authorTruncation: { etAlAllowed: true, truncateWhenMoreThan: 5, keepFirstN: 3 },
      journalAbbreviation: 'ads',
      doiPolicy: 'doi: prefix or full https://doi.org/ URL',
      sortOrder: 'alphabetical',
    },
    maxReferences: null,
    sources: ['https://journals.aas.org/manuscript-preparation/'],
  },
  figures: {
    widthPresetsMm: { single: null, onehalf: null, double: null },
    maxHeightMm: null,
    minFontPt: 6,
    maxFontPt: null,
    lineWeightPt: { min: 0.5, max: null },
    preferredFontFamilies: ['Times', 'Helvetica', 'Symbol'],
    palette: {
      requirement: 'colorblind-safe-recommended',
      suggestedRamps: ['viridis', 'cubehelix'],
      suggestedHex: null,
      colorAsSoleDelimiter: 'forbidden',
      redGreenDiscouraged: null,
    },
    formats: {
      vectorPreferred: ['eps', 'pdf'],
      rasterAccepted: ['png', 'jpg', 'tiff'],
      minDpi: 300,
    },
    panelLabel: { letterCase: null, weight: null, wrapper: null },
    sources: ['https://journals.aas.org/graphics-guide/'],
  },
  manuscript: {
    articleTypes: [
      {
        id: 'apj-article',
        name: 'ApJ Article',
        wordLimit: null,
        abstractWordLimit: 250,
        titleLimitChars: null,
        maxDisplayItems: null,
        maxReferences: null,
      },
      {
        id: 'rnaas',
        name: 'Research Notes of the AAS',
        wordLimit: { max: 1500, scope: 'total, including references and captions', hard: true },
        abstractWordLimit: 150,
        titleLimitChars: null,
        maxDisplayItems: 1,
        maxReferences: null,
      },
    ],
    runningHeadLimitChars: 44,
    requiredSections: [
      { id: 'abstract', label: 'Abstract', required: true },
      { id: 'acknowledgments', label: 'Acknowledgments', required: true },
      { id: 'references', label: 'References', required: true },
    ],
    availabilityStatements: { data: true, code: null },
    submissionFormat: {
      doubleSpacing: null,
      lineNumbers: null,
      acceptedFileTypes: ['tex', 'docx'],
    },
    sources: ['https://journals.aas.org/manuscript-preparation/'],
  },
  notes: ['ApJL display-item limits are editor discretion, no longer compulsory.'],
};

describe('PublisherProfileSchema v2 (author-guideline model)', () => {
  it('accepts a realistic guideline profile', () => {
    const parsed = PublisherProfileSchema.parse(apj);
    expect(parsed.figures.minFontPt).toBe(6);
    expect(parsed.citations.mode).toBe('author-year');
  });

  it('nullable rules mean "not stated" and are legal everywhere', () => {
    const parsed = PublisherProfileSchema.parse(apj);
    expect(parsed.figures.widthPresetsMm.single).toBeNull();
    expect(parsed.manuscript.submissionFormat.doubleSpacing).toBeNull();
  });

  it('rejects the retired v1 page-geometry shape', () => {
    expect(
      PublisherProfileSchema.safeParse({
        id: 'nature-astronomy',
        name: 'Nature Astronomy',
        page: { trimMm: { w: 210, h: 280 } },
      }).success,
    ).toBe(false);
  });

  it('rejects bad hex colors, unknown citation modes, and malformed source URLs', () => {
    const badHex = JSON.parse(JSON.stringify(apj));
    badHex.figures.palette.suggestedHex = ['#12345'];
    expect(PublisherProfileSchema.safeParse(badHex).success).toBe(false);

    const badMode = JSON.parse(JSON.stringify(apj)) as unknown as Record<string, unknown>;
    (badMode['citations'] as Record<string, unknown>)['mode'] = 'footnotes';
    expect(PublisherProfileSchema.safeParse(badMode).success).toBe(false);

    const badUrl = JSON.parse(JSON.stringify(apj));
    badUrl.manuscript.sources = ['journals.aas.org'];
    expect(PublisherProfileSchema.safeParse(badUrl).success).toBe(false);
  });
});
