/**
 * Minimal single-span diff between two texts (the flux PAP-4 mechanic): an
 * external reload dispatched as one LOCAL change lets CodeMirror map the
 * selection, scroll anchor and comment marks through it, instead of a
 * whole-document replace that collapses all three and bloats undo.
 */

export interface DiffSpan {
  from: number
  to: number
  insert: string
}

/** True when `code` is the low half of a surrogate pair. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** True when `code` is the high half of a surrogate pair. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/**
 * The single span turning `oldText` into `newText`, or null when identical.
 * Trims the common prefix and suffix by charCode; the suffix trim stops
 * before it overlaps the prefix (pure insert/delete cases), and both trims
 * back off one unit rather than splitting a surrogate pair.
 */
export function minimalDiff(oldText: string, newText: string): DiffSpan | null {
  if (oldText === newText) return null

  let from = 0
  const maxFrom = Math.min(oldText.length, newText.length)
  while (from < maxFrom && oldText.charCodeAt(from) === newText.charCodeAt(from)) from += 1
  // never split a surrogate pair: a matched prefix ending on a high surrogate
  // means both strings hold the same high half but differing low halves —
  // step back so the span keeps the pair whole
  if (from > 0 && isHighSurrogate(oldText.charCodeAt(from - 1))) from -= 1

  let oldTo = oldText.length
  let newTo = newText.length
  while (
    oldTo > from &&
    newTo > from &&
    oldText.charCodeAt(oldTo - 1) === newText.charCodeAt(newTo - 1)
  ) {
    oldTo -= 1
    newTo -= 1
  }
  if (oldTo < oldText.length && isLowSurrogate(oldText.charCodeAt(oldTo))) {
    oldTo += 1
    newTo += 1
  }

  return { from, to: oldTo, insert: newText.slice(from, newTo) }
}
