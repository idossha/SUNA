/**
 * Shared fixtures for the checker tests (not exported from the package).
 * The profile mirrors the realistic ApJ example in @suna/core's
 * profile.test.ts; both factories validate through the zod schemas so a
 * schema drift fails loudly here rather than silently skewing the checks.
 */
import {
  ManuscriptSchema,
  PublisherProfileSchema,
  type Manuscript,
  type PublisherProfile,
} from '@suna/core';

export function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
}

export function apjProfile(): PublisherProfile {
  return PublisherProfileSchema.parse({
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
    notes: [],
  });
}

export function makeManuscript(): Manuscript {
  return ManuscriptSchema.parse({
    title: 'Star formation in dwarf galaxies',
    shortTitle: 'Dwarf star formation',
    articleType: 'article',
    doi: null,
    openAccess: null,
    authors: [
      {
        id: 'a1',
        given: 'Ada',
        family: 'Lovelace',
        nativeScript: null,
        orcid: null,
        affiliationRefs: [],
        corresponding: true,
        email: null,
        equalContribution: false,
        deceased: false,
      },
    ],
    affiliations: [],
    history: { received: null, accepted: null, publishedOnline: null },
    abstract: { content: words(100) },
    body: [
      {
        kind: 'section',
        heading: 'Introduction',
        level: 'A',
        content: 'sections/intro.md',
        children: [],
      },
      {
        kind: 'section',
        heading: 'Methods',
        level: 'A',
        content: 'sections/methods.md',
        children: [],
      },
      {
        kind: 'section',
        heading: 'Results',
        level: 'A',
        content: 'sections/results.md',
        children: [],
      },
    ],
    figures: [
      {
        id: 'fig1',
        namespace: 'main',
        canvasRef: 'figures/fig1/figure.svg',
        widthPreset: 'single',
        caption: { title: words(4), body: words(6) },
        panels: [],
      },
    ],
    tables: [],
    availability: { data: 'Data are available at doi:10.5281/zenodo.1', code: 'github.com/x/y' },
    backMatter: {
      acknowledgements: 'We thank the anonymous referee.',
      authorContributions: null,
      funding: [],
      competingInterests: null,
      peerReview: null,
      supplementaryInfo: null,
    },
    bibliography: 'references.bib',
  });
}

/** Section markdown matching makeManuscript's body: 900 words + 100 abstract. */
export function makeSectionTexts(): Record<string, string> {
  return {
    'sections/intro.md': words(200),
    'sections/methods.md': words(300),
    'sections/results.md': words(400),
  };
}
