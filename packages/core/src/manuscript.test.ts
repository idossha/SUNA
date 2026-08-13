import { describe, expect, it } from 'vitest';
import { ManuscriptSchema, type Manuscript } from './manuscript';

const fixture = {
  title: 'A massive protocluster at $z = 2.51$ traced by ram-pressure stripping',
  shortTitle: 'Protocluster at z = 2.51',
  articleType: 'article',
  doi: null,
  openAccess: {
    license: 'CC-BY-4.0',
    copyrightHolder: 'The Author(s)',
    year: 2026,
  },
  authors: [
    {
      id: 'a1',
      given: 'Tao',
      family: 'Wang',
      nativeScript: '王涛',
      orcid: '0000-0002-2504-2421',
      affiliationRefs: ['af1', 'af2'],
      corresponding: true,
      email: 'taowang@nju.edu.cn',
      equalContribution: false,
      deceased: false,
    },
    {
      id: 'a2',
      given: 'Ada',
      family: 'Smith',
      nativeScript: null,
      orcid: '0000-0001-5109-370X',
      affiliationRefs: ['af2'],
      corresponding: false,
      email: null,
      equalContribution: false,
      deceased: false,
    },
  ],
  affiliations: [
    { id: 'af1', text: 'School of Astronomy and Space Science, Nanjing University, Nanjing, China' },
    { id: 'af2', text: 'Department of Astronomy, University of Wisconsin-Madison, Madison, WI, USA' },
  ],
  history: {
    received: '2025-06-04',
    accepted: '2026-05-12',
    publishedOnline: '2026-06-22',
  },
  abstract: {
    content: 'We report the discovery of a massive galaxy cluster at $z = 2.51$.',
  },
  body: [
    { kind: 'section', heading: null, level: 'A', content: 'sections/intro.md', children: [] },
    {
      kind: 'section',
      heading: 'Results',
      level: 'A',
      content: null,
      children: [
        {
          kind: 'section',
          heading: 'Cluster identification',
          level: 'B',
          content: 'sections/results-identification.md',
          children: [],
        },
      ],
    },
    {
      kind: 'section',
      heading: 'Methods',
      level: 'A',
      content: null,
      children: [
        {
          kind: 'section',
          heading: 'Particle initialization.',
          level: 'C-runin',
          content: 'sections/methods-particles.md',
          children: [],
        },
      ],
    },
  ],
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

  it('represents an unheaded intro as heading: null', () => {
    const parsed = ManuscriptSchema.parse(fixture);
    const intro = parsed.body[0];
    if (intro?.kind !== 'section') throw new Error('expected section node');
    expect(intro.heading).toBeNull();
    expect(intro.content).toBe('sections/intro.md');
  });

  it('preserves the nested section tree including run-in C-heads', () => {
    const parsed = ManuscriptSchema.parse(fixture);
    const methods = parsed.body[2];
    if (methods?.kind !== 'section') throw new Error('expected section node');
    expect(methods.heading).toBe('Methods');
    expect(methods.children[0]?.level).toBe('C-runin');
  });

  it('keeps authors with ORCID, native script, and affiliation refs', () => {
    const parsed = ManuscriptSchema.parse(fixture);
    expect(parsed.authors).toHaveLength(2);
    expect(parsed.authors[0]?.orcid).toBe('0000-0002-2504-2421');
    expect(parsed.authors[0]?.nativeScript).toBe('王涛');
    expect(parsed.authors[0]?.corresponding).toBe(true);
    expect(parsed.authors[1]?.affiliationRefs).toEqual(['af2']);
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

  it('rejects a section with an invalid heading level', () => {
    const bad: unknown = {
      ...fixture,
      body: [{ kind: 'section', heading: 'Bad', level: 'D', content: null, children: [] }],
    };
    expect(ManuscriptSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid level nested deep in the section tree', () => {
    const bad: unknown = {
      ...fixture,
      body: [
        {
          kind: 'section',
          heading: 'Results',
          level: 'A',
          content: null,
          children: [
            { kind: 'section', heading: 'Sub', level: 'Z', content: null, children: [] },
          ],
        },
      ],
    };
    expect(ManuscriptSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects inline section content that is not a sections/*.md path', () => {
    const bad: unknown = {
      ...fixture,
      body: [
        {
          kind: 'section',
          heading: null,
          level: 'A',
          content: 'This is inline prose, not a path.',
          children: [],
        },
      ],
    };
    expect(ManuscriptSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a figure with an unknown namespace', () => {
    const bad: unknown = {
      ...fixture,
      figures: [{ ...fixture.figures[0], namespace: 'supplementary' }],
    };
    expect(ManuscriptSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed ORCID', () => {
    const bad: unknown = {
      ...fixture,
      authors: [{ ...fixture.authors[0], orcid: '12-34' }],
    };
    expect(ManuscriptSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a box node in the body flow', () => {
    const withBox: unknown = {
      ...fixture,
      body: [
        ...fixture.body,
        {
          kind: 'box',
          id: 'box-icecube',
          title: 'The IceCube experiment.',
          content: 'sections/box-icecube.md',
          figureRefs: ['figB1'],
        },
      ],
    };
    const parsed = ManuscriptSchema.parse(withBox);
    const box = parsed.body[3];
    if (box?.kind !== 'box') throw new Error('expected box node');
    expect(box.figureRefs).toEqual(['figB1']);
  });
});
