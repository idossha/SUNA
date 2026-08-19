import { describe, expect, it } from 'vitest';
import demoManuscript from '../../../examples/demo-paper/manuscript/manuscript.json';
import { ManuscriptSchema, type Manuscript } from './manuscript';

const fixture = {
  title: 'A massive protocluster at $z = 2.51$ traced by ram-pressure stripping',
  articleType: 'article',
  doi: null,
  openAccess: {
    license: 'CC-BY-4.0',
    copyrightHolder: 'The Author(s)',
    year: 2026,
  },
  history: {
    received: '2025-06-04',
    accepted: '2026-05-12',
    publishedOnline: '2026-06-22',
  },
  abstract: {
    content: 'We report the discovery of a massive galaxy cluster at $z = 2.51$.',
  },
  manuscriptFile: 'manuscript.md',
  figures: [
    {
      id: 'fig-cluster',
      namespace: 'main',
      canvasRef: 'figures/fig-cluster/figure.svg',
      widthPreset: 'double',
      caption: {
        title: 'Sky image of CLJ1001.',
        body: '**a**, JWST composite with WCS axes. **b**, X-ray contours.',
        credits: 'NASA/JWST',
      },
      panels: [{ letter: 'a' }, { letter: 'b', subLabels: ['i', 'ii'] }],
    },
    {
      id: 'edfig-snr',
      namespace: 'extended-data',
      canvasRef: 'figures/edfig-snr/figure.svg',
      widthPreset: 'single',
      caption: { title: 'SNR diagnostics.', body: 'Per-panel overlay fits.' },
      panels: [{ letter: 'a' }],
    },
  ],
  tables: [],
  availability: {
    data: 'Imaging data are available at MAST under doi:10.17909/example.',
    code: 'Analysis code is available at https://github.com/example/cluster.',
  },
  backMatter: {
    acknowledgements: 'We thank the JWST operations team.',
    authorContributions: 'T.W. led the analysis; A.S. performed the simulations.',
    funding: [{ funder: 'NSFC', grant: '12173017' }],
    competingInterests: 'The authors declare no competing interests.',
    peerReview: {
      statement: 'Nature Astronomy thanks the anonymous reviewers.',
      reviewers: ['Anonymous'],
    },
    supplementaryInfo: null,
  },
  bibliography: 'references.bib',
} satisfies Manuscript;

describe('ManuscriptSchema', () => {
  it('parses a Nature-Astronomy-like manuscript', () => {
    const parsed = ManuscriptSchema.parse(fixture);
    expect(parsed).toEqual(fixture);
  });

  it('defaults manuscriptFile to manuscript.md when the field is absent', () => {
    const { manuscriptFile: _omitted, ...withoutFile } = fixture;
    const parsed = ManuscriptSchema.parse(withoutFile);
    expect(parsed.manuscriptFile).toBe('manuscript.md');
  });

  it('lets a project name its prose file something else', () => {
    const parsed = ManuscriptSchema.parse({ ...fixture, manuscriptFile: 'paper.md' });
    expect(parsed.manuscriptFile).toBe('paper.md');
    expect(ManuscriptSchema.safeParse({ ...fixture, manuscriptFile: '' }).success).toBe(false);
  });

  it('no longer carries prose or people: body/authors/affiliations are dropped', () => {
    const legacy: unknown = {
      ...fixture,
      body: [{ kind: 'section', heading: null, level: 'A', content: 'sections/intro.md', children: [] }],
      authors: [{ id: 'a1', given: 'Tao', family: 'Wang' }],
      affiliations: [{ id: 'af1', text: 'Nanjing University' }],
    };
    const parsed = ManuscriptSchema.parse(legacy);
    expect(parsed).not.toHaveProperty('body');
    expect(parsed).not.toHaveProperty('authors');
    expect(parsed).not.toHaveProperty('affiliations');
    expect(parsed).toEqual(fixture);
  });

  it('separates main and extended-data figure namespaces', () => {
    const parsed = ManuscriptSchema.parse(fixture);
    expect(parsed.figures.map((f) => f.namespace)).toEqual(['main', 'extended-data']);
  });

  it('never stores numbering: smuggled number fields are stripped', () => {
    const smuggled: unknown = {
      ...fixture,
      figures: [{ ...fixture.figures[0], number: 1 }],
    };
    const parsed = ManuscriptSchema.parse(smuggled);
    expect(parsed.figures[0]).not.toHaveProperty('number');
  });

  it('rejects a figure with an unknown namespace', () => {
    const bad: unknown = {
      ...fixture,
      figures: [{ ...fixture.figures[0], namespace: 'supplementary' }],
    };
    expect(ManuscriptSchema.safeParse(bad).success).toBe(false);
  });

  it('leaves significance and highlights absent when not provided (backward compatible)', () => {
    const parsed = ManuscriptSchema.parse(fixture);
    expect(parsed.significance).toBeUndefined();
    expect(parsed.highlights).toBeUndefined();
  });

  it('accepts a significance paragraph and a highlights list', () => {
    const withExtras: unknown = {
      ...fixture,
      significance: 'Ram-pressure stripping quenches star formation within ~300 Myr.',
      highlights: ['A massive protocluster at $z = 2.51$', 'Stripping traced in H$\\alpha$'],
    };
    const parsed = ManuscriptSchema.parse(withExtras);
    expect(parsed.significance).toBe(
      'Ram-pressure stripping quenches star formation within ~300 Myr.',
    );
    expect(parsed.highlights).toHaveLength(2);
  });

  it('accepts explicit null significance and highlights', () => {
    const withNulls: unknown = { ...fixture, significance: null, highlights: null };
    const parsed = ManuscriptSchema.parse(withNulls);
    expect(parsed.significance).toBeNull();
    expect(parsed.highlights).toBeNull();
  });

  it('rejects an empty significance string and non-string highlights', () => {
    expect(ManuscriptSchema.safeParse({ ...fixture, significance: '' }).success).toBe(false);
    expect(ManuscriptSchema.safeParse({ ...fixture, highlights: [42] }).success).toBe(false);
  });

  it('leaves keywords absent when not provided (backward compatible)', () => {
    const parsed = ManuscriptSchema.parse(fixture);
    expect(parsed.keywords).toBeUndefined();
  });

  it('accepts author-ordered keywords and preserves their order', () => {
    const parsed = ManuscriptSchema.parse({
      ...fixture,
      keywords: ['protoclusters', 'ram-pressure stripping', 'high-redshift galaxies'],
    });
    expect(parsed.keywords).toEqual([
      'protoclusters',
      'ram-pressure stripping',
      'high-redshift galaxies',
    ]);
  });

  it('rejects empty-string and non-string keywords', () => {
    expect(ManuscriptSchema.safeParse({ ...fixture, keywords: [''] }).success).toBe(false);
    expect(ManuscriptSchema.safeParse({ ...fixture, keywords: [42] }).success).toBe(false);
  });

  it('keeps the shipped demo-paper example schema-valid', () => {
    const parsed = ManuscriptSchema.parse(demoManuscript);
    expect(parsed.significance).toBeTypeOf('string');
    expect(parsed.manuscriptFile).toBe('manuscript.md');
    expect(demoManuscript).not.toHaveProperty('body');
    expect(demoManuscript).not.toHaveProperty('authors');
  });
});
