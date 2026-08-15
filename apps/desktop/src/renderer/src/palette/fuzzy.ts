/**
 * Pure fuzzy matcher for the command palette (feature-plan-4 §5): a simple
 * case-insensitive SUBSEQUENCE scorer — every query character must appear in
 * `text` in order, but not contiguously — with bonuses for matches that fall
 * at a path-segment start (right after `/`, `-`, `_`, `.`, or a space) and an
 * extra bonus when a match lands exactly at the start of the LAST segment
 * (a file's basename, or a command's first word), plus a smaller bonus for
 * runs of consecutive characters. Kept JSX-free and DOM-free so it is
 * directly unit-testable (fuzzy.test.ts) — CommandPalette.tsx is the only
 * consumer, but nothing here reaches into React or the project store.
 */

const SEGMENT_BREAKS = new Set(['/', '\\', '-', '_', '.', ' '])

function isSegmentStart(text: string, index: number): boolean {
  if (index === 0) return true
  const prev = text[index - 1]
  return prev !== undefined && SEGMENT_BREAKS.has(prev)
}

/** Index right after the last path separator, or 0 when `text` has none — the file's basename start. */
function basenameStart(text: string): number {
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return slash + 1
}

/**
 * Greedy left-to-right subsequence match of `query` inside `text` (both
 * already lowercased): every query character must appear, in order, but the
 * match need not be contiguous. `null` when `query` is not a subsequence.
 * Scores a run of consecutive characters and a match landing at a
 * segment start (right after `/`, `-`, `_`, `.`, or a space, or at index 0).
 */
function matchSequence(text: string, query: string): number | null {
  let searchFrom = 0
  let previousMatch = -2
  let score = 0
  for (let qi = 0; qi < query.length; qi += 1) {
    const ch = query[qi] as string
    const foundAt = text.indexOf(ch, searchFrom)
    if (foundAt === -1) return null
    let charScore = 1
    if (foundAt === previousMatch + 1) charScore += 3 // consecutive run
    if (isSegmentStart(text, foundAt)) charScore += 5
    score += charScore
    previousMatch = foundAt
    searchFrom = foundAt + 1
  }
  return score
}

const BASENAME_MATCH_BONUS = 15

/** Tie-break toward tighter, shorter matches (a short exact title over a long one that happens to contain the same subsequence). */
function tieBreak(text: string): number {
  return Math.max(0, 40 - text.length) * 0.01
}

/**
 * Score `query` as a subsequence of `text` (both compared case-insensitively).
 * Returns `null` when `query` is not a subsequence of `text` at all — the
 * caller drops non-matches rather than showing every item at score 0. An
 * empty query matches everything at score 0 (used for "show everything"
 * before the user has typed).
 *
 * A path's basename (the text after its last `/`) is tried FIRST and, when
 * the whole query fits there, always wins over a full-path match — greedily
 * matching left-to-right over the full path can otherwise latch onto an
 * early stray letter buried in a directory name (e.g. the "i" in
 * "manuscript/") before ever reaching the file the user is actually typing
 * toward. Only a query that doesn't fit in the basename falls back to
 * scoring across the whole path.
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (query === '') return 0
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const nameStart = basenameStart(lowerText)

  if (nameStart > 0) {
    const basenameOnly = matchSequence(lowerText.slice(nameStart), lowerQuery)
    if (basenameOnly !== null) return basenameOnly + BASENAME_MATCH_BONUS + tieBreak(lowerText)
  }

  const full = matchSequence(lowerText, lowerQuery)
  return full === null ? null : full + tieBreak(lowerText)
}

export interface FuzzyMatch<T> {
  item: T
  score: number
}

/**
 * Score and sort `items` by `fuzzyScore(getText(item), query)`, dropping
 * non-matches (best score first). An empty query returns every item, in its
 * original order, all at score 0 — the palette's "nothing typed yet" list.
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string
): FuzzyMatch<T>[] {
  if (query === '') return items.map((item) => ({ item, score: 0 }))
  const matches: FuzzyMatch<T>[] = []
  for (const item of items) {
    const score = fuzzyScore(getText(item), query)
    if (score !== null) matches.push({ item, score })
  }
  matches.sort((a, b) => b.score - a.score)
  return matches
}
