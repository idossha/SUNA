import type { Author, BibEntry } from './model.js';

const FIELD_ORDER = [
  'author',
  'editor',
  'title',
  'booktitle',
  'journal',
  'volume',
  'pages',
  'publisher',
  'year',
  'doi',
  'eprint',
  'archiveprefix',
  'primaryclass',
  'version',
  'url',
  'note',
] as const;

function bracesBalanced(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function fieldValue(value: string): string {
  const safe = bracesBalanced(value) ? value : value.replace(/[{}]/g, '\\$&');
  return `{${safe}}`;
}

function authorToBibtex(author: Author): string {
  switch (author.kind) {
    case 'literal':
      return `{${author.literal}}`;
    case 'person':
      return author.given !== undefined ? `${author.family}, ${author.given}` : author.family;
  }
}

function modelFields(entry: BibEntry): Map<string, string> {
  const fields = new Map<string, string>();
  if (entry.authors.length > 0) fields.set('author', entry.authors.map(authorToBibtex).join(' and '));
  if (entry.editors !== undefined && entry.editors.length > 0) {
    fields.set('editor', entry.editors.map(authorToBibtex).join(' and '));
  }
  if (entry.title !== '') fields.set('title', entry.title);
  if (entry.booktitle !== undefined) fields.set('booktitle', entry.booktitle);
  if (entry.journal !== undefined) fields.set('journal', entry.journal);
  if (entry.volume !== undefined) fields.set('volume', entry.volume);
  if (entry.pages !== undefined) fields.set('pages', entry.pages);
  if (entry.publisher !== undefined) fields.set('publisher', entry.publisher);
  if (entry.year !== undefined) fields.set('year', entry.year);
  if (entry.doi !== undefined) fields.set('doi', entry.doi);
  if (entry.arxivId !== undefined) {
    fields.set('eprint', entry.arxivId);
    fields.set('archiveprefix', entry.raw['archiveprefix'] ?? 'arXiv');
  }
  if (entry.url !== undefined) fields.set('url', entry.url);
  if (entry.note !== undefined) fields.set('note', entry.note);
  return fields;
}

const MODEL_OWNED = new Set([
  'author',
  'editor',
  'title',
  'booktitle',
  'journal',
  'journaltitle',
  'volume',
  'pages',
  'publisher',
  'year',
  'doi',
  'eprint',
  'archiveprefix',
  'url',
  'note',
]);

export function serializeEntry(entry: BibEntry): string {
  const fields = modelFields(entry);
  for (const [name, value] of Object.entries(entry.raw)) {
    if (!MODEL_OWNED.has(name) && !fields.has(name)) fields.set(name, value);
  }

  const ordered: [string, string][] = [];
  const seen = new Set<string>();
  for (const name of FIELD_ORDER) {
    const value = fields.get(name);
    if (value !== undefined) {
      ordered.push([name, value]);
      seen.add(name);
    }
  }
  const rest = [...fields.keys()].filter((name) => !seen.has(name)).sort();
  for (const name of rest) {
    const value = fields.get(name);
    if (value !== undefined) ordered.push([name, value]);
  }

  const body = ordered.map(([name, value]) => `  ${name} = ${fieldValue(value)}`).join(',\n');
  return `@${entry.entryType}{${entry.key},\n${body}\n}`;
}

export function serializeBibtex(entries: readonly BibEntry[]): string {
  return entries.map(serializeEntry).join('\n\n') + '\n';
}
