import { describe, expect, it } from 'vitest';
import { ASTRO_FIXTURE } from './fixture.js';
import { formatReference, type BibFormatConfig } from './format.js';
import type { BibEntry, Run } from './model.js';
import { parseBibtex } from './parse.js';

const cfg: BibFormatConfig = {
  maxAuthors: 5,
  journalAbbreviations: {
    'Nature Astronomy': 'Nat. Astron.',
    'Nature Physics': 'Nat. Phys.',
    'Astrophysical Journal': 'Astrophys. J.',
  },
};

const byKey = new Map(parseBibtex(ASTRO_FIXTURE).entries.map((e) => [e.key, e]));

function get(key: string): BibEntry {
  const entry = byKey.get(key);
  if (entry === undefined) throw new Error(`missing fixture entry ${key}`);
  return entry;
}

function text(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join('');
}

describe('formatReference — Nature article pattern', () => {
  it('renders the exact run sequence for a two-author article', () => {
    expect(formatReference(get('fernandez2024'), cfg)).toEqual([
      { text: 'Fernández, I. & Böhm, J. ' },
      {
        text: 'Sérsic profiles of stripped galaxies',
        link: { url: 'https://doi.org/10.3847/1538-4357/ad0f21' },
      },
      { text: '. ' },
      { text: 'Astrophys. J.', style: 'italic' },
      { text: ' ' },
      { text: '961', style: 'bold' },
      { text: ', 88–104 (2024).' },
    ]);
  });

  it('truncates a 12-author list after maxAuthors with et al.', () => {
    const runs = formatReference(get('wang2026'), cfg);
    expect(text(runs)).toBe(
      'Wang, T., Sun, H., Zhou, L., Xu, K., Cheng, C. et al. ' +
        'A massive quiescent galaxy cluster at z=2.32. Nat. Astron. 10, 1208–1217 (2026).',
    );
    expect(runs.find((r) => r.style === 'italic')?.text).toBe('Nat. Astron.');
    expect(runs.find((r) => r.style === 'bold')?.text).toBe('10');
  });

  it('passes a literal collaboration credit through untouched', () => {
    const runs = formatReference(get('aartsen2017'), cfg);
    expect(runs[0]?.text).toBe('Aartsen, M. G. & Ackermann, M. (for the IceCube Collaboration) ');
    expect(text(runs)).toContain('Nat. Phys. 13, 232–238 (2017).');
  });

  it('falls back to the full journal name when no abbreviation is known', () => {
    const runs = formatReference(get('li2023'), cfg);
    expect(runs.find((r) => r.style === 'italic')?.text).toBe(
      'Monthly Notices of the Royal Astronomical Society',
    );
    expect(text(runs)).toContain(', 3210–3226 (2023).');
  });

  it('links the title via url when no doi exists', () => {
    const runs = formatReference(get('li2023'), cfg);
    const titleRun = runs.find((r) => r.link !== undefined);
    expect(titleRun?.link).toEqual({ url: 'https://arxiv.org/abs/2301.09876' });
  });
});

describe('formatReference — book chapter', () => {
  it('renders the exact in-Book (eds ...) pages (Publisher, year) sequence', () => {
    expect(formatReference(get('dressler2019'), cfg)).toEqual([
      { text: 'Dressler, A. in ' },
      { text: 'Clusters of Galaxies: Probes of Cosmological Structure', style: 'italic' },
      { text: ' (eds Mulchaey, J. S., Dressler, A. & Oemler, A.) 206–237 (Cambridge Univ. Press, 2019).' },
    ]);
  });

  it('uses the singular editor token for one editor', () => {
    const entry = get('dressler2019');
    const single: BibEntry = { ...entry, editors: entry.editors?.slice(0, 1) ?? [] };
    expect(text(formatReference(single, cfg))).toContain('(ed. Mulchaey, J. S.)');
  });
});

describe('formatReference — preprint', () => {
  it('renders "Preprint at" with a live arXiv link run', () => {
    expect(formatReference(get('gupta2025'), cfg)).toEqual([
      { text: "Gupta, P. & O'Neil, S. Ram-pressure stripping in high-redshift protoclusters. Preprint at " },
      {
        text: 'https://arxiv.org/abs/2501.04321',
        link: { url: 'https://arxiv.org/abs/2501.04321' },
      },
      { text: ' (2025).' },
    ]);
  });
});

describe('formatReference — software', () => {
  it('renders title, version and DOI link', () => {
    expect(formatReference(get('sunpy2022'), cfg)).toEqual([
      { text: 'Mumford, S. & The SunPy Community. SunPy v4.1.0. ' },
      {
        text: 'https://doi.org/10.5281/zenodo.7314636',
        link: { url: 'https://doi.org/10.5281/zenodo.7314636' },
      },
      { text: ' (2022).' },
    ]);
  });
});

describe('formatReference — name details', () => {
  it('initializes hyphenated and multi-part given names', () => {
    const entry: BibEntry = {
      key: 'x',
      entryType: 'article',
      title: 'T',
      authors: [
        { kind: 'person', family: 'Curie', given: 'Marie Sklodowska' },
        { kind: 'person', family: 'Blanc', given: 'Jean-Paul' },
      ],
      journal: 'J',
      year: '2000',
      raw: {},
    };
    expect(formatReference(entry, cfg)[0]?.text).toBe('Curie, M. S. & Blanc, J.-P. T. ');
  });
});
