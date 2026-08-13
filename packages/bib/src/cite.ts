import type { Author, BibEntry, Run } from './model.js';

export interface CitationCluster {
  keys: readonly string[];
  narrative: boolean;
}

export type CitationMode = 'numeric-superscript' | 'author-year' | 'parenthetical-numeric';

export interface CitationStyleConfig {
  mode: CitationMode;
  collapseRanges: boolean;
  textualTokens: { ref: string; refs: string };
}

export interface CiteRendering {
  inline: Run[];
  form: 'superscript' | 'inline';
}

export function assignNumbers(citedKeysInOrder: readonly (readonly string[])[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const cluster of citedKeysInOrder) {
    for (const key of cluster) {
      if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    }
  }
  return numbers;
}

const EN_DASH = '–';

interface NumberedKey {
  key: string;
  n: number;
}

function numberedKeys(keys: readonly string[], numbers: ReadonlyMap<string, number>): NumberedKey[] {
  const byNumber = new Map<number, string>();
  for (const key of keys) {
    const n = numbers.get(key);
    if (n !== undefined && !byNumber.has(n)) byNumber.set(n, key);
  }
  return [...byNumber.entries()].map(([n, key]) => ({ key, n })).sort((a, b) => a.n - b.n);
}

function collate(items: readonly NumberedKey[], collapseRanges: boolean, separator: string): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < items.length) {
    let end = i;
    while (end + 1 < items.length) {
      const next = items[end + 1];
      const current = items[end];
      if (next === undefined || current === undefined || next.n !== current.n + 1) break;
      end += 1;
    }
    const runLength = end - i + 1;
    const first = items[i];
    if (first === undefined) break;
    if (runs.length > 0) runs.push({ text: separator });
    if (collapseRanges && runLength >= 3) {
      const last = items[end];
      if (last !== undefined) {
        runs.push({ text: String(first.n), link: { refKey: first.key } });
        runs.push({ text: EN_DASH });
        runs.push({ text: String(last.n), link: { refKey: last.key } });
      }
      i = end + 1;
    } else {
      runs.push({ text: String(first.n), link: { refKey: first.key } });
      i += 1;
    }
  }
  return runs;
}

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

function citeName(authors: readonly Author[]): string {
  const nameOf = (author: Author): string =>
    author.kind === 'person' ? author.family : author.literal;
  const first = authors[0];
  if (first === undefined) return 'Anon.';
  if (authors.length === 1) return nameOf(first);
  const second = authors[1];
  if (authors.length === 2 && second !== undefined) return `${nameOf(first)} & ${nameOf(second)}`;
  return `${nameOf(first)} et al.`;
}

function renderAuthorYear(
  cluster: CitationCluster,
  entries: ReadonlyMap<string, BibEntry> | undefined,
): CiteRendering {
  const keys = uniqueKeys(cluster.keys);
  const inline: Run[] = [];
  if (!cluster.narrative) inline.push({ text: '(' });
  keys.forEach((key, index) => {
    if (index > 0) inline.push({ text: '; ' });
    const entry = entries?.get(key);
    if (entry === undefined) {
      inline.push({ text: key, link: { refKey: key } });
      return;
    }
    const name = citeName(entry.authors);
    const year = entry.year ?? 'n.d.';
    const text = cluster.narrative ? `${name} (${year})` : `${name} ${year}`;
    inline.push({ text, link: { refKey: key } });
  });
  if (!cluster.narrative) inline.push({ text: ')' });
  return { inline, form: 'inline' };
}

export function renderCluster(
  cluster: CitationCluster,
  numbers: ReadonlyMap<string, number>,
  style: CitationStyleConfig,
  entries?: ReadonlyMap<string, BibEntry>,
): CiteRendering {
  switch (style.mode) {
    case 'author-year':
      return renderAuthorYear(cluster, entries);
    case 'numeric-superscript': {
      const items = numberedKeys(cluster.keys, numbers);
      const collated = collate(items, style.collapseRanges, ',');
      if (cluster.narrative) {
        const token = items.length === 1 ? style.textualTokens.ref : style.textualTokens.refs;
        return { inline: [{ text: `${token} ` }, ...collated], form: 'inline' };
      }
      return { inline: collated, form: 'superscript' };
    }
    case 'parenthetical-numeric': {
      const items = numberedKeys(cluster.keys, numbers);
      const collated = collate(items, style.collapseRanges, ', ');
      if (cluster.narrative) {
        const token = items.length === 1 ? style.textualTokens.ref : style.textualTokens.refs;
        return { inline: [{ text: `${token} ` }, ...collated], form: 'inline' };
      }
      return { inline: [{ text: '(' }, ...collated, { text: ')' }], form: 'inline' };
    }
  }
}
