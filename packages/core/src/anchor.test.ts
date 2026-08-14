import { describe, expect, it } from 'vitest';
import { locate, makeAnchor } from './anchor';

describe('makeAnchor', () => {
  it('captures the quote plus up to 32 chars of context on each side', () => {
    const text = `${'a'.repeat(40)}TARGET${'b'.repeat(40)}`;
    const anchor = makeAnchor(text, 40, 46);
    expect(anchor.quote).toBe('TARGET');
    expect(anchor.prefix).toBe('a'.repeat(32));
    expect(anchor.suffix).toBe('b'.repeat(32));
  });

  it('clamps context at the start and end of the document', () => {
    const text = 'hi TARGET bye';
    const anchor = makeAnchor(text, 3, 9);
    expect(anchor.quote).toBe('TARGET');
    expect(anchor.prefix).toBe('hi ');
    expect(anchor.suffix).toBe(' bye');
  });
});

describe('locate', () => {
  it('finds an exact, unique quote', () => {
    const text = 'The best-fit centroid of 6563.3 Å was measured twice.';
    const range = locate(text, { quote: 'best-fit centroid of 6563.3' });
    expect(range).not.toBeNull();
    expect(text.slice(range!.from, range!.to)).toBe('best-fit centroid of 6563.3');
  });

  it('disambiguates a duplicate quote using its stored prefix', () => {
    const text = 'First: the result was significant. Second: the result was not significant.';
    const anchor = makeAnchor(text, text.indexOf('Second: the result') + 'Second: '.length, text.indexOf('Second: the result') + 'Second: the result'.length);
    // anchor.quote is "the result"; the same phrase also appears in the "First:" clause
    expect(anchor.quote).toBe('the result');
    const range = locate(text, anchor);
    expect(range).not.toBeNull();
    // must resolve to the SECOND occurrence, matching the captured prefix
    expect(range!.from).toBe(text.indexOf('Second: the result') + 'Second: '.length);
  });

  it('still resolves a unique quote after the document is edited around it', () => {
    const original = 'Intro text. The best-fit centroid of 6563.3 Å was measured.';
    const anchor = makeAnchor(
      original,
      original.indexOf('best-fit centroid'),
      original.indexOf('best-fit centroid') + 'best-fit centroid of 6563.3'.length
    );
    const edited =
      'A completely different opening paragraph was inserted here.\n\n' +
      'The best-fit centroid of 6563.3 Å was measured, later confirmed by a second pipeline.';
    const range = locate(edited, anchor);
    expect(range).not.toBeNull();
    expect(edited.slice(range!.from, range!.to)).toBe('best-fit centroid of 6563.3');
  });

  it('returns null once the quoted text has been deleted', () => {
    const original = 'The best-fit centroid of 6563.3 Å was measured.';
    const anchor = makeAnchor(
      original,
      original.indexOf('best-fit centroid'),
      original.indexOf('best-fit centroid') + 'best-fit centroid of 6563.3'.length
    );
    const edited = 'The line center was measured.';
    expect(locate(edited, anchor)).toBeNull();
  });

  it('falls back to a whitespace-normalized fuzzy match when the quote was rewrapped', () => {
    const original = 'This sentence   has irregular   spacing in it.';
    const anchor = makeAnchor(original, original.indexOf('irregular'), original.indexOf('spacing') + 'spacing'.length);
    expect(anchor.quote).toBe('irregular   spacing');
    const edited = 'A different lead-in.\nThis sentence has\nirregular\nspacing in it, reflowed.';
    const range = locate(edited, anchor);
    expect(range).not.toBeNull();
    expect(edited.slice(range!.from, range!.to).replace(/\s+/g, ' ')).toBe('irregular spacing');
  });

  it('returns null for an empty quote', () => {
    expect(locate('anything', { quote: '' })).toBeNull();
  });

  it('defaults missing prefix/suffix to empty strings without throwing', () => {
    const text = 'one two three';
    expect(locate(text, { quote: 'two' })).toEqual({ from: 4, to: 7 });
  });
});
