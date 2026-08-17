import { describe, expect, it } from 'vitest';
import { PublisherProfileSchema, type PublisherProfile } from './profile';

const apj: PublisherProfile = {
  schemaVersion: 3,
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

describe('PublisherProfileSchema v3 (author-guideline model)', () => {
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

  it('rejects the retired v2 schemaVersion', () => {
    const v2 = JSON.parse(JSON.stringify(apj));
    v2.schemaVersion = 2;
    expect(PublisherProfileSchema.safeParse(v2).success).toBe(false);
  });
});

describe('v3 provenance', () => {
  function withProvenance(entries: unknown): Record<string, unknown> {
    const doc = JSON.parse(JSON.stringify(apj)) as Record<string, unknown>;
    (doc['figures'] as Record<string, unknown>)['provenance'] = entries;
    return doc;
  }

  it('accepts per-section provenance entries on all three sections', () => {
    const doc = JSON.parse(JSON.stringify(apj));
    const entry = {
      claim: 'minFontPt: 6 — "A minimum of 6 pt. font size is acceptable"',
      basis: 'documented',
      source: 'https://journals.aas.org/graphics-guide/',
    };
    doc.figures.provenance = [entry];
    doc.citations.provenance = [
      { claim: 'collapseRanges: not applicable to author-year', basis: 'inferred', source: null },
    ];
    doc.manuscript.provenance = [
      { claim: 'panel style diverged from guidelines in 2022', basis: 'counted-empirically', source: null },
    ];
    const parsed = PublisherProfileSchema.parse(doc);
    expect(parsed.figures.provenance?.[0]?.basis).toBe('documented');
    expect(parsed.citations.provenance?.[0]?.source).toBeNull();
    expect(parsed.manuscript.provenance?.[0]?.basis).toBe('counted-empirically');
  });

  it('provenance is optional (absent on the base fixture)', () => {
    const parsed = PublisherProfileSchema.parse(apj);
    expect(parsed.figures.provenance).toBeUndefined();
  });

  it('rejects unknown bases, empty claims, and non-URL sources', () => {
    expect(
      PublisherProfileSchema.safeParse(
        withProvenance([{ claim: 'x', basis: 'guessed', source: null }]),
      ).success,
    ).toBe(false);
    expect(
      PublisherProfileSchema.safeParse(
        withProvenance([{ claim: '', basis: 'inferred', source: null }]),
      ).success,
    ).toBe(false);
    expect(
      PublisherProfileSchema.safeParse(
        withProvenance([{ claim: 'x', basis: 'documented', source: 'nature.com' }]),
      ).success,
    ).toBe(false);
  });
});

describe('v3 extends', () => {
  it('accepts a profile-id extends and keeps it on the parsed profile', () => {
    const doc = JSON.parse(JSON.stringify(apj));
    doc.extends = 'apj-aas';
    expect(PublisherProfileSchema.parse(doc).extends).toBe('apj-aas');
  });

  it('rejects extends values that are not valid profile ids', () => {
    for (const bad of ['Nature-Astronomy', '1abc', 'a b', '']) {
      const doc = JSON.parse(JSON.stringify(apj));
      doc.extends = bad;
      expect(PublisherProfileSchema.safeParse(doc).success).toBe(false);
    }
  });
});

describe('v3 documentStyle (partial delta over the SUNA default)', () => {
  function withStyle(documentStyle: unknown): Record<string, unknown> {
    const doc = JSON.parse(JSON.stringify(apj)) as Record<string, unknown>;
    doc['documentStyle'] = documentStyle;
    return doc;
  }

  it('accepts a conventions-only delta (what a journal profile states)', () => {
    const parsed = PublisherProfileSchema.parse(
      withStyle({
        figureLabel: 'Fig.',
        figurePlacement: 'captions-list',
        tablePlacement: 'end',
        referencesStartNewPage: true,
      }),
    );
    expect(parsed.documentStyle?.figureLabel).toBe('Fig.');
    expect(parsed.documentStyle?.figurePlacement).toBe('captions-list');
    // Unstated fields stay absent — inheritance is the resolver's job.
    expect(parsed.documentStyle?.page).toBeUndefined();
    expect(parsed.documentStyle?.lineSpacing).toBeUndefined();
  });

  it('accepts a nested partial: one page field, one size, nothing else', () => {
    const parsed = PublisherProfileSchema.parse(
      withStyle({ page: { marginMm: 25.4 }, sizesPt: { body: 12 } }),
    );
    expect(parsed.documentStyle?.page?.marginMm).toBe(25.4);
    expect(parsed.documentStyle?.page?.widthMm).toBeUndefined();
    expect(parsed.documentStyle?.sizesPt?.body).toBe(12);
    expect(parsed.documentStyle?.sizesPt?.title).toBeUndefined();
  });

  it('accepts a complete house style (every field stated)', () => {
    const parsed = PublisherProfileSchema.parse(
      withStyle({
        name: 'House',
        page: { widthMm: 215.9, heightMm: 279.4, marginMm: 12.7 },
        fonts: { body: 'Times New Roman', mono: 'Courier New' },
        sizesPt: {
          body: 11,
          title: 14,
          author: 8,
          affiliation: 9,
          heading1: 13,
          heading2: 11,
          caption: 10,
          reference: 10,
          tableCell: 10,
          footer: 9,
        },
        lineSpacing: 1.15,
        bodySpaceAfterPt: 6,
        referenceHangingMm: 12.7,
        figureWidthMm: 127,
        figureCaptionPosition: 'below',
        tableCaptionPosition: 'above',
        pageBreakAfterFrontMatter: true,
        figureLabel: 'Figure',
        figurePlacement: 'inline',
        tablePlacement: 'inline',
        referencesStartNewPage: true,
      }),
    );
    expect(parsed.documentStyle?.sizesPt?.footer).toBe(9);
    expect(parsed.documentStyle?.tablePlacement).toBe('inline');
  });

  it('rejects values outside the stated enums and non-positive dimensions', () => {
    expect(PublisherProfileSchema.safeParse(withStyle({ figureLabel: 'Figure.' })).success).toBe(
      false,
    );
    expect(
      PublisherProfileSchema.safeParse(withStyle({ figurePlacement: 'floating' })).success,
    ).toBe(false);
    expect(PublisherProfileSchema.safeParse(withStyle({ tablePlacement: 'appendix' })).success).toBe(
      false,
    );
    expect(
      PublisherProfileSchema.safeParse(withStyle({ page: { widthMm: -1 } })).success,
    ).toBe(false);
    expect(PublisherProfileSchema.safeParse(withStyle({ lineSpacing: 0 })).success).toBe(false);
  });

  it('remains optional: a profile with no documentStyle still parses', () => {
    const parsed = PublisherProfileSchema.parse(apj);
    expect(parsed.documentStyle).toBeUndefined();
  });
});

describe('v3 manuscript stageSeverity', () => {
  it('accepts a partial stage → severity mapping', () => {
    const doc = JSON.parse(JSON.stringify(apj));
    doc.manuscript.stageSeverity = { 'initial-submission': 'warning', accepted: 'error' };
    const parsed = PublisherProfileSchema.parse(doc);
    expect(parsed.manuscript.stageSeverity?.['initial-submission']).toBe('warning');
    expect(parsed.manuscript.stageSeverity?.accepted).toBe('error');
    expect(parsed.manuscript.stageSeverity?.revision).toBeUndefined();
  });

  it('rejects unknown stages and severities outside error|warning', () => {
    const badStage = JSON.parse(JSON.stringify(apj));
    badStage.manuscript.stageSeverity = { 'camera-ready': 'error' };
    expect(PublisherProfileSchema.safeParse(badStage).success).toBe(false);

    const badSeverity = JSON.parse(JSON.stringify(apj));
    badSeverity.manuscript.stageSeverity = { revision: 'info' };
    expect(PublisherProfileSchema.safeParse(badSeverity).success).toBe(false);
  });
});
