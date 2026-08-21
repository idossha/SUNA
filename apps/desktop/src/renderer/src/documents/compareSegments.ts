import { buildQuoteBlock, type DiffOp } from '@suna/core'

/**
 * Turning a section's diff ops into something a browser can paint, and into
 * something a response letter can quote (feature-plan-14 §4, §5).
 *
 * Two jobs, one walk. The ops from `wordDiff` tile both texts exactly, so a
 * single pass produces both the ordered run of spans the view renders and the
 * hunk index each span belongs to — which is what makes "next change" a
 * scroll to `[data-hunk="7"]` rather than a second traversal.
 *
 * Offsets are kept on every segment, in the coordinate space of the text that
 * segment came from. That is what lets a mouse selection over rendered spans
 * be mapped back to an offset range in the manuscript, and therefore what
 * lets "quote this" mark exactly the words that are new.
 */

export interface CompareSegment {
  kind: 'equal' | 'insert' | 'delete'
  text: string
  /** Which reviewable change this belongs to; null on unchanged text. */
  hunk: number | null
  /** Offset in headText for equal/insert, in baseText for delete. */
  from: number
}

export function segmentsFor(
  baseText: string,
  headText: string,
  ops: readonly DiffOp[]
): CompareSegment[] {
  if (ops.length === 0) {
    return headText === '' ? [] : [{ kind: 'equal', text: headText, hunk: null, from: 0 }]
  }
  const out: CompareSegment[] = []
  let hunk = -1
  let inHunk = false
  for (const op of ops) {
    if (op.kind === 'equal') {
      inHunk = false
      out.push({
        kind: 'equal',
        text: headText.slice(op.bFrom, op.bTo),
        hunk: null,
        from: op.bFrom
      })
      continue
    }
    // A removal and the addition replacing it are one change, so the counter
    // advances on entering a run of non-equal ops, not on every op.
    if (!inHunk) {
      hunk += 1
      inHunk = true
    }
    if (op.kind === 'delete') {
      out.push({
        kind: 'delete',
        text: baseText.slice(op.aFrom, op.aTo),
        hunk,
        from: op.aFrom
      })
    } else {
      out.push({
        kind: 'insert',
        text: headText.slice(op.bFrom, op.bTo),
        hunk,
        from: op.bFrom
      })
    }
  }
  return out
}

/** How many reviewable changes a segment list holds. */
export function hunkCount(segments: readonly CompareSegment[]): number {
  let max = -1
  for (const s of segments) if (s.hunk !== null && s.hunk > max) max = s.hunk
  return max + 1
}

/**
 * The paragraph containing `[from, to)` — the unit a response letter quotes.
 *
 * Sentence-level would cut the referent out ("This is because…"), and
 * section-level would paste half a page into a letter. A blank line is the
 * boundary because that is what a paragraph is in Markdown.
 */
export function paragraphAround(text: string, from: number, to: number): { from: number; to: number } {
  const before = text.lastIndexOf('\n\n', Math.max(0, from - 1))
  const start = before === -1 ? 0 : before + 2
  const after = text.indexOf('\n\n', Math.max(from, to))
  const end = after === -1 ? text.length : after
  return { from: start, to: Math.max(end, to) }
}

/**
 * The parts of `[from, to)` that are NEW, in coordinates relative to `from` —
 * exactly what `buildQuoteBlock` marks in red.
 */
export function changeRangesIn(
  segments: readonly CompareSegment[],
  from: number,
  to: number
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (const segment of segments) {
    if (segment.kind !== 'insert') continue
    const start = Math.max(segment.from, from)
    const end = Math.min(segment.from + segment.text.length, to)
    if (end <= start) continue
    out.push({ from: start - from, to: end - from })
  }
  return out
}

/**
 * A ready-to-paste quote block for a range of the CURRENT manuscript, with
 * the words this revision added marked.
 *
 * The current text rather than the old one, always: a response letter quotes
 * what the paper says now and shows in red what changed to get there. The
 * reviewer already has the old version.
 */
export function quoteBlockFor(
  headText: string,
  segments: readonly CompareSegment[],
  from: number,
  to: number
): string {
  const excerpt = headText.slice(from, to)
  return buildQuoteBlock(excerpt, changeRangesIn(segments, from, to))
}

/**
 * Break a section's segments into rows that both columns can share.
 *
 * A two-column diff is only readable if the columns stay level, and the naive
 * version does not: the side with more text pushes everything below it down,
 * so by the third paragraph the reader is comparing unrelated sentences.
 *
 * The fix needs no second alignment pass, because the diff already contains
 * the synchronisation points. Text inside an `equal` segment is, by
 * definition, in BOTH versions — so a paragraph break inside one is a place
 * where the two sides are provably at the same point in the document. Cut
 * there, put each cut in its own grid row, and every row starts level on both
 * sides no matter how much either one gained or lost inside it.
 */
export interface CompareRow {
  segments: CompareSegment[]
}

export function splitRows(segments: readonly CompareSegment[]): CompareRow[] {
  const rows: CompareRow[] = []
  let current: CompareSegment[] = []
  for (const segment of segments) {
    if (segment.kind !== 'equal') {
      current.push(segment)
      continue
    }
    // Every paragraph break inside this shared run closes a row.
    let rest = segment
    for (;;) {
      const at = rest.text.indexOf('\n\n')
      if (at === -1) break
      const cut = at + 2
      current.push({ ...rest, text: rest.text.slice(0, cut) })
      rows.push({ segments: current })
      current = []
      rest = { ...rest, text: rest.text.slice(cut), from: rest.from + cut }
    }
    if (rest.text !== '') current.push(rest)
  }
  if (current.length > 0) rows.push({ segments: current })
  return rows
}

/**
 * Group the segments a single change is made of.
 *
 * A replacement arrives as a delete followed by an insert, and a long one
 * arrives as several of each. Painted per segment, one change becomes three
 * separate outlined boxes and reads as three changes; grouped, it is what it
 * is — one thing that happened, with one quote button on it.
 */
export type CompareGroup =
  | { kind: 'equal'; segment: CompareSegment }
  | { kind: 'hunk'; hunk: number; segments: CompareSegment[] }

export function groupSegments(segments: readonly CompareSegment[]): CompareGroup[] {
  const out: CompareGroup[] = []
  for (const segment of segments) {
    if (segment.kind === 'equal' || segment.hunk === null) {
      out.push({ kind: 'equal', segment })
      continue
    }
    const last = out[out.length - 1]
    if (last !== undefined && last.kind === 'hunk' && last.hunk === segment.hunk) {
      last.segments.push(segment)
    } else {
      out.push({ kind: 'hunk', hunk: segment.hunk, segments: [segment] })
    }
  }
  return out
}
