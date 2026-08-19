import { describe, expect, it } from 'vitest';
import {
  buildPageText,
  contiguousRuns,
  itemAtOffset,
  offsetsForItemRange,
  offsetsForRun,
  type PdfTextItemLike,
} from './pdftext';

/** Terser fixtures: `t('word')` is a mid-line item, `t('word', true)` ends a line. */
function t(str: string, hasEOL = false): PdfTextItemLike {
  return { str, hasEOL };
}

describe('buildPageText — the join rule', () => {
  it('does NOT insert a space between items on the same line', () => {
    // pdf.js emits inter-word spacing inside `str`; a word split by kerning
    // across two items must not gain a space it never had.
    const page = buildPageText([t('quen'), t('ching')]);
    expect(page.text).toBe('quenching');
  });

  it('keeps the spacing pdf.js already put in the item strings', () => {
    const page = buildPageText([t('ram '), t('pressure')]);
    expect(page.text).toBe('ram pressure');
  });

  it('turns a plain line break into one space', () => {
    const page = buildPageText([t('falling into dense', true), t('cluster environments')]);
    expect(page.text).toBe('falling into dense cluster environments');
  });

  it('collapses a run of line breaks into a single space', () => {
    const page = buildPageText([t('one', true), t('', true), t('', true), t('two')]);
    expect(page.text).toBe('one two');
  });

  it('never leads with a separator', () => {
    const page = buildPageText([t('', true), t('first')]);
    expect(page.text).toBe('first');
  });

  it('is empty for no items, and for only-empty items', () => {
    expect(buildPageText([]).text).toBe('');
    expect(buildPageText([t(''), t('', true)]).text).toBe('');
  });
});

describe('buildPageText — de-hyphenation, following pdf.js normalize()', () => {
  it('rejoins a lowercase word broken across a line', () => {
    const page = buildPageText([t('quench-', true), t('ing galaxies')]);
    expect(page.text).toBe('quenching galaxies');
  });

  it('rejoins an uppercase-led break before any letter', () => {
    const page = buildPageText([t('X-', true), t('Ray emission')]);
    expect(page.text).toBe('XRay emission');
  });

  it('keeps the hyphen when the break is not a word break', () => {
    // `\S-\n` — a real compound keeps its hyphen but the lines still join tight.
    const page = buildPageText([t('cluster-', true), t('Scale flows')]);
    expect(page.text).toBe('cluster-Scale flows');
  });

  it('does not rejoin across digits', () => {
    const page = buildPageText([t('1-', true), t('2')]);
    expect(page.text).toBe('1-2');
  });

  it('treats a hyphen standing alone after a space as ordinary', () => {
    const page = buildPageText([t('a -', true), t('b')]);
    expect(page.text).toBe('a - b');
  });

  it('leaves a mid-line hyphen completely alone', () => {
    const page = buildPageText([t('ram-pressure stripping')]);
    expect(page.text).toBe('ram-pressure stripping');
  });

  it('moves the previous item end back when the hyphen is dropped', () => {
    const page = buildPageText([t('quench-', true), t('ing')]);
    expect(page.text).toBe('quenching');
    // item 0 contributed "quench" (6 chars), not "quench-" (7).
    expect(page.itemStarts[0]).toBe(0);
    expect(page.itemEnds[0]).toBe(6);
    expect(page.itemStarts[1]).toBe(6);
    expect(page.itemEnds[1]).toBe(9);
    expect(page.text.slice(page.itemStarts[1], page.itemEnds[1])).toBe('ing');
  });

  it('survives an item that is only a hyphen', () => {
    const page = buildPageText([t('quench'), t('-', true), t('ing')]);
    expect(page.text).toBe('quenching');
    // the hyphen item now contributes nothing
    expect(page.itemEnds[1]).toBe(page.itemStarts[1]);
  });
});

describe('buildPageText — index alignment', () => {
  it('emits one entry per item, empties included', () => {
    // pdf.js keeps empty items in `textDivs` but never appends them to the DOM,
    // so indices must stay 1:1 with the items array or every span lookup skews.
    const items = [t('a'), t(''), t('b', true), t(''), t('c')];
    const page = buildPageText(items);
    expect(page.itemStarts).toHaveLength(items.length);
    expect(page.itemEnds).toHaveLength(items.length);
  });

  it('slices back to the original strings', () => {
    const items = [t('Galaxies falling'), t(' into'), t(' dense clusters', true), t('lose gas')];
    const page = buildPageText(items);
    expect(page.text.slice(page.itemStarts[0], page.itemEnds[0])).toBe('Galaxies falling');
    expect(page.text.slice(page.itemStarts[1], page.itemEnds[1])).toBe(' into');
    expect(page.text.slice(page.itemStarts[3], page.itemEnds[3])).toBe('lose gas');
  });
});

