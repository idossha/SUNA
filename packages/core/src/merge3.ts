/**
 * Three-way text merge — feature-plan-11 §11c, the piece that turns "an agent
 * wrote while you were typing" from a blocking prompt into a non-event.
 *
 * The situation it exists for: a document session holds unsaved edits (ours)
 * when the file changes underneath it (theirs), and the last content both
 * sides agreed on is still known (base). Until now that combination raised an
 * all-or-nothing banner — "reload from disk" threw away everything the human
 * had typed, "keep my version" threw away everything the agent had written.
 * Almost always neither is necessary, because the agent edits the section it
 * was pointed at while the human types somewhere else.
 *
 * The policy, and it is deliberate: **ours never loses.** Text the human has
 * typed is live, on screen, and may be mid-thought; it is never yanked out
 * from under them by a merge. Theirs applies wherever it does not clash. A
 * span both sides changed keeps ours and is reported as a conflict carrying
 * both versions, so a caller can offer the choice instead of guessing.
 *
 * TWO GRAINS, deliberately different:
 *
 *  - changes are APPLIED at word resolution, so a clean merge is precise and
 *    disturbs nothing around it;
 *  - conflicts are DETECTED at paragraph resolution — if both sides touched
 *    the same block, that block is a conflict even when their edits fall on
 *    different words.
 *
 * The second rule exists because word-grain conflict detection quietly
 * invents prose. A human rewriting "outside-in" to "inside-out" and an agent
 * rewriting it to "from the outside in" touch no common word — the human
 * replaced two word tokens, the agent inserted three and changed a hyphen —
 * so a word-grain merge accepts both and produces "from the inside out",
 * which neither party wrote and neither would endorse. In a manuscript that
 * is far worse than an extra prompt: text nobody authored cannot be caught by
 * reading a diff of what you did write.
 *
 * Paragraphs are the natural unit here. They are what Markdown already
 * defines (a blank line), they are unambiguous to compute — unlike sentences,
 * which fracture on "6563.3", "[@gunn1972]" and inline math — and they match
 * the case the feature is actually for: the agent edits the section it was
 * pointed at while the human types somewhere else.
 */

import { diffSpans, type DiffSpan } from './word-diff';

/** One span both sides changed. Ranges are offsets into `merged`. */
export interface Merge3Conflict {
  from: number;
  to: number;
  /** What the merge kept — our text for that span. */
  ours: string;
  /** What the other side wanted there, and the merge did not apply. */
  theirs: string;
}

export interface Merge3Result {
  merged: string;
  /** Empty when the merge was clean, which is the common case. */
  conflicts: Merge3Conflict[];
}

/**
 * Two zero-width insertions at the same offset do not overlap by range, but
 * their order is genuinely ambiguous, so grouping treats a zero-width span as
 * occupying a sliver. Any positive width dominates it.
 */
function spanEnd(range: { from: number; to: number }): number {
  return range.to === range.from ? range.to + 0.5 : range.to;
}

function sameSpan(a: DiffSpan, b: DiffSpan): boolean {
  return a.from === b.from && a.to === b.to && a.insert === b.insert;
}

/** Apply spans (sorted, disjoint, base coordinates) to a slice of base. */
function applyWithin(base: string, from: number, to: number, spans: readonly DiffSpan[]): string {
  let out = '';
  let cursor = from;
  for (const span of spans) {
    out += base.slice(cursor, span.from) + span.insert;
    cursor = span.to;
  }
  return out + base.slice(cursor, to);
}

interface Block {
  from: number;
  to: number;
}

/**
 * Blank-line-separated blocks, tiling [0, len). A blank line closes the block
 * it ends, so the separator travels with the paragraph above it.
 */
function blockRanges(text: string): Block[] {
  const out: Block[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? text.length : nl + 1;
    if (text.slice(i, nl === -1 ? text.length : nl).trim() === '') {
      out.push({ from: start, to: lineEnd });
      start = lineEnd;
    }
    i = lineEnd;
  }
  if (start < text.length || out.length === 0) out.push({ from: start, to: text.length });
  return out;
}

