import type { LitResult } from '@suna/core';
import { detectArxivId, type Author, type BibEntry } from './model.js';

/**
 * Turn a normalized literature-search hit into a citable BibEntry, and
 * generate a deduped BibTeX key for it. Two separate functions (per spec):
 * `litResultToBibEntry` always fills in some starting key via
 * `generateCiteKey(result, [])`; callers that care about collisions with an
 * existing bibliography call `generateCiteKey` again with the real key set
 * and overwrite `entry.key` before serializing — `references.bib` gains a
 * schema-valid entry, `serializeBibtex`/`parseBibtex` round-trip it.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'on',
  'in',
  'for',
  'and',
  'to',
  'with',
  'from',
  'at',
  'by',
  'is',
  'as',
]);

/** Strip diacritics and anything outside [a-z0-9] so keys stay BibTeX-safe. */
function asciiFold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** LitResult authors are already-joined display names ("Given Family"). */
function familyNameOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? displayName.trim();
}

function splitAuthorName(displayName: string): Author {
  const parts = displayName.trim().split(/\s+/).filter((part) => part !== '');
  const family = parts[parts.length - 1];
  if (family === undefined) return { kind: 'person', family: displayName.trim() };
  if (parts.length === 1) return { kind: 'person', family };
  return { kind: 'person', family, given: parts.slice(0, -1).join(' ') };
}

function firstSignificantWord(title: string): string {
  for (const word of title.split(/\s+/)) {
    const slug = asciiFold(word);
    if (slug !== '' && !STOPWORDS.has(slug)) return slug;
  }
  return 'untitled';
}

function dedupe(base: string, existingKeys: readonly string[]): string {
  const used = new Set(existingKeys);
  if (!used.has(base)) return base;
  for (let i = 0; i < 26; i += 1) {
    const candidate = `${base}${String.fromCharCode(97 + i)}`;
    if (!used.has(candidate)) return candidate;
  }
  let n = 27;
  while (used.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

/**
 * `firstauthorYEARfirstsignificantword`, deduped against `existingKeys` with
 * a/b/c… suffixes (falling back to numeric suffixes past 26 collisions).
 * Missing author -> "anon"; missing year -> "nd"; non-ASCII names are folded
 * to plain ASCII so the key stays a legal BibTeX identifier.
 */
export function generateCiteKey(
  result: Pick<LitResult, 'authors' | 'year' | 'title'>,
  existingKeys: readonly string[],
): string {
  const firstAuthor = result.authors[0];
  const authorSlug =
    firstAuthor === undefined ? 'anon' : asciiFold(familyNameOf(firstAuthor)) || 'anon';
  const yearSlug = result.year !== null ? String(result.year) : 'nd';
  const wordSlug = firstSignificantWord(result.title);
  return dedupe(`${authorSlug}${yearSlug}${wordSlug}`, existingKeys);
}

function stripArxivPrefix(id: string): string {
  return id.startsWith('arXiv:') ? id.slice('arXiv:'.length) : id;
}

/** Convert a normalized literature hit into a citable BibEntry. */
export function litResultToBibEntry(result: LitResult): BibEntry {
  const authors = result.authors.map(splitAuthorName);
  const arxivId = detectArxivId({
    eprint: result.source === 'arxiv' ? stripArxivPrefix(result.id) : undefined,
    url: result.openAccessUrl ?? undefined,
    doi: result.doi ?? undefined,
  });
  const isPreprint = arxivId !== undefined && (result.venue === null || result.venue === 'arXiv');

  const raw: Record<string, string> = {};
  if (result.abstract !== null) raw['abstract'] = result.abstract;
  if (arxivId !== undefined) raw['archiveprefix'] = 'arXiv';

  const entry: BibEntry = {
    key: generateCiteKey(result, []),
    entryType: isPreprint ? 'misc' : 'article',
    title: result.title,
    authors,
    raw,
  };
  if (result.year !== null) entry.year = String(result.year);
  if (!isPreprint && result.venue !== null) entry.journal = result.venue;
  if (result.doi !== null) entry.doi = result.doi;
  if (result.openAccessUrl !== null) entry.url = result.openAccessUrl;
  if (arxivId !== undefined) entry.arxivId = arxivId;
  return entry;
}
