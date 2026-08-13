import { describe, expect, it } from 'vitest';
import { ASTRO_FIXTURE } from './fixture.js';
import type { BibEntry } from './model.js';
import { parseBibtex } from './parse.js';
import { serializeBibtex } from './serialize.js';

function modelProjection(entry: BibEntry): Omit<BibEntry, 'raw'> {
  const { raw: _raw, ...rest } = entry;
  return rest;
}

describe('serializeBibtex', () => {
  const first = parseBibtex(ASTRO_FIXTURE);
  const serialized = serializeBibtex(first.entries);

  it('emits one block per entry with stable field order', () => {
    expect(serialized).toContain('@software{sunpy2022,');
    const wang = serialized.slice(serialized.indexOf('@article{wang2026'));
    const authorAt = wang.indexOf('author = ');
    const titleAt = wang.indexOf('title = ');
    const journalAt = wang.indexOf('journal = ');
    const yearAt = wang.indexOf('year = ');
    expect(authorAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(authorAt);
    expect(journalAt).toBeGreaterThan(titleAt);
    expect(yearAt).toBeGreaterThan(journalAt);
  });

  it('braces literal authors and joins names with "and"', () => {
    expect(serialized).toContain('{(for the IceCube Collaboration)}');
    expect(serialized).toContain('Mumford, Stuart and {The SunPy Community}');
  });

  it('materializes detected arXiv ids as eprint fields', () => {
    const li = serialized.slice(serialized.indexOf('@article{li2023'));
    expect(li).toContain('eprint = {2301.09876}');
    expect(li).toContain('archiveprefix = {arXiv}');
  });

  it('passes through raw-only fields such as primaryclass and version', () => {
    expect(serialized).toContain('primaryclass = {astro-ph.GA}');
    expect(serialized).toContain('version = {4.1.0}');
  });

  it('round-trips: parse -> serialize -> parse preserves the model', () => {
    const second = parseBibtex(serialized);
    expect(second.errors).toEqual([]);
    expect(second.entries.map(modelProjection)).toEqual(first.entries.map(modelProjection));
  });

  it('round-trips: serialization is stable from the first generation on', () => {
    const second = parseBibtex(serialized);
    expect(serializeBibtex(second.entries)).toBe(serialized);
  });

  it('escapes unbalanced braces instead of emitting invalid BibTeX', () => {
    const entry: BibEntry = {
      key: 'odd2020',
      entryType: 'misc',
      title: 'A title with a stray } brace',
      authors: [{ kind: 'person', family: 'Kim', given: 'Ha' }],
      year: '2020',
      raw: {},
    };
    const reparsed = parseBibtex(serializeBibtex([entry]));
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.entries[0]?.title).toContain('stray');
  });
});
