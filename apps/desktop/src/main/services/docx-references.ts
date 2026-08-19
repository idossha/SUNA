/**
 * Reference-list detection/parsing and in-text citation rewriting
 * (feature-plan-6 §2.4) — the one step the spec calls out as the place where
 * a wrong guess corrupts a manuscript: "map it or leave it alone." Every
 * function here is pure over Block[]/Run[] (see docx-html.ts); the orchestrator
 * in docx-import.ts is the only impure caller.
 */

import type { DocxReferenceStyle, DocxWarning } from '@suna/core'
import { generateCiteKey } from '@suna/bib'
import { blockText, runsToPlainText, type Block, type Run } from './docx-html'
import { isCitationRun, type CitationRun } from './docx-heuristics'

/* ------------------------------------------------------------------ */
/* Locating and collecting raw entries                                  */
/* ------------------------------------------------------------------ */

const REFERENCES_HEADING_RE = /^(references?|bibliography|works\s+cited|literature\s+cited)\s*:?\s*$/i

/** First heading whose text matches /references|bibliography|.../i, or null. */
export function findReferencesHeadingIndex(blocks: readonly Block[]): number | null {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block !== undefined && block.kind === 'heading' && REFERENCES_HEADING_RE.test(blockText(block).trim())) {
      return i
    }
  }
  return null
}

export interface RawReferenceEntry {
  raw: string
  /** Position within a genuine `<ol>` list (1-based), when the entries came from one. */
  listNumber: number | null
}

/**
 * Entries after the References heading, up to the next h1/h2 (a genuine new
 * back-matter section like "Acknowledgements") or the end of the document.
 * Prefers a `list` block when there is exactly one (each `<li>` is one
 * entry); otherwise treats every non-blank paragraph as one entry — the
 * common shape for author-year lists, which Word renders as hanging-indent
 * paragraphs rather than a real list.
 */
export function collectRawEntries(
  blocks: readonly Block[],
  headingIndex: number
): { entries: RawReferenceEntry[]; endIndex: number } {
  let end = blocks.length
  for (let i = headingIndex + 1; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block !== undefined && block.kind === 'heading' && (block.level === 1 || block.level === 2)) {
      end = i
      break
    }
  }
  const range = blocks.slice(headingIndex + 1, end)
  const lists = range.filter((b): b is Extract<Block, { kind: 'list' }> => b.kind === 'list')

  if (lists.length > 0) {
    const entries: RawReferenceEntry[] = []
    let n = 0
    for (const list of lists) {
      for (const item of list.items) {
        n += 1
        const raw = runsToPlainText(item).trim()
        if (raw !== '') entries.push({ raw, listNumber: n })
      }
    }
    return { entries, endIndex: end }
  }

  const entries: RawReferenceEntry[] = []
  for (const block of range) {
    if (block.kind !== 'paragraph') continue
    const raw = runsToPlainText(block.runs).trim()
    if (raw !== '') entries.push({ raw, listNumber: null })
  }
  return { entries, endIndex: end }
}

/* ------------------------------------------------------------------ */
/* Per-entry parsing                                                    */
/* ------------------------------------------------------------------ */

export interface ParsedReference {
  raw: string
  style: DocxReferenceStyle
  number: number | null
  /** Family-first ("Tononi, G."), whatever order the source wrote them in. */
  authors: string[]
  year: string | null
  title: string | null
  journal: string | null
  doi: string | null
}

