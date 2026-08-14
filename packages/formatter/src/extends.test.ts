import { describe, expect, it } from 'vitest';
import { BUNDLED_RAW, loadProfile } from './profiles';

/**
 * `extends` resolution: a child profile names a base profile id, the loader
 * deep-merges the resolved parent beneath it (child overrides, arrays
 * replace), and only the merged document is schema-validated.
 */

/** Minimal valid child: identity fields + targeted overrides. */
function child(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 3,
    id: 'apj-child',
    extends: 'apj-aas',
    journalName: 'ApJ Child Journal',
    publisher: 'AAS / IOP',
    ...overrides,
  };
}

describe('loadProfile — extends against the bundled registry', () => {
  it('inherits everything the child does not state', () => {
    const p = loadProfile(child());
    expect(p.id).toBe('apj-child');
    expect(p.extends).toBe('apj-aas');
    expect(p.journalName).toBe('ApJ Child Journal');
    // Inherited from apj-aas untouched:
    expect(p.citations.mode).toBe('author-year');
    expect(p.citations.authorYear?.etAlFromNAuthors).toBe(3);
    expect(p.figures.minFontPt).toBe(6);
    expect(p.manuscript.runningHeadLimitChars).toBe(44);
    expect(p.lastVerified).toBe('2026-08-13');
  });

  it('deep-merges nested objects: child overrides one leaf, siblings survive', () => {
    const p = loadProfile(
      child({
        figures: { minFontPt: 7, palette: { requirement: 'none-stated' } },
      }),
    );
    expect(p.figures.minFontPt).toBe(7); // overridden
    expect(p.figures.lineWeightPt.min).toBe(0.5); // sibling object inherited
    expect(p.figures.palette.requirement).toBe('none-stated'); // overridden leaf
    expect(p.figures.palette.colorAsSoleDelimiter).toBe('forbidden'); // sibling leaf inherited
    expect(p.figures.formats.minDpi).toBe(300);
  });

  it('arrays replace wholesale, never concatenate', () => {
    const p = loadProfile(
      child({
        citations: { sources: ['https://example.org/child-style'] },
        notes: ['child note'],
      }),
    );
    expect(p.citations.sources).toEqual(['https://example.org/child-style']);
    expect(p.notes).toEqual(['child note']);
    // apj-aas has 3 article types; untouched array inherited as-is.
    expect(p.manuscript.articleTypes.map((t) => t.id)).toEqual([
      'apj-article',
      'apj-letter',
      'rnaas',
    ]);
  });

  it('explicit child null overrides an inherited value', () => {
    const p = loadProfile(child({ manuscript: { runningHeadLimitChars: null } }));
    expect(p.manuscript.runningHeadLimitChars).toBeNull();
  });

  it('resolves multi-level chains through a custom registry', () => {
    const registry = {
      ...BUNDLED_RAW,
      'apj-mid': child({ id: 'apj-mid', figures: { minFontPt: 8 } }),
    };
    const leaf = child({ id: 'apj-leaf', extends: 'apj-mid', figures: { maxFontPt: 12 } });
    const p = loadProfile(leaf, { registry });
    expect(p.figures.minFontPt).toBe(8); // from mid
    expect(p.figures.maxFontPt).toBe(12); // from leaf
    expect(p.citations.mode).toBe('author-year'); // from apj-aas grandparent
  });

  it('throws on an unknown parent id, naming the child', () => {
    expect(() => loadProfile(child({ extends: 'no-such-journal' }))).toThrowError(
      /Unknown parent profile "no-such-journal".*"apj-child"/,
    );
  });

  it('throws on circular chains instead of recursing forever', () => {
    const a = child({ id: 'prof-a', extends: 'prof-b' });
    const b = child({ id: 'prof-b', extends: 'prof-a' });
    expect(() => loadProfile(a, { registry: { 'prof-a': a, 'prof-b': b } })).toThrowError(
      /Circular "extends" chain.*prof-a.*prof-b/,
    );
  });

  it('throws on direct self-extension', () => {
    const a = child({ id: 'prof-a', extends: 'prof-a' });
    expect(() => loadProfile(a, { registry: { 'prof-a': a } })).toThrowError(/Circular/);
  });

  it('validates the merged document — invalid overrides still fail loudly', () => {
    expect(() => loadProfile(child({ figures: { minFontPt: -3 } }))).toThrowError(
      /Invalid publisher profile "apj-child"/,
    );
  });

  it('a profile without extends is untouched by the resolver', () => {
    const p = loadProfile(BUNDLED_RAW['apj-aas']);
    expect(p.extends).toBeUndefined();
    expect(p.id).toBe('apj-aas');
  });
});
