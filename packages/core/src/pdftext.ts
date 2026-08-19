/**
 * One page of a PDF, flattened to a string that a text-quote anchor can be
 * built against and re-located in (ADR-008).
 *
 * This module is the pivot of PDF reading notes: the anchor builder and the
 * renderer's offset -> geometry mapping BOTH call `buildPageText`, so they
 * agree by construction rather than by luck. It has zero runtime imports and
 * takes plain `{str, hasEOL}` objects rather than pdf.js types, so it is
 * unit-testable from fixture arrays and importable by both hosts.
 *
 * ## The join rule is pdf.js's, not ours
 *
 * pdfjs-dist's own find controller builds the string it searches by
 * concatenating `item.str` and pushing `"\n"` after an item with `hasEOL`
 * (web/pdf_viewer.mjs:1183-1190) — it does NOT insert a space between items on
 * the same line, because pdf.js already emits inter-word spacing inside `str`.
 * Adding one there would split every word that kerning happens to break across
 * two items. We follow that rule exactly.
 *
 * Its `normalize()` then rewrites those newlines (web/pdf_viewer.mjs:694-803):
 *
 *   1. `\p{Ll}-\n(?=\p{Ll})` and `\p{Lu}-\n(?=\p{L})` — a word broken across a
 *      line. Drop BOTH the hyphen and the newline: "quench-\ning" -> "quenching".
 *   2. any other `\S-\n` — keep the hyphen, drop the newline, join tight. A
 *      real compound ("cluster-\nscale") keeps its hyphen.
 *   3. a plain `\n` — becomes a single space.
 *
 * We implement those three and stop there. pdf.js also folds diacritics,
 * ligatures and curly quotes, because its output only ever has to MATCH. Ours
 * has to match *and* be publishable: a stored quote is pasted into the
 * manuscript as prose, so folding "é" to "e" would put a misquotation in a
 * paper. That divergence is deliberate.
 *
 * ## Offsets
 *
 * `textDiv.textContent = geom.str` verbatim in pdf.js's TextLayer
 * (build/pdf.mjs `#appendText`), and we never rewrite the interior of an item —
 * only the seam between two. So a character offset inside a DOM text node is
 * the same offset inside that item's slice of `text`, and `within` values can
 * be taken straight from a Range without a translation table.
 */

/** The parts of a pdf.js `TextItem` this module needs. */
export interface PdfTextItemLike {
  str: string;
  hasEOL?: boolean;
}

export interface PageText {
  /** The whole page as one string, joined and de-hyphenated per the rules above. */
  text: string;
  /** `itemStarts[i]` is where item `i` begins in `text`. */
  itemStarts: readonly number[];
  /** `itemEnds[i]` is one past where item `i` ends in `text` (exclusive). */
  itemEnds: readonly number[];
}

/** A maximal span of consecutive item indices, both bounds inclusive. */
export interface ItemRun {
  start: number;
  end: number;
}

const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;
const LETTER = /\p{L}/u;
const WHITESPACE = /\s/u;

/**
 * pdf.js rule 1: is `before-\n` + `after` a word broken across a line break?
 * Lowercase before requires lowercase after; uppercase before accepts any
 * letter (so "X-\nRay" rejoins but "1-\n2" does not).
 */
function isBrokenWord(before: string, after: string): boolean {
  if (before === '' || after === '') return false;
  if (LOWER.test(before)) return LOWER.test(after);
  if (UPPER.test(before)) return LETTER.test(after);
  return false;
}

/**
 * Flatten `items` into one page string, recording where each item landed.
 *
 * Every item gets an entry in `itemStarts`/`itemEnds` — including empty ones,
 * which pdf.js keeps in `textDivs` but never appends to the DOM — so indices
 * here line up 1:1 with `TextLayer.textDivs` and with the array
 * `page.getTextContent()` returned.
 *
 * Consecutive line breaks collapse into one join. pdf.js, working over the
 * fully assembled string, would see `-\n\n` and decline to rejoin the word;
 * doing it here would mean carrying that quirk into published prose for no
 * gain, so a run of EOLs is treated as the single break it visually is.
 */
