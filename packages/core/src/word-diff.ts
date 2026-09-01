/**
 * Word-level structural diff between two texts — the primitive behind both
 * halves of ARCHITECTURE §5.6.
 *
 * Two consumers, one algorithm:
 *  - `diffSpans` replaces state/minimalDiff's single-span answer, so an
 *    external reload (an agent's edit, git, Finder) arrives as SEVERAL small
 *    mapped changes instead of one span covering everything between the first
 *    and last difference. That is what keeps comment anchors, the cursor and
 *    the scroll position alive through a multi-place agent edit.
 *  - `wordDiff` keeps the insert/delete distinction the review UI needs to
 *    paint removals red and additions green at word resolution.
 *
 * Two stages, because one is not enough:
 *  1. LINE alignment over the whole text. Cheap, and it localizes the change
 *     so stage 2 never runs over the whole document.
 *  2. WORD alignment inside each changed region only. A token is a run of
 *     word characters, a run of whitespace, or a single other character —
 *     which is why `hashlib.md5()` → `hashlib.sha256()` marks `md5`/`sha256`
 *     and leaves the call around it alone.
 *
 * Both stages are the same Myers O(ND) greedy alignment (`alignSegments`)
 * over an array of token keys, followed by the same left-slide normalization,
 * so there is one algorithm to get right and one to test.
 *
 * Bounded by construction: neither stage explores past MAX_EDIT_DISTANCE, and
 * stage 2 refuses regions larger than MAX_REGION_TOKENS. Exceeding either
 * degrades to "replace this region wholesale" — coarser, never wrong, never
 * slow. A wholesale replacement is also the honest answer when two texts
 * genuinely share nothing.
 */

/* --------------------------------------------------------------- limits -- */

/**
 * Edit-distance ceiling per alignment. The trace costs sum(2d+1) integers, so
 * 1500 caps a single alignment at ~9 MB and ~O(tokens × 1500) time. Reaching
 * it means the two sides have little in common, where a wholesale replacement
 * is the better answer anyway.
 */
const MAX_EDIT_DISTANCE = 1500;

/**
 * Word-refinement ceiling per changed region. A region this large is many
 * consecutive rewritten lines, where word-level marks would be noise; it is
 * emitted as one delete + insert instead.
 */
const MAX_REGION_TOKENS = 4000;

/* ----------------------------------------------------------------- types -- */

/**
 * One aligned run. Offsets are CHARACTER offsets into the original `a` and
 * `b` strings, so a caller can hand them straight to CodeMirror without a
 * second coordinate space to get wrong.
 *
 * The ops tile both inputs exactly: concatenating the a-side of every
 * `equal` and `delete` reproduces `a`, and the b-side of every `equal` and
 * `insert` reproduces `b`.
 */
export type DiffOp =
  | { kind: 'equal'; aFrom: number; aTo: number; bFrom: number; bTo: number }
  /** `bAt` is where the removed text sat in `b` — the caret for a red widget. */
  | { kind: 'delete'; aFrom: number; aTo: number; bAt: number }
  /** `aAt` is where the added text lands in `a` — the caret for a green mark. */
  | { kind: 'insert'; aAt: number; bFrom: number; bTo: number };

/** A replacement in `a`'s coordinates: exactly CodeMirror's change shape. */
export interface DiffSpan {
  from: number;
  to: number;
  insert: string;
}

/* ------------------------------------------------------------ tokenizing -- */

interface Tokens {
  /** Comparison keys — the exact text of each token, so equal keys mean
   *  equal char lengths and an `equal` run needs no length bookkeeping. */
  keys: string[];
  /** Start offset of each token; `end` closes the last one. */
  starts: number[];
  end: number;
}