const LEADING_NUMBER_RE = /^\s*(?:\[(\d+)\]|(\d+)[.)])\s+(.*)$/s
const YEAR_RE = /\b(19|20)\d{2}[a-z]?\b/
/** "Smith AB, Jones CD" — family name(s) followed by bare initials, no comma between the two. */
const VANCOUVER_AUTHORS_RE = /^(?:[A-Z][A-Za-z'-]+\s+[A-Z]{1,3}\.?,?\s*)+$/

function splitReferenceAuthors(segment: string, vancouver: boolean): string[] {
  const trimmed = segment.trim()
  if (trimmed === '') return []
  if (vancouver) {
    return trimmed
      .replace(/\.$/, '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
  }
  // Comma-split only where the following text looks like the START of a new
  // "Family, Initial." author (2+ letter family name); a lone trailing
  // initial ("Smith, J.") never matches the lookahead, so it stays attached
  // to its own family name. The final author is additionally split off an
  // "&"/"and" joiner, which leaves a stray comma before it that the trailing
  // strip below removes ("Smith, J., & Jones, K." → "Smith, J." + "Jones, K.").
  return trimmed
    .split(/,\s*(?=[A-Z][A-Za-z'-]+,\s*[A-Z]\.)/)
    .flatMap((p) => p.split(/\s+(?:&|and)\s+/i))
    .map((s) => s.trim().replace(/^,\s*/, '').replace(/,\s*$/, ''))
    .filter((s) => s !== '')
}

function splitTitleAndVenue(rest: string): { title: string | null; journal: string | null } {
  const trimmed = rest.trim().replace(/^[,.;]\s*/, '')
  if (trimmed === '') return { title: null, journal: null }
  const dot = trimmed.indexOf('. ')
  if (dot === -1) {
    const title = trimmed.replace(/\.\s*$/, '').trim()
    return { title: title === '' ? null : title, journal: null }
  }
  const title = trimmed.slice(0, dot).trim()
  const journal = trimmed.slice(dot + 2).trim().replace(/\.\s*$/, '')
  return { title: title === '' ? null : title, journal: journal === '' ? null : journal }
}

const DOI_RE = /\b(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/\S+?)(?:[.,;)\]]\s*$|\s|$)/i

function extractDoi(body: string): string | null {
  const match = DOI_RE.exec(body)
  return match === null ? null : (match[1] as string).replace(/[.,;)\]]+$/, '')
}

/**
 * "G. Tononi" → "Tononi, G." — the family-first form the rest of this module
 * (cite keys, author-year index, BibTeX authors) assumes. An author already
 * written family-first, or one that is a single token or an organization, is
 * returned unchanged: reordering "World Health Organization" would be worse
 * than leaving it alone.
 */
export function normalizeGivenFirstAuthor(author: string): string {
  const trimmed = author.trim().replace(/\s*\bet\s+al\.?$/i, '').trim()
  if (trimmed === '' || trimmed.includes(',')) return trimmed
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return trimmed
  const family = parts[parts.length - 1] as string
  const given = parts.slice(0, -1).join(' ')
  // Given names here are initials or capitalized words; a lowercase particle
  // ("van der Berg") belongs to the family name, so keep those untouched.
  if (!/^[A-Z]/.test(family) || parts.slice(0, -1).some((p) => /^[a-z]/.test(p))) return trimmed
  return `${family}, ${given}`
}

/** Authors of an IEEE-style entry: "G. Tononi, C. Cirelli, and R. Foster". */
function splitGivenFirstAuthors(segment: string): string[] {
  return segment
    .replace(/\s*\bet\s+al\.?\s*$/i, '')
    .split(/,\s*|\s+and\s+|\s*&\s*/i)
    // ", and R. Foster" splits on the comma first, leaving the conjunction
    // attached to the last author's given name.
    .map((a) => normalizeGivenFirstAuthor(a.replace(/^(?:and|&)\s+/i, '')))
    .filter((a) => a !== '')
}

/**
 * The publication year: the last four-digit year in the entry, ignoring the
 * DOI — `10.1016/j.neuron.2013.12.025` ends in digits that read as a year and
 * is almost always the last thing in an IEEE entry, so scanning the raw
 * string dates half a bibliography to the DOI's registration year.
 */
function publicationYear(body: string): string | null {
  const withoutDoi = body.replace(/\b(?:doi:\s*|https?:\/\/)\S+/gi, ' ')
  let year: string | null = null
  for (const m of withoutDoi.matchAll(new RegExp(YEAR_RE.source, 'g'))) year = m[0]
  return year
}

/** A quoted title, straight or curly: "Sleep and the price of plasticity," */
const QUOTED_TITLE_RE = /[\u201c"]([^\u201d"]{4,})[\u201d"]/

/**
 * IEEE/Nature-style entries — the shape Word's own reference manager and most
 * neuroscience journals produce:
 *
 *   G. Tononi and C. Cirelli, "Sleep and the price of plasticity," Neuron,
 *   vol. 81, pp. 12-34, 2014, doi: 10.1016/j.neuron.2013.12.025
 *
 * The quoted title is the anchor: everything before it is the author list,
 * everything after it the venue. Parsing these by the generic
 * "authors end at the first period" rule instead turns "G. Tononi" into an
 * author named "G" and the rest of the citation into a title, which is how a
 * whole bibliography ends up keyed `g2014tononi`.
 */
function parseQuotedTitleEntry(
  raw: string,
  body: string,
  number: number | null
): ParsedReference | null {
  const quoted = QUOTED_TITLE_RE.exec(body)
  if (quoted === null || quoted.index === 0) return null

  const authorsSeg = body.slice(0, quoted.index).replace(/[,;.]\s*$/, '').trim()
  const after = body.slice(quoted.index + quoted[0].length).replace(/^[,.;]\s*/, '')
  const title = (quoted[1] as string).replace(/[,.;]\s*$/, '').trim()
  if (title === '') return null

  const year = publicationYear(body)

  // The venue runs from the end of the title to the first bibliographic
  // detail (volume/issue/pages/year/doi), whichever comes first.
  const venueEnd = after.search(/,?\s*(?:vol\.|no\.|pp?\.|\b(?:19|20)\d{2}\b|doi:)/i)
  const journal = (venueEnd === -1 ? after : after.slice(0, venueEnd)).replace(/[,.;]\s*$/, '').trim()

  return {
    raw,
    style: number !== null ? 'numbered' : 'unknown',
    number,
    authors: splitGivenFirstAuthors(authorsSeg),
    year,
    title,
    journal: journal === '' ? null : journal,
    doi: extractDoi(body)
  }
}

/**
 * Tolerant three-way matcher (numbered / vancouver / author-year), per
 * spec §2.4. Never drops an entry: when the body defies every pattern, the
 * whole thing becomes the title (nothing is lost) and the style is
 * 'unknown' — visible in the review screen rather than silently guessed.
 */
export function parseReferenceEntry(raw: string, listNumber: number | null): ParsedReference {
  const numberMatch = LEADING_NUMBER_RE.exec(raw)
  const explicitNumber = numberMatch !== null ? Number(numberMatch[1] ?? numberMatch[2]) : null
  const body = numberMatch !== null ? (numberMatch[3] as string).trim() : raw
  const number = explicitNumber ?? listNumber
  const isNumberedSource = number !== null

  const quoted = parseQuotedTitleEntry(raw, body, number)
  if (quoted !== null) return quoted

  const yearMatch = YEAR_RE.exec(body)
  if (yearMatch === null) {
    return {
      raw,
      style: 'unknown',
      number,
      authors: [],
      year: null,
      title: body || null,
      journal: null,
      doi: extractDoi(body)
    }
  }

  const year = yearMatch[0]
  const yStart = yearMatch.index
  const parenthesized = body.charAt(yStart - 1) === '('

  let authorsSeg: string
  let rest: string
  if (parenthesized) {
    authorsSeg = body.slice(0, yStart - 1).trim()
    const closeParen = body.indexOf(')', yStart)
    rest = closeParen === -1 ? '' : body.slice(closeParen + 1)
  } else {
    const firstDot = body.indexOf('. ')
    if (firstDot !== -1 && firstDot < yStart) {
      authorsSeg = body.slice(0, firstDot).trim()
      rest = body.slice(firstDot + 2)
    } else {
      authorsSeg = ''
      rest = body
    }
  }

  const vancouver = isNumberedSource && VANCOUVER_AUTHORS_RE.test(authorsSeg)
  const style: DocxReferenceStyle = isNumberedSource
    ? vancouver
      ? 'vancouver'
      : 'numbered'
    : parenthesized
      ? 'author-year'
      : 'unknown'

  const authors = splitReferenceAuthors(authorsSeg, vancouver)
  const { title, journal } = splitTitleAndVenue(rest)
  return { raw, style, number, authors, year, title, journal, doi: extractDoi(body) }
}

/* ------------------------------------------------------------------ */
/* Cite keys                                                            */
/* ------------------------------------------------------------------ */

export interface DocxReferenceDraftLike extends ParsedReference {
  citeKey: string
}

function yearAsNumber(year: string | null): number | null {
  if (year === null) return null
  const n = Number.parseInt(year, 10)
  return Number.isNaN(n) ? null : n
}

/** Our author strings are family-first ("Smith, J." or "Smith AB") — the
 *  opposite order of @suna/bib's LitResult convention ("Given Family"),
 *  whose key generator takes the LAST token as the family name. Reduce to
 *  just the family name so generateCiteKey's family extraction works either
 *  way it's fed. */
function familyOnly(author: string): string {
  const comma = author.indexOf(',')
  if (comma !== -1) return author.slice(0, comma).trim()
  const firstToken = author.trim().split(/\s+/)[0]
  return firstToken !== undefined && firstToken !== '' ? firstToken : author
}

/** Reuses @suna/bib's `firstauthorYEARfirstword` key scheme + a/b/c dedupe. */
export function assignCiteKeys(parsed: readonly ParsedReference[]): DocxReferenceDraftLike[] {
  const keys: string[] = []
  return parsed.map((ref) => {
    const key = generateCiteKey(
      { authors: ref.authors.map(familyOnly), year: yearAsNumber(ref.year), title: ref.title ?? ref.raw },
      keys
    )
    keys.push(key)
    return { ...ref, citeKey: key }
  })
}

/** Detect + parse the whole references section in one call. */
export function extractReferences(blocks: readonly Block[]): {
  headingIndex: number | null
  endIndex: number
  references: DocxReferenceDraftLike[]
} {
  const headingIndex = findReferencesHeadingIndex(blocks)
  if (headingIndex === null) return { headingIndex: null, endIndex: blocks.length, references: [] }
  const { entries, endIndex } = collectRawEntries(blocks, headingIndex)
  const parsed = entries.map((e) => parseReferenceEntry(e.raw, e.listNumber))
  return { headingIndex, endIndex, references: assignCiteKeys(parsed) }
}

/* ------------------------------------------------------------------ */
/* In-text citation rewriting                                           */
/* ------------------------------------------------------------------ */

/** number → citeKeys sharing it (length > 1 means an ambiguous duplicate). */
export function buildNumberIndex(refs: readonly DocxReferenceDraftLike[]): Map<number, string[]> {
  const map = new Map<number, string[]>()
  for (const ref of refs) {
    if (ref.number === null) continue
    const list = map.get(ref.number) ?? []
    list.push(ref.citeKey)
    map.set(ref.number, list)
  }
  return map
}

/** "familylower|year" → citeKeys sharing it. Keyed off the first author only. */
export function buildAuthorYearIndex(refs: readonly DocxReferenceDraftLike[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const ref of refs) {
    const first = ref.authors[0]
    if (first === undefined || ref.year === null) continue
    const family = (first.split(',')[0] ?? first).trim().toLowerCase()
    if (family === '') continue
    const key = `${family}|${ref.year}`
    const list = map.get(key) ?? []
    list.push(ref.citeKey)
    map.set(key, list)
  }
  return map
}

function citationText(keys: readonly string[]): string {
  return `[${keys.map((k) => `@${k}`).join('; ')}]`
}

/** Every distinct number in "3", "3,4", "3-5" (ranges/lists), in order. */
function expandMarkerNumbers(spec: string): number[] {
  const out: number[] = []
  for (const piece of spec.split(',')) {
    const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(piece)
    if (range !== null) {
      const a = Number(range[1])
      const b = Number(range[2])
      for (let n = a; n <= b; n += 1) out.push(n)
      continue
    }
    const single = piece.trim()
    if (single !== '') out.push(Number(single))
  }
  return out
}

/** Every number must map to exactly one citeKey; returns them in order, deduped. */
function resolveNumbers(numbers: readonly number[], byNumber: ReadonlyMap<number, string[]>): string[] | null {
  const keys: string[] = []
  for (const n of numbers) {
    const candidates = byNumber.get(n)
    if (candidates === undefined || candidates.length !== 1) return null
    const key = candidates[0]
    if (key !== undefined && !keys.includes(key)) keys.push(key)
  }
  return keys.length > 0 ? keys : null
}

const BRACKET_MARKER_RE = /\[(\d+(?:\s*[-,]\s*\d+)*)\]/g

function rewriteRunNumericBrackets(
  run: Run,
  byNumber: ReadonlyMap<number, string[]>,
  warnings: DocxWarning[]
): Run[] {
  BRACKET_MARKER_RE.lastIndex = 0
  const text = run.text
  const out: Run[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = BRACKET_MARKER_RE.exec(text)) !== null) {
    const spec = match[1] as string
    const start = match.index
    const end = start + match[0].length
    const numbers = expandMarkerNumbers(spec)
    const keys = resolveNumbers(numbers, byNumber)
    if (keys === null) {
      warnings.push({
        code: 'citation-ambiguous',
        message: `Could not map in-text citation marker "${match[0]}" to exactly one reference each — left as literal text.`,
        context: match[0]
      })
      continue
    }
    if (start > cursor) out.push({ ...run, text: text.slice(cursor, start) })
    const citation: CitationRun = { text: citationText(keys), citation: true }
    out.push(citation)
    cursor = end
  }
  if (cursor === 0) return [run]
  if (cursor < text.length) out.push({ ...run, text: text.slice(cursor) })
  return out
}

function rewriteRunsNumeric(runs: readonly Run[], byNumber: ReadonlyMap<number, string[]>, warnings: DocxWarning[]): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    if (isCitationRun(run)) {
      out.push(run)
      continue
    }
    if (run.sup === true && /^\d+(?:\s*,\s*\d+)*$/.test(run.text.trim())) {
      const numbers = expandMarkerNumbers(run.text.trim())
      const keys = resolveNumbers(numbers, byNumber)
      if (keys !== null) {
        const citation: CitationRun = { text: citationText(keys), citation: true }
        out.push(citation)
        continue
      }
      warnings.push({
        code: 'citation-ambiguous',
        message: `Could not map superscript citation marker "${run.text.trim()}" to exactly one reference each — left as literal text.`,
        context: run.text.trim()
      })
      out.push(run)
      continue
    }
    out.push(...rewriteRunNumericBrackets(run, byNumber, warnings))
  }
  return out
}

