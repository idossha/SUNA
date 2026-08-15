import type { CitationRules } from '@suna/core'
import type { BibEntry, CitationStyleConfig, PdfResolution, PdfResolutionHow } from '@suna/bib'

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

const PDF_HOW_LABEL: Record<PdfResolutionHow, string> = {
  'file-field': 'PDF via BibTeX file field',
  citekey: 'PDF via references/<citekey>.pdf',
  fuzzy: 'PDF via Author_Year* match'
}

/** Tooltip text for the References list's PDF badge (feature-plan-4.md §4). */
export function pdfBadgeTitle(how: PdfResolutionHow): string {
  return PDF_HOW_LABEL[how]
}

/**
 * The path to auto-open beside the list on selecting an entry, or null when
 * the 'references.autoOpenPdf' preference is off or no PDF resolves for it
 * (feature-plan-4.md §4 — "clicking three entries in a row leaves exactly
 * one PDF tab, showing the last" is openViewerInSide's job; this decides
 * *whether* to call it at all).
 */
export function autoOpenPdfPath(
  resolution: PdfResolution | null | undefined,
  autoOpenEnabled: boolean
): string | null {
  if (!autoOpenEnabled) return null
  return resolution?.path ?? null
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
