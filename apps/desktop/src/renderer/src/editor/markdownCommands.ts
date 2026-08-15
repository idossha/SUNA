/**
 * Pure, DOM-free CodeMirror commands for Word/Flux-grade markdown formatting
 * (feature-plan-3.md §1). Every "*Effect" function takes an `EditorState`
 * and returns a `TransactionSpec` (or null for a no-op) — testable directly
 * with `@codemirror/state`, no `EditorView`/DOM required. The thin `Command`
 * wrappers at the bottom just dispatch that spec on a real view.
 *
 * Design note on `toggleWrapEffect` (bold/italic/code/strikethrough):
 * markers are matched as plain substrings, not resolved through the
 * markdown syntax tree, so `*` (italic) and `**` (bold) are ambiguous where
 * they overlap — toggling italic on already-bold text can misinterpret one
 * of the bold delimiters as an italic one. This mirrors the ambiguity
 * CommonMark itself resolves via delimiter-run counting, which a proper
 * parser would need to fully disambiguate; out of scope here.
 */
import {
  ChangeSet,
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type TransactionSpec
} from '@codemirror/state'
import type { Command } from '@codemirror/view'

/** Contiguous run of `\w` characters (letters/digits/underscore). */
const WORD_CHAR = /\w/

/** The `\w` run touching `pos` (extending left across pos, right from pos).
 *  Empty range at `pos` when no word character is adjacent. */
export function wordBoundsAt(state: EditorState, pos: number): { from: number; to: number } {
  const line = state.doc.lineAt(pos)
  const text = line.text
  const local = pos - line.from
  let start = local
  while (start > 0 && WORD_CHAR.test(text.charAt(start - 1))) start -= 1
  let end = local
  while (end < text.length && WORD_CHAR.test(text.charAt(end))) end += 1
  return { from: line.from + start, to: line.from + end }
}

/** Splits [from,to) into one clipped sub-range per line it touches, dropping
 *  the newlines themselves. A collapsed (from===to) range passes through
 *  unchanged — callers handle "no selection" before reaching here. */
function lineSegments(state: EditorState, from: number, to: number): { from: number; to: number }[] {
  if (from === to) return [{ from, to }]
  const segments: { from: number; to: number }[] = []
  let pos = from
  for (;;) {
    const line = state.doc.lineAt(pos)
    const segFrom = Math.max(pos, line.from)
    const segTo = Math.min(to, line.to)
    if (segTo > segFrom) segments.push({ from: segFrom, to: segTo })
    if (line.to >= to) break
    pos = line.to + 1
  }
  return segments.length > 0 ? segments : [{ from, to }]
}

interface MarkerPair {
  /** Offset (line-local) of the opening marker's first character. */
  openFrom: number
  /** Offset (line-local) of the closing marker's first character. */
  closeFrom: number
}

/** Every non-overlapping occurrence of `marker` on the line, paired up
 *  consecutively (1st with 2nd, 3rd with 4th, ...). A trailing unpaired
 *  occurrence (already-malformed markdown) is left out. */
function findMarkerPairs(lineText: string, marker: string): MarkerPair[] {
  const L = marker.length
  const pairs: MarkerPair[] = []
  let pending: number | null = null
  let i = 0
  while (i <= lineText.length - L) {
    if (lineText.slice(i, i + L) === marker) {
      if (pending === null) pending = i
      else {
        pairs.push({ openFrom: pending, closeFrom: i })
        pending = null
      }
      i += L
    } else {
      i += 1
    }
  }
  return pairs
}

interface ScopeResult {
  editFrom: number
  editTo: number
  newSegment: string
  /** New selection edges, local to `newSegment`. */
  newLf: number
  newLt: number
}

/**
 * The single-line toggle core, bounded to `bounds` (the enclosing line) so
 * it never reaches across a newline.
 *
 * Scans the whole line for `marker` pairs. When [from,to) is contained in
 * one pair's span (including or excluding its markers, from anywhere in
 * between — this is what makes "selection already wrapped" and "selection
 * partially overlapping markers" the same case) it UNWRAPS THAT WHOLE PAIR,
 * remapping the selection through the two deletions. Unwrapping the entire
 * enclosing span rather than surgically patching around the selection is
 * what keeps a partial-overlap toggle from ever orphaning a delimiter (e.g.
 * selecting just "bo" out of "**bold**" removes bolding from the whole
 * word, not a local patch that leaves a dangling "**").
 *
 * No enclosing pair -> plain WRAP of exactly [from,to).
 */
