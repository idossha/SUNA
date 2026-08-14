import type { CitationRules } from '@suna/core'
import type { BibEntry, CitationStyleConfig } from '@suna/bib'

/**
 * Translate a profile's author-truncation rules into the single `maxAuthors`
 * knob @suna/bib understands: keep every author until the list exceeds
 * `truncateWhenMoreThan`, then keep `keepFirstN` + "et al.".
 */
export function maxAuthorsFor(rules: CitationRules['referenceList']['authorTruncation'], authorCount: number): number {
  const floor = Math.max(authorCount, 1)
  if (rules.etAlAllowed === false) return floor
  const threshold = rules.truncateWhenMoreThan
  if (threshold === null || authorCount <= threshold) return floor
  return rules.keepFirstN ?? threshold
}

/** The in-text citation style a profile prescribes. */
export function citeStyleOf(rules: CitationRules): CitationStyleConfig {
  return {
    mode: rules.mode,
    collapseRanges: rules.collapseRanges,
    textualTokens: rules.textualTokens
  }
}

export function firstAuthorOf(entry: BibEntry): string {
  const first = entry.authors[0]
  if (first === undefined) return '—'
  return first.kind === 'person' ? first.family : first.literal
}

/** Case-insensitive match on key, title, year, and author names. */
export function entryMatches(entry: BibEntry, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  if (needle === '') return true
  const haystack = [
    entry.key,
    entry.title,
    entry.year ?? '',
    entry.journal ?? '',
    ...entry.authors.map((a) => (a.kind === 'person' ? `${a.given ?? ''} ${a.family}` : a.literal))
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}