const AUTHOR_YEAR_PAREN_RE = /\(([A-Z][A-Za-z'-]+)[^()]*?,?\s+((?:19|20)\d{2}[a-z]?)\)/g

function rewriteRunAuthorYear(run: Run, byAuthorYear: ReadonlyMap<string, string[]>, warnings: DocxWarning[]): Run[] {
  if (isCitationRun(run)) return [run]
  AUTHOR_YEAR_PAREN_RE.lastIndex = 0
  const text = run.text
  const out: Run[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = AUTHOR_YEAR_PAREN_RE.exec(text)) !== null) {
    const family = (match[1] as string).toLowerCase()
    const year = match[2] as string
    const start = match.index
    const end = start + match[0].length
    const candidates = byAuthorYear.get(`${family}|${year}`)
    if (candidates === undefined || candidates.length !== 1) {
      warnings.push({
        code: 'citation-ambiguous',
        message: `Could not map in-text citation "${match[0]}" to exactly one reference — left as literal text.`,
        context: match[0]
      })
      continue
    }
    if (start > cursor) out.push({ ...run, text: text.slice(cursor, start) })
    const key = candidates[0] as string
    const citation: CitationRun = { text: citationText([key]), citation: true }
    out.push(citation)
    cursor = end
  }
  if (cursor === 0) return [run]
  if (cursor < text.length) out.push({ ...run, text: text.slice(cursor) })
  return out
}

function rewriteRunsAuthorYear(runs: readonly Run[], byAuthorYear: ReadonlyMap<string, string[]>, warnings: DocxWarning[]): Run[] {
  const out: Run[] = []
  for (const run of runs) out.push(...rewriteRunAuthorYear(run, byAuthorYear, warnings))
  return out
}

function countCitations(runs: readonly Run[]): { mapped: number; literal: number } {
  let mapped = 0
  for (const run of runs) if (isCitationRun(run)) mapped += 1
  return { mapped, literal: 0 }
}

/**
 * Rewrites in-text citation markers across a block tree, dispatching on
 * whichever style the parsed reference list mostly uses. Unmatched/ambiguous
 * markers are left completely untouched (never guessed) and reported in
 * `warnings`, one per occurrence.
 */
export function rewriteBlocksCitations(
  blocks: readonly Block[],
  refs: readonly DocxReferenceDraftLike[]
): { blocks: Block[]; mappedCount: number; literalCount: number; warnings: DocxWarning[] } {
  const styleCounts = new Map<DocxReferenceStyle, number>()
  for (const ref of refs) styleCounts.set(ref.style, (styleCounts.get(ref.style) ?? 0) + 1)
  const dominant = [...styleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
  const numeric = dominant === 'numbered' || dominant === 'vancouver'
  const authorYear = dominant === 'author-year'

  const byNumber = buildNumberIndex(refs)
  const byAuthorYear = buildAuthorYearIndex(refs)
  const warnings: DocxWarning[] = []

  const rewriteRuns = (runs: readonly Run[]): Run[] => {
    if (numeric) return rewriteRunsNumeric(runs, byNumber, warnings)
    if (authorYear) return rewriteRunsAuthorYear(runs, byAuthorYear, warnings)
    return [...runs]
  }

  const rewriteBlock = (block: Block): Block => {
    switch (block.kind) {
      case 'heading':
        return { ...block, runs: rewriteRuns(block.runs) }
      case 'paragraph':
        return { ...block, runs: rewriteRuns(block.runs) }
      case 'list':
        return { ...block, items: block.items.map((item) => rewriteRuns(item)) }
      case 'table':
        return { ...block, rows: block.rows.map((row) => row.map((cell) => rewriteRuns(cell))) }
      case 'blockquote':
        return { ...block, blocks: block.blocks.map(rewriteBlock) }
      default:
        return block
    }
  }

  const rewritten = blocks.map(rewriteBlock)

  let mappedCount = 0
  let literalCount = 0
  const countBlock = (block: Block): void => {
    const runsList: Run[][] =
      block.kind === 'heading' || block.kind === 'paragraph'
        ? [block.runs]
        : block.kind === 'list'
          ? block.items
          : block.kind === 'table'
            ? block.rows.flat()
            : []
    for (const runs of runsList) {
      const { mapped } = countCitations(runs)
      mappedCount += mapped
    }
    if (block.kind === 'blockquote') block.blocks.forEach(countBlock)
  }
  rewritten.forEach(countBlock)
  literalCount = warnings.length

  return { blocks: rewritten, mappedCount, literalCount, warnings }
}
