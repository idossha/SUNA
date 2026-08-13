import { describe, expect, it } from 'vitest';
import { ASTRO_FIXTURE } from './fixture.js';
import { detectArxivId, type BibEntry } from './model.js';
import { parseBibtex } from './parse.js';

const result = parseBibtex(ASTRO_FIXTURE);
const byKey = new Map(result.entries.map((e) => [e.key, e]));

function get(key: string): BibEntry {
  const entry = byKey.get(key);
  if (entry === undefined) throw new Error(`missing fixture entry ${key}`);
  return entry;
}

describe('parseBibtex', () => {
  it('parses the seven well-formed entries', () => {
    expect(result.entries.map((e) => e.key)).toEqual([
      'wang2026',
      'aartsen2017',
      'dressler2019',
      'gupta2025',
      'sunpy2022',
      'fernandez2024',
      'li2023',
    ]);
  });

  it('collects the malformed entry as an issue instead of throwing', () => {
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/unterminated/i);
    expect(result.errors[0]?.input).toContain('@article{broken2020');
    expect(byKey.has('broken2020')).toBe(false);
  });

  it('never throws on fully malformed or empty input', () => {
    const garbage = parseBibtex('@article{x, title = {');
    expect(garbage.entries).toEqual([]);
    expect(garbage.errors.length).toBeGreaterThan(0);
    expect(parseBibtex('')).toEqual({ entries: [], errors: [] });
  });

  it('parses a 12-author article with structured names', () => {
    const entry = get('wang2026');
    expect(entry.entryType).toBe('article');
    expect(entry.authors).toHaveLength(12);
    expect(entry.authors.every((a) => a.kind === 'person')).toBe(true);
    expect(entry.authors[0]).toEqual({ kind: 'person', family: 'Wang', given: 'Tao' });
    expect(entry.authors[11]).toEqual({ kind: 'person', family: 'Liu', given: 'Mengting' });
    expect(entry.journal).toBe('Nature Astronomy');
    expect(entry.volume).toBe('10');
    expect(entry.year).toBe('2026');
    expect(entry.doi).toBe('10.1038/s41550-026-1234-5');
  });

  it('normalizes double-hyphen page ranges to en dashes', () => {
    expect(get('wang2026').pages).toBe('1208–1217');
    expect(get('dressler2019').pages).toBe('206–237');
  });

  it('keeps a braced collaboration credit as a literal author', () => {
    const entry = get('aartsen2017');
    expect(entry.authors[2]).toEqual({
      kind: 'literal',
      literal: '(for the IceCube Collaboration)',
    });
    expect(entry.authors[0]).toEqual({ kind: 'person', family: 'Aartsen', given: 'M. G.' });
  });

  it('parses incollection editors, booktitle and publisher', () => {
    const entry = get('dressler2019');
    expect(entry.entryType).toBe('incollection');
    expect(entry.booktitle).toBe('Clusters of Galaxies: Probes of Cosmological Structure');
    expect(entry.publisher).toBe('Cambridge Univ. Press');
    expect(entry.editors).toEqual([
      { kind: 'person', family: 'Mulchaey', given: 'John S.' },
      { kind: 'person', family: 'Dressler', given: 'Alan' },
      { kind: 'person', family: 'Oemler', given: 'Augustus' },
    ]);
  });

  it('detects an arXiv id from the eprint field', () => {
    const entry = get('gupta2025');
    expect(entry.arxivId).toBe('2501.04321');
    expect(entry.journal).toBeUndefined();
    expect(entry.raw['primaryclass']).toBe('astro-ph.GA');
  });

  it('detects an arXiv id from a url field', () => {
    const entry = get('li2023');
    expect(entry.arxivId).toBe('2301.09876');
    expect(entry.url).toBe('https://arxiv.org/abs/2301.09876');
  });

  it('parses software entries with version and Zenodo doi', () => {
    const entry = get('sunpy2022');
    expect(entry.entryType).toBe('software');
    expect(entry.doi).toBe('10.5281/zenodo.7314636');
    expect(entry.raw['version']).toBe('4.1.0');
    expect(entry.authors[1]).toEqual({ kind: 'literal', literal: 'The SunPy Community' });
  });

  it('normalizes LaTeX accents to unicode', () => {
    const entry = get('fernandez2024');
    expect(entry.authors[0]).toEqual({ kind: 'person', family: 'Fernández', given: 'Inés' });
    expect(entry.authors[1]).toEqual({ kind: 'person', family: 'Böhm', given: 'Jürgen' });
    expect(entry.title).toBe('Sérsic profiles of stripped galaxies');
  });

  it('keeps original LaTeX in the raw fields map', () => {
    expect(get('fernandez2024').raw['title']).toBe(String.raw`S{\'e}rsic profiles of stripped galaxies`);
    expect(get('li2023').raw['title']).toBe('Molecular gas at $z=2$ traced by {CO} emission');
  });

  it('flattens math in titles without dropping its content', () => {
    expect(get('wang2026').title).toBe('A massive quiescent galaxy cluster at z=2.32');
    expect(get('li2023').title).toBe('Molecular gas at z=2 traced by CO emission');
  });
});

describe('detectArxivId', () => {
  it('accepts old-style eprint identifiers', () => {
    expect(detectArxivId({ eprint: 'astro-ph/0601001' })).toBe('astro-ph/0601001');
  });

  it('rejects eprints from other archives', () => {
    expect(detectArxivId({ eprint: '2024.01.02.573904', archivePrefix: 'bioRxiv' })).toBeUndefined();
  });

  it('reads arXiv DOIs', () => {
    expect(detectArxivId({ doi: '10.48550/arXiv.2301.00001' })).toBe('2301.00001');
  });

  it('ignores non-arXiv urls', () => {
    expect(detectArxivId({ url: 'https://example.org/abs/123' })).toBeUndefined();
  });
});