/** Lines tile [from, to) exactly; the newline belongs to the line it ends. */
function tokenizeLines(text: string, from: number, to: number): Tokens {
  const keys: string[] = [];
  const starts: number[] = [];
  let start = from;
  for (let i = from; i < to; i += 1) {
    if (text.charCodeAt(i) === 10) {
      starts.push(start);
      keys.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < to) {
    starts.push(start);
    keys.push(text.slice(start, to));
  }
  return { keys, starts, end: to };
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const SPACE_CHAR = /\s/u;

type CharClass = 'word' | 'space' | 'other';

function classify(ch: string): CharClass {
  if (WORD_CHAR.test(ch)) return 'word';
  if (SPACE_CHAR.test(ch)) return 'space';
  return 'other';
}

/**
 * Words tile [from, to) exactly. Runs of word characters and runs of
 * whitespace each collapse to one token; anything else is a token of its own,
 * so punctuation is a boundary rather than part of the word beside it.
 * Iterates by code point, so an astral character is never split.
 */
function tokenizeWords(text: string, from: number, to: number): Tokens {
  const keys: string[] = [];
  const starts: number[] = [];
  let start = from;
  let runClass: CharClass | null = null;
  let i = from;
  while (i < to) {
    const code = text.codePointAt(i);
    const ch = code === undefined ? text.charAt(i) : String.fromCodePoint(code);
    const width = ch.length;
    const cls = classify(ch);
    // 'other' never joins a run: each punctuation mark stands alone.
    const joins = runClass === cls && cls !== 'other';
    if (!joins && i > start) {
      starts.push(start);
      keys.push(text.slice(start, i));
      start = i;
    }
    runClass = cls;
    i += width;
  }
  if (start < to) {
    starts.push(start);
    keys.push(text.slice(start, to));
  }
  return { keys, starts, end: to };
}

/** Char offset where token `i` begins; `i === keys.length` is the region end. */
function charAt(tokens: Tokens, i: number): number {
  const start = tokens.starts[i];
  return start === undefined ? tokens.end : start;
}

/* --------------------------------------------------------------- Myers -- */

const EQ = 0;
const DEL = 1;
const INS = 2;

/**
 * Myers' greedy O(ND) alignment. Returns the edit script as a flat array of
 * EQ/DEL/INS kinds in order — positions are implied (EQ advances both sides,
 * DEL advances `a`, INS advances `b`), which keeps the trace allocation-free
 * per step. Null when the edit distance exceeds MAX_EDIT_DISTANCE.
 */
function myersSteps(a: readonly string[], b: readonly string[]): number[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  // traces[d] is v BEFORE round d, sliced to the diagonals round d can read.
  const traces: Int32Array[] = [];
  const limit = Math.min(max, MAX_EDIT_DISTANCE);
  for (let d = 0; d <= limit; d += 1) {
    traces.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(traces, d, n, m);
    }
  }
  return null;
}

/** Walk the stored traces back from (n, m) to (0, 0), emitting the script. */
function backtrack(traces: readonly Int32Array[], d0: number, n: number, m: number): number[] {
  const reversed: number[] = [];
  let x = n;
  let y = m;
  for (let d = d0; d > 0; d -= 1) {
    const vd = traces[d]!;
    const k = x - y;
    // Same branch as the forward pass, so it re-derives the move that got
    // here; both reads stay inside the slice because k === ±d short-circuits.
    const prevK = k === -d || (k !== d && vd[k - 1 + d]! < vd[k + 1 + d]!) ? k + 1 : k - 1;
    const prevX = vd[prevK + d]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      reversed.push(EQ);
    }
    if (x > prevX) reversed.push(DEL);
    else if (y > prevY) reversed.push(INS);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    reversed.push(EQ);
  }
  reversed.reverse();
  return reversed;
}

/* ------------------------------------------------------------ segments -- */

