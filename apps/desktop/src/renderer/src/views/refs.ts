import type {
  CitationRules,
  LibraryAcquireOutcome,
  LitResult,
  PdfEvidenceId,
  PdfMatch
} from '@suna/core'
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

/** One wording for the acquisition ladder wherever it appears. The Library
 *  list and the Search results run the same `library:acquire-pdf` call, so
 *  they say the same thing about it — label, busy label, hint and the badge
 *  that means "the file is in the project now". */
export const FIND_PDF_LABEL = 'Find PDF'
export const FIND_PDF_BUSY_LABEL = 'Finding\u2026'
export const FIND_PDF_HINT =
  "Look for this paper's PDF: the project, then the library folders in Settings, then open access"
export const PDF_BADGE_LABEL = 'PDF'

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

/* --------------------------------------------------------------------------
   "Find PDF" (feature-plan-10 §Layer 5) — the pure half of the References
   view's acquisition action: turning a bibliography row into the LitResult
   the library channels take, and turning what came back into one honest
   sentence for the status bar. Main owns the ladder itself; this file owns
   what the user is told about it, which is the part worth unit-testing.
   -------------------------------------------------------------------------- */

/** Trimmed, or null when the field is absent or blank — a LitResult states
 *  every unknown field as null, never as an empty string. */
function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** LitResult carries already-joined display names ("Given Family"); a
 *  BibEntry carries parsed authors. Blank names are dropped rather than sent:
 *  LitResultSchema wants a non-empty string, and an empty author teaches the
 *  scanner's `filename-author-year` rule nothing anyway. */
function displayAuthors(entry: BibEntry): string[] {
  return entry.authors
    .map((author) =>
      author.kind === 'person' ? `${author.given ?? ''} ${author.family}`.trim() : author.literal.trim()
    )
    .filter((name) => name !== '')
}

/** The four-digit year a LitResult wants. `1972a` — a disambiguated BibTeX
 *  year — yields 1972; "in press" yields null rather than a number that is
 *  not one. */
function litYear(entry: BibEntry): number | null {
  const match = /^\d{4}/.exec(entry.year?.trim() ?? '')
  return match === null ? null : Number(match[0])
}

/** A synthesized result, or the reason the row could not be identified. Never
 *  both, and never a silent null: the view has to be able to say why. */
export interface EntryLitResult {
  /** Null exactly when `error` is non-null. */
  result: LitResult | null
  error: string | null
}

/**
 * A bibliography row as 'library:find-pdf' / 'library:acquire-pdf' want it.
 * Both channels take a full LitResult because everything downstream reads
 * one — the filename and byte rules in @suna/bib's `pdf-match.ts`, the URL
 * rungs in `pdf-fetch.ts` — so a reference that only ever existed in
 * references.bib has to be turned into one here.
 *
 * `source` and `id` are load-bearing rather than cosmetic. `pdf-match.ts`
 * reads `id` as an arXiv eprint only when `source` is 'arxiv', and that one
 * pair decides both the `filename-arxiv-id` evidence rule and whether the
 * arxiv.org download rung is tried at all; everything else is 'crossref' plus
 * the DOI, which is what the DOI byte and filename rules read.
 *
 * A title is required, not defaulted: with no title the byte and filename
 * title rules have nothing to compare against, and substituting the cite key
 * would manufacture title-word "evidence" out of a name the author invented —
 * exactly the guess this feature exists to avoid.
 */
export function litResultForEntry(entry: BibEntry): EntryLitResult {
  const key = entry.key.trim()
  const named = key === '' ? 'this reference' : key
  const title = entry.title.trim()
  if (title === '') {
    return {
      result: null,
      error: `${named} has no title in references.bib, and a title is what a PDF is matched against`
    }
  }

  const arxivId = trimmedOrNull(entry.arxivId)
  const doi = trimmedOrNull(entry.doi)
  const id = arxivId ?? doi ?? (key === '' ? null : key)
  if (id === null) {
    return {
      result: null,
      error: `${named} has no DOI, arXiv id or cite key to identify it by`
    }
  }

  return {
    result: {
      source: arxivId !== null ? 'arxiv' : 'crossref',
      id,
      doi,
      title,
      authors: displayAuthors(entry),
      year: litYear(entry),
      venue: trimmedOrNull(entry.journal) ?? trimmedOrNull(entry.booktitle),
      // Unknown from a bib entry, and stated as unknown: `citedByCount` only
      // ever breaks ranking ties, and the abstract is not matched against.
      citedByCount: null,
      openAccessUrl: trimmedOrNull(entry.url),
      abstract: null
    },
    error: null
  }
}

/** Why a file on disk was believed to be a given paper, in words — the
 *  vocabulary of @suna/core's PDF_EVIDENCE_IDS, said out loud. A `low` match
 *  is offered to the user rather than copied, so its reason has to be
 *  legible: "the filename matches title words" is something a user can judge,
 *  `filename-title-words` is not. */