describe('itemAtOffset', () => {
  const page = buildPageText([t('alpha'), t('beta', true), t('gamma')]);
  // text: "alphabeta gamma"

  it('finds the item holding an offset, with the distance into it', () => {
    expect(itemAtOffset(page, 0)).toEqual({ index: 0, within: 0 });
    expect(itemAtOffset(page, 3)).toEqual({ index: 0, within: 3 });
    expect(itemAtOffset(page, 5)).toEqual({ index: 1, within: 0 });
    expect(itemAtOffset(page, 7)).toEqual({ index: 1, within: 2 });
  });

  it('reports an offset inside a seam as the end of the item before it', () => {
    // index 9 is the space that the line break became — it belongs to no item.
    expect(itemAtOffset(page, 9)).toEqual({ index: 1, within: 4 });
  });

  it('handles the very end of the page', () => {
    expect(itemAtOffset(page, page.text.length)).toEqual({ index: 2, within: 5 });
  });

  it('returns null outside the page and for an empty page', () => {
    expect(itemAtOffset(page, -1)).toBeNull();
    expect(itemAtOffset(page, page.text.length + 1)).toBeNull();
    expect(itemAtOffset(buildPageText([]), 0)).toBeNull();
  });

  it('skips back over empty items so `within` is meaningful', () => {
    const withEmpties = buildPageText([t('abc'), t(''), t('def')]);
    expect(itemAtOffset(withEmpties, 3)).toEqual({ index: 2, within: 0 });
  });
});

describe('offsetsForItemRange', () => {
  const page = buildPageText([t('alpha'), t('beta', true), t('gamma')]);

  it('spans from one partial item to another', () => {
    expect(offsetsForItemRange(page, 0, 2, 2, 3)).toEqual({ from: 2, to: 13 });
    expect(page.text.slice(2, 13)).toBe('phabeta gam');
  });

  it('normalises a backwards selection', () => {
    expect(offsetsForItemRange(page, 2, 3, 0, 2)).toEqual({ from: 2, to: 13 });
  });

  it('clamps an over-long `within` to the item it names', () => {
    expect(offsetsForItemRange(page, 0, 999, 0, 999)).toEqual({ from: 5, to: 5 });
  });

  it('returns null for an index off the end', () => {
    expect(offsetsForItemRange(page, 0, 0, 9, 0)).toBeNull();
    expect(offsetsForItemRange(page, -1, 0, 0, 0)).toBeNull();
  });
});

describe('contiguousRuns', () => {
  it('groups consecutive indices and splits on a gap', () => {
    expect(contiguousRuns([0, 1, 2, 5, 6, 9])).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 6 },
      { start: 9, end: 9 },
    ]);
  });

  it('sorts and de-duplicates its input', () => {
    expect(contiguousRuns([6, 2, 1, 6, 2])).toEqual([
      { start: 1, end: 2 },
      { start: 6, end: 6 },
    ]);
  });

  it('is empty for no indices, and a single run for one', () => {
    expect(contiguousRuns([])).toEqual([]);
    expect(contiguousRuns([4])).toEqual([{ start: 4, end: 4 }]);
  });

  it('splits the real failure it exists for: an interloping item', () => {
    // Two visually adjacent lines are items 10 and 12; item 11 is a caption
    // fragment elsewhere on the page. Selecting the two lines must yield TWO
    // runs, not one span that swallows item 11's text.
    expect(contiguousRuns([10, 12])).toEqual([
      { start: 10, end: 10 },
      { start: 12, end: 12 },
    ]);
  });
});

describe('offsetsForRun', () => {
  const page = buildPageText([t('alpha'), t('beta', true), t('gamma')]);

  it('covers a whole run', () => {
    expect(offsetsForRun(page, { start: 0, end: 1 })).toEqual({ from: 0, to: 9 });
    expect(page.text.slice(0, 9)).toBe('alphabeta');
  });

  it('returns null for a run outside the page', () => {
    expect(offsetsForRun(page, { start: 0, end: 7 })).toBeNull();
  });
});

describe('a realistic two-column page fragment', () => {
  // Line-broken, hyphenated body text with a stray interloper between two
  // visually adjacent lines — the shape every rule here exists for.
  const items = [
    t('Galaxies falling into dense cluster environ-', true),
    t('ments can lose their star-forming gas within', true),
    t('FIG. 2. Velocity map', true), // interloper: a caption, elsewhere on the page
    t('a few hundred million years.', true),
  ];
  const page = buildPageText(items);

  it('reads as prose, with the broken word rejoined', () => {
    expect(page.text).toBe(
      'Galaxies falling into dense cluster environments can lose their star-forming gas within ' +
        'FIG. 2. Velocity map a few hundred million years.',
    );
  });

  it('keeps the compound hyphen in "star-forming"', () => {
    expect(page.text).toContain('star-forming');
  });

  it('quoting the two body lines yields two runs that skip the caption', () => {
    const runs = contiguousRuns([0, 1, 3]);
    expect(runs).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 3 },
    ]);
    const quoted = runs
      .map((run) => {
        const span = offsetsForRun(page, run);
        return span === null ? '' : page.text.slice(span.from, span.to);
      })
      .join(' ');
    expect(quoted).toBe(
      'Galaxies falling into dense cluster environments can lose their star-forming gas within ' +
        'a few hundred million years.',
    );
    expect(quoted).not.toContain('Velocity map');
  });
});