/** An aligned run in TOKEN index space. `equal` runs have equal lengths. */
interface Seg {
  kind: 'equal' | 'change';
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

function segmentsFrom(steps: readonly number[]): Seg[] {
  const segs: Seg[] = [];
  let ai = 0;
  let bi = 0;
  for (const step of steps) {
    const kind = step === EQ ? 'equal' : 'change';
    let seg = segs[segs.length - 1];
    if (seg === undefined || seg.kind !== kind) {
      seg = { kind, a0: ai, a1: ai, b0: bi, b1: bi };
      segs.push(seg);
    }
    if (step === EQ) {
      ai += 1;
      bi += 1;
      seg.a1 = ai;
      seg.b1 = bi;
    } else if (step === DEL) {
      ai += 1;
      seg.a1 = ai;
    } else {
      bi += 1;
      seg.b1 = bi;
    }
  }
  return segs;
}

/**
 * Slide every change block as far left as it can go.
 *
 * A block [a0,a1) → [b0,b1) may move one token left exactly when the token
 * leaving its right edge matches on both sides (a[a1-1] === b[b1-1]): the
 * prefix stays equal for free, and that check is what keeps the suffix equal.
 *
 * Two payoffs. It removes Myers' arbitrary tie-breaking, so the same pair of
 * texts always produces the same hunks — which is what lets the review UI
 * recompute hunks from the baseline on every render instead of migrating
 * them. And in prose it turns `was highly⎵significant` into
 * `was ⎵highlysignificant`, i.e. the space travels with the inserted word,
 * which is what a reader expects a word-level diff to look like.
 */
function slideLeft(segs: Seg[], a: readonly string[], b: readonly string[]): Seg[] {
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i]!;
    if (seg.kind !== 'change') continue;
    const prev = i > 0 ? segs[i - 1] : undefined;
    if (prev === undefined || prev.kind !== 'equal') continue;
    const room = seg.a0 - prev.a0;
    let shift = 0;
    while (shift < room) {
      const aTok = a[seg.a1 - 1 - shift];
      const bTok = b[seg.b1 - 1 - shift];
      if (aTok === undefined || bTok === undefined || aTok !== bTok) break;
      shift += 1;
    }
    if (shift === 0) continue;
    seg.a0 -= shift;
    seg.a1 -= shift;
    seg.b0 -= shift;
    seg.b1 -= shift;
    prev.a1 -= shift;
    prev.b1 -= shift;
    const next = segs[i + 1];
    if (next !== undefined && next.kind === 'equal') {
      next.a0 -= shift;
      next.b0 -= shift;
    } else {
      segs.splice(i + 1, 0, {
        kind: 'equal',
        a0: seg.a1,
        a1: seg.a1 + shift,
        b0: seg.b1,
        b1: seg.b1 + shift,
      });
      i += 1;
    }
  }
  // A block that slid onto its predecessor can empty it, leaving two change
  // blocks side by side; drop the empties and rejoin.
  const out: Seg[] = [];
  for (const seg of segs) {
    if (seg.a1 === seg.a0 && seg.b1 === seg.b0) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.kind === seg.kind) {
      last.a1 = seg.a1;
      last.b1 = seg.b1;
      continue;
    }
    out.push(seg);
  }
  return out;
}

/** Myers + normalization over any token array. Null when over budget. */
function alignSegments(a: readonly string[], b: readonly string[]): Seg[] | null {
  const steps = myersSteps(a, b);
  if (steps === null) return null;
  return slideLeft(segmentsFrom(steps), a, b);
}

/* ------------------------------------------------------------- assembly -- */

function pushCoarse(
  out: DiffOp[],
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): void {
  if (aTo > aFrom) out.push({ kind: 'delete', aFrom, aTo, bAt: bFrom });
  if (bTo > bFrom) out.push({ kind: 'insert', aAt: aTo, bFrom, bTo });
}

/** Word-align one changed region, or emit it wholesale when it is too big. */
function refineRegion(
  a: string,
  b: string,
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
  out: DiffOp[],
): void {
  if (aFrom === aTo || bFrom === bTo) {
    pushCoarse(out, aFrom, aTo, bFrom, bTo);
    return;
  }
  const at = tokenizeWords(a, aFrom, aTo);
  const bt = tokenizeWords(b, bFrom, bTo);
  if (at.keys.length > MAX_REGION_TOKENS || bt.keys.length > MAX_REGION_TOKENS) {
    pushCoarse(out, aFrom, aTo, bFrom, bTo);
    return;
  }
  const segs = alignSegments(at.keys, bt.keys);
  if (segs === null) {
    pushCoarse(out, aFrom, aTo, bFrom, bTo);
    return;
  }
  for (const seg of segs) {
    const ca0 = charAt(at, seg.a0);
    const ca1 = charAt(at, seg.a1);
    const cb0 = charAt(bt, seg.b0);
    const cb1 = charAt(bt, seg.b1);
    if (seg.kind === 'equal') {
      if (ca1 > ca0) out.push({ kind: 'equal', aFrom: ca0, aTo: ca1, bFrom: cb0, bTo: cb1 });
    } else {
      pushCoarse(out, ca0, ca1, cb0, cb1);
    }
  }
}

