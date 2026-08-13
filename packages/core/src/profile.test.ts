import { describe, expect, it } from 'vitest';
import { PublisherProfileSchema, type PublisherProfile } from './profile';

const natureAstronomy = {
  id: 'nature-astronomy',
  name: 'Nature Astronomy',
  page: {
    trimMm: { w: 210, h: 280 },
    marginsMm: { top: 18, bottom: 20, inner: 17, outer: 17 },
    columns: 2,
    columnWidthMm: 89,
    gutterMm: 5,
    textBlockWidthMm: 183,
    folio: { mode: 'continuing', start: 1208 },
  },
  typography: {
    body: { family: 'serif', sizePt: 8.75, weight: 'regular', justified: true, hyphenation: true },
    headings: { family: 'sans', sizePt: 9, weight: 'bold' },
    title: { family: 'serif', sizePt: 27, weight: 'bold' },
    abstract: { family: 'serif', sizePt: 11, weight: 'regular' },
    caption: { family: 'sans', sizePt: 7.25, weight: 'regular' },
    references: { family: 'sans', sizePt: 7.5, weight: 'regular' },
    affiliations: { family: 'sans', sizePt: 6, weight: 'regular' },
    dropCap: { enabled: false, lines: 3, scope: 'first-paragraph-only' },
  },
  headingLevels: {
    A: { sizePt: 10, weight: 'bold', runIn: false, terminator: null },
    B: { sizePt: 8.75, weight: 'bold', runIn: false, terminator: null },
    'C-runin': { sizePt: 8.75, weight: 'bold', runIn: true, terminator: '.' },
  },
  frontMatter: {
    masthead: {
      style: 'rule-bands',
      showOpenAccessBadge: true,
      showArticleType: true,
      showDoiStrip: true,
    },
    historyRail: { enabled: true, widthPercent: 30, showCheckForUpdatesBadge: true },
    abstractStyle: 'rule-delimited-block',
    affiliationsPlacement: 'footnote-page1',
  },
  runningPage: {
    header: { mode: 'uniform', template: '{articleType} | {doi}' },
    footer: { template: '{journal} | Volume {volume} | {month} {year} | {firstPage}-{lastPage}' },
  },
  sectionOrder: [
    { id: 'methods', kind: 'body', required: true },
    { id: 'data-availability', kind: 'back-matter', required: true },
    { id: 'code-availability', kind: 'back-matter', required: true },
    { id: 'references', kind: 'references', required: true },
    { id: 'acknowledgements', kind: 'back-matter', required: false },
    { id: 'author-contributions', kind: 'back-matter', required: true },
    { id: 'funding', kind: 'back-matter', required: false },
    { id: 'competing-interests', kind: 'back-matter', required: true },
    { id: 'additional-information', kind: 'back-matter', required: true },
    { id: 'deferred-affiliations', kind: 'affiliations', required: false },
    { id: 'extended-data', kind: 'extended-data', required: false },
  ],
  captionStyle: { figureLabel: 'Fig.', separator: '|', panelLetterStyle: 'bold-lowercase' },
  tableStyle: {
    label: 'Table',
    separator: '|',
    headerBand: true,
    zebraStriping: false,
    rules: 'horizontal-only',
    footnoteSizePt: 6.5,
  },
  equationNumbering: 'continuous',
  citation: {
    mode: 'numeric-superscript',
    collapseRanges: true,
    textualTokens: { ref: 'ref.', refs: 'refs.' },
  },
  bibliographyFormat: { authorTruncation: 5, initialsStyle: 'period-space', abbreviateJournals: true },
  figureWidthPresetsMm: { single: 89, double: 183 },
  colors: { accent: '#00857C', link: '#0768AC', banner: null },
  namespaces: {
    main: { figureLabel: 'Fig.', tableLabel: 'Table', placement: 'in-flow' },
    'extended-data': {
      figureLabel: 'Extended Data Fig.',
      tableLabel: 'Extended Data Table',
      placement: 'one-per-page-back-matter',
    },
    box: { figureLabel: 'Figure B', tableLabel: null, placement: 'in-box' },
  },
} satisfies PublisherProfile;

describe('PublisherProfileSchema', () => {
  it('parses the Nature Astronomy profile', () => {
    const parsed = PublisherProfileSchema.parse(natureAstronomy);
    expect(parsed).toEqual(natureAstronomy);
  });

  it('encodes Nature Astronomy page geometry from reference-analysis 1.1', () => {
    const parsed = PublisherProfileSchema.parse(natureAstronomy);
    expect(parsed.page.trimMm).toEqual({ w: 210, h: 280 });
    expect(parsed.page.columns).toBe(2);
    expect(parsed.figureWidthPresetsMm).toEqual({ single: 89, double: 183 });
  });

  it('encodes numeric-superscript citations with range collapsing', () => {
    const parsed = PublisherProfileSchema.parse(natureAstronomy);
    expect(parsed.citation.mode).toBe('numeric-superscript');
    expect(parsed.citation.collapseRanges).toBe(true);
    expect(parsed.citation.textualTokens.refs).toBe('refs.');
  });

  it('keeps section ordering as data with required flags', () => {
    const parsed = PublisherProfileSchema.parse(natureAstronomy);
    expect(parsed.sectionOrder[0]?.id).toBe('methods');
    expect(parsed.sectionOrder.filter((s) => s.required)).toHaveLength(7);
  });

  it('rejects an unknown citation mode', () => {
    const bad: unknown = {
      ...natureAstronomy,
      citation: { ...natureAstronomy.citation, mode: 'footnote' },
    };
    expect(PublisherProfileSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a namespaces config missing a namespace key', () => {
    const { box: _box, ...partial } = natureAstronomy.namespaces;
    const bad: unknown = { ...natureAstronomy, namespaces: partial };
    expect(PublisherProfileSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown folio mode', () => {
    const bad: unknown = {
      ...natureAstronomy,
      page: { ...natureAstronomy.page, folio: { mode: 'roman', start: null } },
    };
    expect(PublisherProfileSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed brand color', () => {
    const bad: unknown = {
      ...natureAstronomy,
      colors: { ...natureAstronomy.colors, accent: 'teal' },
    };
    expect(PublisherProfileSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects heading level configs missing the C-runin entry', () => {
    const { 'C-runin': _c, ...partial } = natureAstronomy.headingLevels;
    const bad: unknown = { ...natureAstronomy, headingLevels: partial };
    expect(PublisherProfileSchema.safeParse(bad).success).toBe(false);
  });
});
