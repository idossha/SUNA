import { describe, expect, it } from 'vitest';
import {
  assignNumbers,
  renderCluster,
  type CitationStyleConfig,
  type CiteRendering,
} from './cite.js';
import type { BibEntry } from './model.js';

const superscript: CitationStyleConfig = {
  mode: 'numeric-superscript',
  collapseRanges: true,
  textualTokens: { ref: 'ref.', refs: 'refs.' },
};

const parenthetical: CitationStyleConfig = {
  mode: 'parenthetical-numeric',
  collapseRanges: true,
  textualTokens: { ref: 'ref.', refs: 'refs.' },
};

const authorYear: CitationStyleConfig = {
  mode: 'author-year',
  collapseRanges: false,
  textualTokens: { ref: 'ref.', refs: 'refs.' },
};

function text(rendering: CiteRendering): string {
  return rendering.inline.map((run) => run.text).join('');
}

function numbersFor(keys: readonly string[]): Map<string, number> {
  return assignNumbers([keys]);
}

describe('assignNumbers', () => {
  it('numbers by order of first appearance across clusters', () => {
    const numbers = assignNumbers([['a'], ['b', 'c'], ['a', 'd'], ['b']]);
    expect([...numbers.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);
  });

  it('is stable for repeated keys inside one cluster', () => {
    expect([...assignNumbers([['x', 'x', 'y']]).entries()]).toEqual([
      ['x', 1],
      ['y', 2],
    ]);
  });
});

describe('renderCluster numeric-superscript', () => {
  it('sorts and collapses runs of three or more into en-dash ranges', () => {
    const numbers = numbersFor(['k1', 'k2', 'k3', 'k4']);
    const rendering = renderCluster({ keys: ['k4', 'k1', 'k2', 'k3'], narrative: false }, numbers, superscript);
    expect(text(rendering)).toBe('1–4');
    expect(rendering.form).toBe('superscript');
    expect(rendering.inline).toEqual([
      { text: '1', link: { refKey: 'k1' } },
      { text: '–' },
      { text: '4', link: { refKey: 'k4' } },
    ]);
  });

  it('keeps pairs uncollapsed', () => {
    const numbers = numbersFor(['k1', 'k2']);
    expect(text(renderCluster({ keys: ['k1', 'k2'], narrative: false }, numbers, superscript))).toBe('1,2');
  });

  it('mixes singletons and ranges', () => {
    const numbers = assignNumbers([['a', 'x1', 'b', 'x2', 'x3', 'x4', 'x5', 'c', 'd', 'e']]);
    const rendering = renderCluster(
      { keys: ['c', 'a', 'e', 'd'], narrative: false },
      numbers,
      superscript,
    );
    expect(text(rendering)).toBe('1,8–10');
  });

  it('collates literally when collapseRanges is off', () => {
    const numbers = numbersFor(['k1', 'k2', 'k3', 'k4']);
    const style: CitationStyleConfig = { ...superscript, collapseRanges: false };
    expect(text(renderCluster({ keys: ['k1', 'k2', 'k3', 'k4'], narrative: false }, numbers, style))).toBe(
      '1,2,3,4',
    );
  });

  it('deduplicates repeated keys', () => {
    const numbers = numbersFor(['k1']);
    expect(text(renderCluster({ keys: ['k1', 'k1'], narrative: false }, numbers, superscript))).toBe('1');
  });

  it('renders the singular textual token in narrative position', () => {
    const numbers = assignNumbers([Array.from({ length: 14 }, (_, i) => `k${i + 1}`)]);
    const rendering = renderCluster({ keys: ['k14'], narrative: true }, numbers, superscript);
    expect(text(rendering)).toBe('ref. 14');
    expect(rendering.form).toBe('inline');
  });

  it('renders the plural textual token in narrative position', () => {
    const numbers = assignNumbers([Array.from({ length: 17 }, (_, i) => `k${i + 1}`)]);
    const rendering = renderCluster({ keys: ['k16', 'k17'], narrative: true }, numbers, superscript);
    expect(text(rendering)).toBe('refs. 16,17');
  });

  it('honors profile token spelling without a period', () => {
    const numbers = assignNumbers([Array.from({ length: 17 }, (_, i) => `k${i + 1}`)]);
    const style: CitationStyleConfig = { ...superscript, textualTokens: { ref: 'ref.', refs: 'refs' } };
    expect(text(renderCluster({ keys: ['k16', 'k17'], narrative: true }, numbers, style))).toBe('refs 16,17');
  });
});

describe('renderCluster parenthetical-numeric', () => {
  it('renders comma-space separated numbers in parentheses', () => {
    const numbers = assignNumbers([Array.from({ length: 15 }, (_, i) => `k${i + 1}`)]);
    const rendering = renderCluster({ keys: ['k14', 'k15'], narrative: false }, numbers, parenthetical);
    expect(text(rendering)).toBe('(14, 15)');
    expect(rendering.form).toBe('inline');
  });

  it('collapses ranges inside the parentheses', () => {
    const numbers = numbersFor(['k1', 'k2', 'k3', 'k4']);
    expect(
      text(renderCluster({ keys: ['k1', 'k2', 'k3', 'k4'], narrative: false }, numbers, parenthetical)),
    ).toBe('(1–4)');
  });
});

function entry(key: string, families: string[], year: string): BibEntry {
  return {
    key,
    entryType: 'article',
    title: key,
    authors: families.map((family) => ({ kind: 'person', family, given: 'A.' })),
    year,
    raw: {},
  };
}

describe('renderCluster author-year', () => {
  const entries = new Map<string, BibEntry>([
    ['wang2026', entry('wang2026', ['Wang', 'Sun', 'Zhou', 'Xu'], '2026')],
    ['li2023', entry('li2023', ['Li', 'Zhang'], '2023')],
    ['dressler2019', entry('dressler2019', ['Dressler'], '2019')],
  ]);
  const numbers = assignNumbers([['wang2026', 'li2023', 'dressler2019']]);

  it('truncates three or more authors to et al. and joins with semicolons', () => {
    const rendering = renderCluster(
      { keys: ['wang2026', 'li2023'], narrative: false },
      numbers,
      authorYear,
      entries,
    );
    expect(text(rendering)).toBe('(Wang et al. 2026; Li & Zhang 2023)');
    expect(rendering.form).toBe('inline');
  });

  it('renders single authors without truncation', () => {
    expect(
      text(renderCluster({ keys: ['dressler2019'], narrative: false }, numbers, authorYear, entries)),
    ).toBe('(Dressler 2019)');
  });

  it('renders narrative form with the year in parentheses', () => {
    const rendering = renderCluster(
      { keys: ['wang2026'], narrative: true },
      numbers,
      authorYear,
      entries,
    );
    expect(text(rendering)).toBe('Wang et al. (2026)');
    expect(rendering.inline[0]?.link).toEqual({ refKey: 'wang2026' });
  });

  it('falls back to the cite key when the entry is unknown', () => {
    expect(text(renderCluster({ keys: ['ghost'], narrative: false }, numbers, authorYear, entries))).toBe(
      '(ghost)',
    );
  });
});