function singleScopeToggle(
  text: string,
  from: number,
  to: number,
  marker: string,
  bounds: { from: number; to: number }
): ScopeResult {
  const L = marker.length
  const lineText = text.slice(bounds.from, bounds.to)
  const lf = from - bounds.from
  const lt = to - bounds.from

  const pairs = findMarkerPairs(lineText, marker)
  const enclosing = pairs.find((p) => p.openFrom <= lf && lt <= p.closeFrom + L)

  if (enclosing !== undefined) {
    const { openFrom, closeFrom } = enclosing
    const inner = lineText.slice(openFrom + L, closeFrom)
    // Position mapping after deleting the two marker-length spans
    // [openFrom, openFrom+L) and [closeFrom, closeFrom+L) from lineText.
    const mapped = (pos: number): number => {
      if (pos <= openFrom) return pos
      if (pos <= openFrom + L) return openFrom
      if (pos <= closeFrom) return pos - L
      if (pos <= closeFrom + L) return closeFrom - L
      return pos - 2 * L
    }
    return {
      editFrom: bounds.from + openFrom,
      editTo: bounds.from + closeFrom + L,
      newSegment: inner,
      newLf: mapped(lf) - openFrom,
      newLt: mapped(lt) - openFrom
    }
  }

  const inner = lineText.slice(lf, lt)
  return {
    editFrom: from,
    editTo: to,
    newSegment: marker + inner + marker,
    newLf: L,
    newLt: L + inner.length
  }
}

/**
 * Toggle an inline marker (`**`, `*`, `` ` ``, `~~`) around every selection
 * range. Empty ranges toggle the word touching the cursor (or, if none,
 * drop the cursor between a fresh empty pair). Multi-line ranges are split
 * per line so the marker never spans a newline. Always one transaction.
 * Returns null when there is nothing to do (should not normally happen).
 */
export function toggleWrapEffect(state: EditorState, marker: string): TransactionSpec | null {
  const text = state.doc.toString()
  let changed = false

  const result = state.changeByRange((range: SelectionRange) => {
    const segments = range.empty ? [wordBoundsAt(state, range.from)] : lineSegments(state, range.from, range.to)
    if (segments.length === 0) return { range }

    const scoped = segments.map((seg) => {
      const line = state.doc.lineAt(seg.from)
      return singleScopeToggle(text, seg.from, seg.to, marker, { from: line.from, to: line.to })
    })

    changed = true
    const changes: ChangeSpec[] = scoped.map((r) => ({ from: r.editFrom, to: r.editTo, insert: r.newSegment }))
    const mapping = ChangeSet.of(changes, state.doc.length)
    const first = scoped[0]
    const last = scoped[scoped.length - 1]
    if (first === undefined || last === undefined) return { range }
    const newFrom = mapping.mapPos(first.editFrom) + first.newLf
    const newTo = mapping.mapPos(last.editFrom) + last.newLt

    return { changes, range: EditorSelection.range(newFrom, newTo) }
  })

  if (!changed) return null
  return {
    changes: result.changes,
    selection: result.selection,
    effects: result.effects,
    userEvent: 'input.format',
    scrollIntoView: true
  }
}

/** `toggleWrap('**')` etc. — a ready-to-register CodeMirror Command. */
export function toggleWrap(marker: string): Command {
  return (view) => {
    const spec = toggleWrapEffect(view.state, marker)
    if (spec === null) return false
    view.dispatch(spec)
    return true
  }
}

/**
 * `[text](url)` around every selection range, with the `url` placeholder
 * selected (empty selection -> `[](url)`, same placeholder selected).
 */
export function insertLinkEffect(state: EditorState): TransactionSpec {
  const result = state.changeByRange((range) => {
    const selected = state.doc.sliceString(range.from, range.to)
    const insert = `[${selected}](url)`
    const urlFrom = range.from + 1 + selected.length + 2
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlFrom, urlFrom + 3)
    }
  })
  return {
    changes: result.changes,
    selection: result.selection,
    effects: result.effects,
    userEvent: 'input.format',
    scrollIntoView: true
  }
}

export function insertLink(): Command {
  return (view) => {
    view.dispatch(insertLinkEffect(view.state))
    return true
  }
}

/** `[@key]` at the cursor (replacing any selection) — used by the
 *  insert-citation picker. Pure so the picker's Enter handler is testable. */
export function insertCitationEffect(state: EditorState, key: string): TransactionSpec {
  return { ...state.replaceSelection(`[@${key}]`), userEvent: 'input.complete', scrollIntoView: true }
}

export function insertCitation(key: string): Command {
  return (view) => {
    view.dispatch(insertCitationEffect(view.state, key))
    return true
  }
}