/** Merge runs the two stages emitted separately (equal lines either side of
 *  a region, consecutive word-level deletes, …) so hunks come out maximal. */
function coalesce(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last !== undefined) {
      if (last.kind === 'equal' && op.kind === 'equal' && last.aTo === op.aFrom) {
        last.aTo = op.aTo;
        last.bTo = op.bTo;
        continue;
      }
      if (last.kind === 'delete' && op.kind === 'delete' && last.aTo === op.aFrom) {
        last.aTo = op.aTo;
        continue;
      }
      if (last.kind === 'insert' && op.kind === 'insert' && last.bTo === op.bFrom) {
        last.bTo = op.bTo;
        continue;
      }
    }
    out.push(op);
  }
  return out;
}

/* ---------------------------------------------------------------- public -- */

/**
 * Align `a` and `b` at word resolution. The result tiles both strings in
 * order, so it can be walked once to paint decorations or folded into
 * replacement spans (`diffSpans`).
 */
export function wordDiff(a: string, b: string): DiffOp[] {
  if (a === b) {
    return a.length === 0 ? [] : [{ kind: 'equal', aFrom: 0, aTo: a.length, bFrom: 0, bTo: b.length }];
  }
  if (a.length === 0 || b.length === 0) {
    const out: DiffOp[] = [];
    pushCoarse(out, 0, a.length, 0, b.length);
    return out;
  }
  const aLines = tokenizeLines(a, 0, a.length);
  const bLines = tokenizeLines(b, 0, b.length);
  const segs = alignSegments(aLines.keys, bLines.keys);
  const out: DiffOp[] = [];
  if (segs === null) {
    // Nothing worth aligning at line level: one region covering everything.
    refineRegion(a, b, 0, a.length, 0, b.length, out);
    return coalesce(out);
  }
  for (const seg of segs) {
    const ca0 = charAt(aLines, seg.a0);
    const ca1 = charAt(aLines, seg.a1);
    const cb0 = charAt(bLines, seg.b0);
    const cb1 = charAt(bLines, seg.b1);
    if (seg.kind === 'equal') {
      if (ca1 > ca0) out.push({ kind: 'equal', aFrom: ca0, aTo: ca1, bFrom: cb0, bTo: cb1 });
    } else {
      refineRegion(a, b, ca0, ca1, cb0, cb1, out);
    }
  }
  return coalesce(out);
}

/**
 * The changes only, as replacements in `a`'s coordinates — sorted, disjoint,
 * and directly usable as `ChangeSet.of(spans, a.length)`.
 *
 * This is the multi-span successor to state/minimalDiff's single span: where
 * that one returned everything between the first and last difference, this
 * returns one entry per changed run, so an edit in §2 and an edit in §7 no
 * longer delete and reinsert the five sections between them.
 */
export function diffSpans(a: string, b: string): DiffSpan[] {
  const ops = wordDiff(a, b);
  const spans: DiffSpan[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.kind === 'equal') {
      i += 1;
      continue;
    }
    let from = -1;
    let to = -1;
    let bFrom = -1;
    let bTo = -1;
    while (i < ops.length) {
      const run = ops[i]!;
      if (run.kind === 'equal') break;
      if (run.kind === 'delete') {
        if (from < 0) {
          from = run.aFrom;
          bFrom = run.bAt;
          bTo = run.bAt;
        }
        to = run.aTo;
      } else {
        if (from < 0) {
          from = run.aAt;
          to = run.aAt;
        }
        if (bFrom < 0) bFrom = run.bFrom;
        bTo = run.bTo;
      }
      i += 1;
    }
    spans.push({ from, to, insert: b.slice(bFrom, bTo) });
  }
  return spans;
}

/**
 * Apply spans produced by `diffSpans` (or their inverse, when the review UI
 * rejects a hunk). Requires them sorted and disjoint, which `diffSpans`
 * guarantees.
 */
export function applyDiffSpans(text: string, spans: readonly DiffSpan[]): string {
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.from) + span.insert;
    cursor = span.to;
  }
  return out + text.slice(cursor);
}