/** The block span used for CONFLICT DETECTION: every block the edit touches. */
function coarsen(span: DiffSpan, blocks: readonly Block[]): Block {
  let from = span.from;
  let to = Math.max(span.to, span.from);
  for (const block of blocks) {
    if (block.to > span.from && block.from <= span.from) from = Math.min(from, block.from);
    // a zero-width insert still belongs to the block it sits in
    if (block.from < Math.max(span.to, span.from + 1) && block.to >= span.to) {
      to = Math.max(to, block.to);
    }
  }
  return { from, to };
}

interface Item {
  span: DiffSpan;
  /** The paragraph(s) this edit lands in — what grouping compares. */
  coarse: Block;
  mine: boolean;
}

/**
 * Merge `ours` and `theirs`, both derived from `base`.
 *
 * Clean merges return `conflicts: []` — a caller should treat that as "nothing
 * to tell the user about". A non-empty list means the merge kept our text in
 * those ranges and the caller decides what to offer.
 */
export function merge3(base: string, ours: string, theirs: string): Merge3Result {
  if (ours === theirs) return { merged: ours, conflicts: [] };
  if (theirs === base) return { merged: ours, conflicts: [] };
  if (ours === base) return { merged: theirs, conflicts: [] };

  const oursSpans = diffSpans(base, ours);
  // An edit both sides made identically is one edit, not a conflict — it is
  // already carried by ours, so theirs must not apply it a second time.
  const theirsSpans = diffSpans(base, theirs).filter(
    (t) => !oursSpans.some((o) => sameSpan(o, t)),
  );

  const blocks = blockRanges(base);
  const items: Item[] = [
    ...oursSpans.map((span) => ({ span, coarse: coarsen(span, blocks), mine: true })),
    ...theirsSpans.map((span) => ({ span, coarse: coarsen(span, blocks), mine: false })),
  ].sort((a, b) => a.coarse.from - b.coarse.from || a.coarse.to - b.coarse.to);

  const applied: DiffSpan[] = [];
  const clusters: { from: number; to: number; ours: string; theirs: string }[] = [];

  let i = 0;
  while (i < items.length) {
    // Grow a group of spans that transitively overlap, so ours→theirs→ours
    // chains are resolved as one region rather than piecemeal.
    let end = spanEnd(items[i]!.coarse);
    let j = i + 1;
    while (j < items.length && items[j]!.coarse.from < end) {
      end = Math.max(end, spanEnd(items[j]!.coarse));
      j += 1;
    }
    const group = items.slice(i, j);
    const mine = group.filter((it) => it.mine).map((it) => it.span);
    const other = group.filter((it) => !it.mine).map((it) => it.span);

    if (mine.length === 0 || other.length === 0) {
      // Only one side touched these paragraphs: apply its edits at word
      // resolution, exactly as they were made.
      for (const it of group) applied.push(it.span);
    } else {
      // Both sides were in here. Keep our whole version of the block and hand
      // the caller theirs — never a word-by-word interleaving of the two.
      const from = Math.min(...group.map((it) => it.coarse.from));
      const to = Math.max(...group.map((it) => it.coarse.to));
      const oursText = applyWithin(base, from, to, mine);
      applied.push({ from, to, insert: oursText });
      clusters.push({ from, to, ours: oursText, theirs: applyWithin(base, from, to, other) });
    }
    i = j;
  }

  let merged = '';
  let cursor = 0;
  // Base offset -> merged offset, kept as two maps because a zero-width span
  // has the same base offset for its start and its end while its merged start
  // and end differ by the whole inserted text.
  const mergedStart = new Map<number, number>();
  const mergedEnd = new Map<number, number>();
  for (const span of applied) {
    merged += base.slice(cursor, span.from);
    mergedStart.set(span.from, merged.length);
    merged += span.insert;
    mergedEnd.set(span.to, merged.length);
    cursor = span.to;
  }
  merged += base.slice(cursor);

  const conflicts = clusters.map((c) => ({
    from: mergedStart.get(c.from) ?? c.from,
    to: mergedEnd.get(c.to) ?? c.to,
    ours: c.ours,
    theirs: c.theirs,
  }));
  return { merged, conflicts };
}
