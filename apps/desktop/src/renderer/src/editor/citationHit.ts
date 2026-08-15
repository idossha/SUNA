/**
 * Pure "what citation is at this position" hit test for the editor's
 * right-click context menu (feature-plan-4.md §3, "Open reference PDF").
 *
 * codemirror.ts hit-tests a native `contextmenu` event to a document
 * position with `view.posAtCoords`, slices out that line's text, and calls
 * `citationKeyAtLineOffset(line, offsetWithinLine)` — so the grammar lives
 * here as a plain string→string function with no CodeMirror dependency, and
 * is unit-testable directly.
 *
 * Mirrors the citation grammar editor/livePreview.ts scans the whole
 * document with (bracket clusters `[@a; @b]` and bare `@key` tokens preceded
 * by whitespace or an opening bracket), but line-scoped and click-position
 * aware: a multi-key cluster resolves to whichever key's own token span
 * contains the offset, falling back to the nearest key when the click landed
 * on punctuation/whitespace/semicolons inside the brackets rather than on a
 * key itself. It intentionally does not exclude code/math spans the way
 * livePreview's document-wide scan does — a line-level click hit test has no
 * AST to consult, and a citation-shaped token inside inline code is a rare
 * enough edge case that treating it as a citation is the simpler, harmless
 * choice.
 */

const CLUSTER = /\[@[^\]]*\]/g
const BARE = /@([A-Za-z][\w:.-]+)/g
const KEY_TOKEN = /@([A-Za-z][\w:.-]*)/g
const PRECEDING_OK = /[\s([{]/

/** Cross-reference kinds (`@fig:`, `@tbl:`, `@eq:`, `@sec:`) — not citations,
 *  mirrors CROSSREF_KINDS in livePreview.ts. */
const CROSSREF_KINDS = new Set(['fig', 'tbl', 'eq', 'sec'])

/** True when `key` is shaped like a `@fig:id`-style cross-reference rather
 *  than a bibliography citation. */
function isCrossRefShaped(key: string): boolean {
  const colon = key.indexOf(':')
  if (colon <= 0) return false
  return CROSSREF_KINDS.has(key.slice(0, colon)) && key.length > colon + 1
}

/** Trim trailing sentence punctuation a bare `@key` token swallowed
 *  (`@Smith2020.` → `Smith2020`), mirroring livePreview.ts. */
function trimTrailingPunctuation(key: string): string {
  let end = key.length
  while (end > 0 && /[.:-]/.test(key.charAt(end - 1))) end -= 1
  return key.slice(0, end)
}

/**
 * The key of whichever `@key` token inside a `[@a; @b]` cluster the offset
 * hits, or — when it lands on punctuation/whitespace between tokens instead
 * — the key closest to it; null when the cluster holds no citation keys at
 * all (e.g. `[@fig:spectrum]`, entirely cross-reference-shaped).
 * `clusterStart`/`offset` are both offsets into the *line*, matching
 * `cluster`'s own position within it.
 */
function bestKeyInCluster(cluster: string, clusterStart: number, offset: number): string | null {
  let exactKey: string | null = null
  let bestKey: string | null = null
  let bestDistance = Infinity

  KEY_TOKEN.lastIndex = 0
  let match = KEY_TOKEN.exec(cluster)
  while (match !== null) {
    const key = match[1]
    if (key !== undefined && !isCrossRefShaped(key)) {
      const from = clusterStart + match.index
      const to = from + match[0].length
      if (exactKey === null && offset >= from && offset <= to) exactKey = key
      const distance = offset < from ? from - offset : offset > to ? offset - to : 0
      if (distance < bestDistance) {
        bestDistance = distance
        bestKey = key
      }
    }
    match = KEY_TOKEN.exec(cluster)
  }
  return exactKey ?? bestKey
}

/**
 * The citation key at `offset` in `line`, or null when the offset falls
 * outside every citation on the line (including cross-reference-shaped
 * tokens like `@fig:spectrum`, which this treats as "not a citation").
 */
export function citationKeyAtLineOffset(line: string, offset: number): string | null {
  CLUSTER.lastIndex = 0
  let match = CLUSTER.exec(line)
  while (match !== null) {
    const start = match.index
    const end = start + match[0].length
    if (offset >= start && offset <= end) return bestKeyInCluster(match[0], start, offset)
    match = CLUSTER.exec(line)
  }

  BARE.lastIndex = 0
  match = BARE.exec(line)
  while (match !== null) {
    const start = match.index
    const precedingOk = start === 0 || PRECEDING_OK.test(line.charAt(start - 1))
    const raw = match[1]
    if (precedingOk && raw !== undefined) {
      const key = trimTrailingPunctuation(raw)
      const end = start + 1 + key.length
      if (key.length >= 2 && !isCrossRefShaped(key) && offset >= start && offset <= end) return key
    }
    match = BARE.exec(line)
  }
  return null
}
