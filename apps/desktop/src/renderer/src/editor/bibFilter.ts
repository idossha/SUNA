/**
 * Pure filtering/formatting logic for the insert-citation picker
 * (CitationPicker.tsx). Kept JSX-free so it's directly importable from a
 * plain `.test.ts` file — the repo has no jsdom/React test harness set up.
 */
import type { Author, BibEntry } from '@suna/bib'

function authorName(author: Author): string {
  return author.kind === 'person' ? [author.given, author.family].filter(Boolean).join(' ') : author.literal
}

/** "Family et al. · 2021" (or whatever's available) for the picker's
 *  subtitle line when an entry has no title. */
export function authorSummary(entry: BibEntry): string {
  const first = entry.authors[0]
  const who = first === undefined ? undefined : authorName(first) + (entry.authors.length > 1 ? ' et al.' : '')
  return [who, entry.year].filter((s): s is string => s !== undefined && s.length > 0).join(' · ')
}

function entryMatches(entry: BibEntry, query: string): boolean {
  if (entry.key.toLowerCase().includes(query)) return true
  if (entry.title.toLowerCase().includes(query)) return true
  if (entry.year !== undefined && entry.year.toLowerCase().includes(query)) return true
  return entry.authors.some((a) => authorName(a).toLowerCase().includes(query))
}

/** Case-insensitive substring match over key/title/year/authors — pure so
 *  the picker's filtering is directly testable without mounting anything. */
export function filterBibEntries(entries: readonly BibEntry[], query: string): BibEntry[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return [...entries]
  return entries.filter((entry) => entryMatches(entry, q))
}