export function buildPageText(items: readonly PdfTextItemLike[]): PageText {
  let text = '';
  const itemStarts: number[] = [];
  const itemEnds: number[] = [];
  /** Index of the last item that actually contributed characters, or -1. */
  let lastNonEmpty = -1;
  let pendingEol = false;

  for (const item of items) {
    const str = item.str ?? '';

    if (str === '') {
      // Contributes nothing, but must still hold an index. An EOL it carries
      // rides along to the next item that has text.
      itemStarts.push(text.length);
      itemEnds.push(text.length);
      if (item.hasEOL === true) pendingEol = true;
      continue;
    }

    if (pendingEol && text.length > 0) {
      const lastChar = text.charAt(text.length - 1);
      if (lastChar === '-' && text.length >= 2) {
        const beforeDash = text.charAt(text.length - 2);
        if (isBrokenWord(beforeDash, str.charAt(0))) {
          // Rule 1: drop the hyphen and join tight. This shortens the previous
          // item's slice, so its recorded end moves with it.
          text = text.slice(0, -1);
          if (lastNonEmpty >= 0) itemEnds[lastNonEmpty] = text.length;
        } else if (!WHITESPACE.test(beforeDash)) {
          // Rule 2: `\S-\n` keeps the hyphen and joins tight.
        } else {
          // A hyphen standing alone after whitespace is not a word break.
          text += ' ';
        }
      } else {
        // Rule 3.
        text += ' ';
      }
    }
    pendingEol = false;

    itemStarts.push(text.length);
    text += str;
    itemEnds.push(text.length);
    lastNonEmpty = itemStarts.length - 1;

    if (item.hasEOL === true) pendingEol = true;
  }

  return { text, itemStarts, itemEnds };
}

/**
 * Which item owns `offset`, and how far into it the offset sits.
 *
 * Offsets land in the seams too — the space `\n` became belongs to no item —
 * so an offset inside a seam is reported as the END of the item before it,
 * which is what a selection boundary means in practice. Returns null for an
 * offset outside the page or for a page with no items.
 */
export function itemAtOffset(
  page: PageText,
  offset: number,
): { index: number; within: number } | null {
  const { itemStarts, itemEnds } = page;
  if (itemStarts.length === 0) return null;
  if (offset < 0 || offset > page.text.length) return null;

  // Binary search for the last item whose start is <= offset.
  let lo = 0;
  let hi = itemStarts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = itemStarts[mid] ?? 0;
    if (start <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return null;

  // Empty items share a start with their neighbour; walk back to the one that
  // actually holds characters so `within` means something.
  let index = found;
  while (index > 0 && (itemEnds[index] ?? 0) === (itemStarts[index] ?? 0)) index -= 1;

  const start = itemStarts[index] ?? 0;
  const end = itemEnds[index] ?? start;
  return { index, within: Math.min(Math.max(offset - start, 0), end - start) };
}

/**
 * The `[from, to)` slice of `page.text` covered by a selection that begins
 * `startWithin` characters into item `startIndex` and ends `endWithin`
 * characters into item `endIndex`. Bounds are clamped to each item's own
 * slice, and reversed input is normalised, so a backwards drag is not a
 * special case for the caller. Returns null when either index is out of range.
 */
export function offsetsForItemRange(
  page: PageText,
  startIndex: number,
  startWithin: number,
  endIndex: number,
  endWithin: number,
): { from: number; to: number } | null {
  const { itemStarts, itemEnds } = page;
  const n = itemStarts.length;
  if (startIndex < 0 || startIndex >= n || endIndex < 0 || endIndex >= n) return null;

  const at = (index: number, within: number): number => {
    const start = itemStarts[index] ?? 0;
    const end = itemEnds[index] ?? start;
    return Math.min(Math.max(start + within, start), end);
  };

  const a = at(startIndex, startWithin);
  const b = at(endIndex, endWithin);
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/**
 * Group item indices into maximal runs of consecutive indices.
 *
 * This is what keeps a highlight honest. Content order is not visual order in
 * real publisher PDFs — measured over six specimens, 0.5%-4.7% of adjacent
 * body-line pairs have content-order items between them that belong to neither
 * line. A selection stored as one `[from, to)` span would swallow those and
 * quote text the reader never selected, self-consistently enough to re-anchor
 * forever without anyone noticing. One anchor per run is the fix (ADR-008).
 *
 * Input need not be sorted or unique.
 */
export function contiguousRuns(indices: readonly number[]): ItemRun[] {
  if (indices.length === 0) return [];
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const runs: ItemRun[] = [];
  let start = sorted[0] as number;
  let prev = start;
  for (let i = 1; i < sorted.length; i += 1) {
    const value = sorted[i] as number;
    if (value === prev + 1) {
      prev = value;
      continue;
    }
    runs.push({ start, end: prev });
    start = value;
    prev = value;
  }
  runs.push({ start, end: prev });
  return runs;
}

/**
 * `[from, to)` for a whole run of items — the first item's start to the last
 * item's end. Used for every run in a multi-run selection except the two
 * endpoints, which keep their partial offsets.
 */
export function offsetsForRun(page: PageText, run: ItemRun): { from: number; to: number } | null {
  const from = page.itemStarts[run.start];
  const to = page.itemEnds[run.end];
  if (from === undefined || to === undefined) return null;
  return { from, to };
}