const EVIDENCE_LABELS: Record<PdfEvidenceId, string> = {
  'doi-in-bytes': 'the DOI is inside the file',
  'arxiv-id-in-bytes': 'the arXiv id is inside the file',
  'title-in-bytes': 'the title is inside the file',
  'filename-doi': 'the DOI is in the filename',
  'filename-arxiv-id': 'the arXiv id is in the filename',
  'filename-author-year': 'the filename matches the author and year',
  'filename-title-words': 'the filename matches words from the title',
  'spotlight-content-hit': 'Spotlight found the text inside it'
}

export function evidenceLabel(id: PdfEvidenceId): string {
  return EVIDENCE_LABELS[id]
}

/** Every reason a match carries, joined. A match always arrives with at least
 *  one (PdfMatchSchema enforces it); the empty case still answers plainly
 *  instead of trailing off into nothing. */
export function describeEvidence(evidence: readonly PdfEvidenceId[]): string {
  if (evidence.length === 0) return 'no stated evidence'
  return evidence.map(evidenceLabel).join(', ')
}

/**
 * A long absolute path, shortened from the left for a one-line status note:
 * `/Users/x/Zotero/storage/AB12/Gunn 1972.pdf` → `…/storage/AB12/Gunn
 * 1972.pdf`. The tail is what identifies the file to its owner, and the head
 * is their home directory, which they already know.
 */
export function shortenPath(path: string, keep = 3): string {
  const parts = path.split('/').filter((part) => part !== '')
  if (parts.length <= keep) return path
  return `…/${parts.slice(-keep).join('/')}`
}

/** The host a download came from ("arxiv.org"), or the source verbatim when
 *  it is not a URL — never an invented name for it. */
export function sourceHost(source: string | null): string {
  if (source === null) return 'an unnamed source'
  try {
    const host = new URL(source).host
    return host === '' ? source : host.replace(/^www\./, '')
  } catch {
    return source
  }
}

/**
 * `metadata-only` with candidates is NOT "no PDF found": files matched, and
 * every one of them was `low` — filename title-words alone, which main
 * deliberately refuses to copy. Naming the closest one hands that judgement
 * to the user, who can attach it by hand if it is in fact the paper.
 */
function metadataOnlyNote(citekey: string, matches: readonly PdfMatch[]): string {
  const best = matches[0]
  if (best === undefined) {
    return `No PDF found for ${citekey} in the project, on this machine, or online — cited from its metadata`
  }
  const others = matches.length - 1
  const rest = others === 0 ? '' : `, and ${others} other${others === 1 ? '' : 's'}`
  return `No PDF copied for ${citekey} — cited from its metadata. Closest local file: ${shortenPath(best.path)} (${describeEvidence(best.evidence)})${rest} — too weak to copy without guessing`
}

/**
 * One sentence naming which rung of the ladder produced the answer, for the
 * status bar. The four outcomes stay distinguishable in the wording, because
 * "we already had it", "it was on your disk", "we fetched it" and "there is
 * no PDF anywhere" are four different facts about the manuscript.
 *
 * `acquisition === null` pairs with a non-null `error` by contract (nothing
 * was attempted); the last branch is the backstop for a main process that
 * ever broke that pairing, and says so rather than claiming an outcome.
 */
export function acquireNote(citekey: string, outcome: LibraryAcquireOutcome): string {
  if (outcome.error !== null) return `Could not find a PDF for ${citekey}: ${outcome.error}`
  const filed = outcome.relativePath ?? `references/${citekey}.pdf`
  switch (outcome.acquisition) {
    case 'already-present':
      return `${citekey} already had ${filed} — nothing was searched or fetched`
    case 'copied-local':
      return `Copied ${filed} from ${shortenPath(outcome.source ?? 'this machine')}`
    case 'downloaded':
      return `Downloaded ${filed} from ${sourceHost(outcome.source)}`
    case 'metadata-only':
      return metadataOnlyNote(citekey, outcome.matches)
    case null:
      return `Could not find a PDF for ${citekey}: the search reported no outcome and no reason`
  }
}

export const REMOVE_LABEL = 'Remove'
export const REMOVE_CONFIRM_LABEL = 'Remove?'
export const REMOVE_BUSY_LABEL = 'Removing…'
export const REMOVE_HINT =
  'Remove this reference from references.bib, and delete its PDF from references/'

/**
 * The PDF file "Remove" may delete for an entry, or null when there is
 * nothing to delete.
 *
 * Deliberately narrow: only a file INSIDE the project's own `references/`
 * directory. A `file` field can point at a Zotero storage path or anywhere
 * else on disk (resolvePdfPath returns those untouched), and removing a
 * citation from this manuscript is no reason at all to delete the user's
 * copy of the paper outside it.
 */
export function removablePdfPath(
  resolution: PdfResolution | null | undefined,
  rootDir: string
): string | null {
  if (resolution === undefined || resolution === null) return null
  const prefix = `${rootDir.replace(/\/+$/, '')}/references/`
  return resolution.path.startsWith(prefix) ? resolution.path : null
}

/** Status-bar wording for a finished removal — always says what happened to
 *  the PDF, since "removed" alone leaves the user guessing. */
export function removeNote(citekey: string, deletedPdf: boolean): string {
  return deletedPdf
    ? `Removed ${citekey} from references.bib and deleted its PDF`
    : `Removed ${citekey} from references.bib`
}
