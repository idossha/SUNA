import { wordDiff, type DiffOp } from './word-diff';

/**
 * Document comparison — what changed between the manuscript the reviewers
 * read and the one you have now (feature-plan-14).
 *
 * The primitive underneath is `wordDiff`, which already answers "which words
 * differ" for the AI-revision review bar. What a peer-review comparison needs
 * on top of it is STRUCTURE, and for one reason: a response letter is written
 * section by section, against a reviewer who wrote "the Methods do not say
 * how many trials were dropped". A flat list of 340 word-level edits across a
 * 9,000-word paper cannot answer that; "Methods — 3 changes" can.
 *
 * So the shape here is: split both texts on their Markdown headings, align
 * the two heading lists, and diff each aligned pair on its own. Sections that
 * exist on one side only are reported as added or removed WHOLE rather than
 * as a giant word-diff against the section that happens to sit at the same
 * index — an inserted "Limitations" must not make every later section read as
 * rewritten.
 *
 * Everything here is pure and derived. Nothing is stored: a comparison is
 * recomputed from the two texts every time it is shown, which is the same
 * discipline numbering and the revision review bar already follow, and it is
 * what makes a comparison against a read-only archive impossible to get out
 * of date.
 */

/* ------------------------------------------------------------------ */
/* Hunks                                                                */
/* ------------------------------------------------------------------ */

/**
 * One reviewable change: the removal and the addition that replaces it are
 * ONE hunk, not two, because that is how a reader sees a replacement and how
 * a response letter quotes it ("we changed X to Y").
 *
 * Both coordinate spaces are carried. `base*` indexes the older text, `head*`
 * the newer, and either range may be empty — a pure insertion has
 * `baseFrom === baseTo`, a pure deletion `headFrom === headTo`. Offsets are
 * CHARACTER offsets into the strings that were diffed, so a caller can slice
 * either side without a second coordinate space to get wrong.
 */
export interface DiffHunk {
  baseFrom: number;
  baseTo: number;
  headFrom: number;
  headTo: number;
}

/** Fold `wordDiff`'s op list into hunks: adjacent non-equal ops merge. */
export function diffHunks(base: string, head: string): DiffHunk[] {
  if (base === head) return [];
  return hunksFromOps(wordDiff(base, head));
}

/** The same fold over an op list already computed. */
export function hunksFromOps(ops: readonly DiffOp[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op === undefined || op.kind === 'equal') {
      i += 1;
      continue;
    }
    let baseFrom = -1;
    let baseTo = -1;
    let headFrom = -1;
    let headTo = -1;
    while (i < ops.length) {
      const run = ops[i];
      if (run === undefined || run.kind === 'equal') break;
      if (run.kind === 'delete') {
        if (baseFrom < 0) baseFrom = run.aFrom;
        baseTo = run.aTo;
        if (headFrom < 0) {
          headFrom = run.bAt;
          headTo = run.bAt;
        }
      } else {
        if (baseFrom < 0) {
          baseFrom = run.aAt;
          baseTo = run.aAt;
        }
        if (headFrom < 0) headFrom = run.bFrom;
        headTo = run.bTo;
      }
      i += 1;
    }
    hunks.push({ baseFrom, baseTo, headFrom, headTo });
  }
  return hunks;
}

/* ------------------------------------------------------------------ */
/* Sections                                                             */
/* ------------------------------------------------------------------ */

/**
 * One heading and the prose under it, as `splitSections` cuts a manuscript.
 *
 * The first entry of a document that opens with prose is a level-0 section
 * with an empty title: text before the first heading is still text somebody
 * may have rewritten, and dropping it would silently hide a changed opening
 * paragraph.
 */
export interface DocSection {
  /** ATX depth, 1–6. 0 for the untitled preamble. */
  level: number;
  title: string;
  /** Headings above this one, outermost first — the breadcrumb a card shows. */
  ancestors: string[];
  /** Offsets into the whole text: `from` includes the heading line. */
  from: number;
  to: number;
  /** Where the prose starts, i.e. just past the heading line. */
  bodyFrom: number;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const FENCE_RE = /^[ \t]*(```|~~~)/;

/**
 * Cut a Markdown document into heading-rooted sections.
 *
 * Fenced code is skipped, because `# not a heading` inside a fence is a
 * comment in someone's Python and cutting the document there would invent a
 * section that is not in the paper.
 */
export function splitSections(text: string): DocSection[] {
  const starts: { level: number; title: string; at: number; bodyFrom: number }[] = [];
  let inFence = false;
  let cursor = 0;
  while (cursor <= text.length) {
    const nl = text.indexOf('\n', cursor);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(cursor, end);
    if (FENCE_RE.test(line)) inFence = !inFence;
    else if (!inFence) {
      const m = HEADING_RE.exec(line);
      if (m !== null) {
        starts.push({
          level: m[1]!.length,
          title: m[2]!,
          at: cursor,
          bodyFrom: nl === -1 ? text.length : nl + 1,
        });
      }
    }
    if (nl === -1) break;
    cursor = nl + 1;
  }

  const sections: DocSection[] = [];
  const openAt = starts.length > 0 ? starts[0]!.at : text.length;
  if (openAt > 0 || starts.length === 0) {
    sections.push({ level: 0, title: '', ancestors: [], from: 0, to: openAt, bodyFrom: 0 });
  }
  const stack: { level: number; title: string }[] = [];
  starts.forEach((start, i) => {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= start.level) stack.pop();
    sections.push({
      level: start.level,
      title: start.title,
      ancestors: stack.map((s) => s.title),
      from: start.at,
      to: i + 1 < starts.length ? starts[i + 1]!.at : text.length,
      bodyFrom: start.bodyFrom,
    });
    stack.push({ level: start.level, title: start.title });
  });
  return sections;
}

/** Blank lines at the edges of a section are the gap around it, not its text. */
function trimEnds(text: string): string {
  return text.replace(/^\s+/, '').replace(/\s+$/, '');
}

/** The identity a section is aligned on: its full heading path, case-folded. */
function sectionKey(section: DocSection): string {
  return [...section.ancestors, section.title]
    .join(' › ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Section diff                                                         */
/* ------------------------------------------------------------------ */

export type SectionChange = 'unchanged' | 'modified' | 'added' | 'removed';

export interface SectionDiff {
  /** Stable within one comparison: the heading path, plus a suffix when a
   *  paper repeats a heading (two "Statistics" subsections is not an error). */
  id: string;
  title: string;
  ancestors: string[];
  level: number;
  change: SectionChange;
  /** The section's own text on each side, heading line included. */
  baseText: string;
  headText: string;
  /** Ops over `baseText`/`headText` — offsets are LOCAL to those strings. */
  ops: DiffOp[];
  hunks: DiffHunk[];
  wordsAdded: number;
  wordsRemoved: number;
}

/**
 * Words in a string. Whitespace-split, the same rule `outlineFromMarkdown`
 * counts by, minus the tokens that carry no word at all — a diff fragment is
 * routinely a lone comma or a closing bracket, and counting those as words
 * would make "3 words added" mean nothing.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/**
 * Align two section lists by heading path, longest-common-subsequence.
 *
 * LCS rather than "match by title anywhere" because order carries meaning: a
 * paper that MOVED its Limitations section from the end of Discussion to the
 * end of Results has changed, and pretending the two are the same section
 * because they share a title would hide the move. LCS reports the moved copy
 * as one removal and one addition, which is what a reader needs to see.
 *
 * O(n x m) over headings, not characters — a 60-heading paper is 3,600 cells.
 */
function alignSections(
  base: readonly DocSection[],
  head: readonly DocSection[],
): { base: DocSection | null; head: DocSection | null }[] {
  const n = base.length;
  const m = head.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        sectionKey(base[i]!) === sectionKey(head[j]!)
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: { base: DocSection | null; head: DocSection | null }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sectionKey(base[i]!) === sectionKey(head[j]!)) {
      pairs.push({ base: base[i]!, head: head[j]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      pairs.push({ base: base[i]!, head: null });
      i += 1;
    } else {
      pairs.push({ base: null, head: head[j]! });
      j += 1;
    }
  }
  while (i < n) pairs.push({ base: base[i++]!, head: null });
  while (j < m) pairs.push({ base: null, head: head[j++]! });
  return pairs;
}

/**
 * Compare two manuscripts section by section, in reading order.
 *
 * Unchanged sections are RETURNED, not filtered: the comparison view offers
 * "changes only" as a toggle, and a caller that wants the whole paper with
 * its changes marked — the way an author reads a revision — needs the quiet
 * sections to render the changed ones in context.
 */
export function diffSections(base: string, head: string): SectionDiff[] {
  const pairs = alignSections(splitSections(base), splitSections(head));
  const seen = new Map<string, number>();
  const out: SectionDiff[] = [];

  for (const pair of pairs) {
    const anchor = pair.head ?? pair.base;
    if (anchor === undefined || anchor === null) continue;
    // The PROSE under the heading, not the heading line: the section is
    // already named by `title`, and a heading repeated inside its own card
    // reads as a change nobody made. A heading that was actually reworded
    // does not go missing — it changes the section's identity, so the
    // alignment above reports it as one removed and one added section, which
    // is what a renamed section is.
    //
    // Blank lines at either end belong to the gap BETWEEN sections. The blank
    // line a later insertion pushed in front of the next heading is not an
    // edit to this one, and reporting it as one would light up every section
    // above an addition.
    const baseText = pair.base === null ? '' : trimEnds(base.slice(pair.base.bodyFrom, pair.base.to));
    const headText = pair.head === null ? '' : trimEnds(head.slice(pair.head.bodyFrom, pair.head.to));

    // A preamble that is empty on both sides is not a section anyone wants a
    // card for — it is the blank line above the title.
    if (anchor.level === 0 && baseText.trim() === '' && headText.trim() === '') continue;

    const key = sectionKey(anchor);
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);

    const ops = baseText === headText ? [] : wordDiff(baseText, headText);
    let wordsAdded = 0;
    let wordsRemoved = 0;
    for (const op of ops) {
      if (op.kind === 'insert') wordsAdded += countWords(headText.slice(op.bFrom, op.bTo));
      else if (op.kind === 'delete') wordsRemoved += countWords(baseText.slice(op.aFrom, op.aTo));
    }

    const change: SectionChange =
      pair.base === null
        ? 'added'
        : pair.head === null
          ? 'removed'
          : baseText === headText
            ? 'unchanged'
            : 'modified';

    out.push({
      id: nth === 0 ? key || '(opening)' : `${key || '(opening)'}#${nth + 1}`,
      title: anchor.title,
      ancestors: anchor.ancestors,
      level: anchor.level,
      change,
      baseText,
      headText,
      ops,
      hunks: hunksFromOps(ops),
      wordsAdded,
      wordsRemoved,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Stats                                                                */
/* ------------------------------------------------------------------ */

export interface DiffStats {
  /** Sections whose text differs at all, added and removed ones included. */
  sectionsChanged: number;
  sectionsTotal: number;
  hunks: number;
  wordsAdded: number;
  wordsRemoved: number;
}

export function diffStats(sections: readonly SectionDiff[]): DiffStats {
  let sectionsChanged = 0;
  let hunks = 0;
  let wordsAdded = 0;
  let wordsRemoved = 0;
  for (const s of sections) {
    if (s.change !== 'unchanged') sectionsChanged += 1;
    hunks += s.hunks.length;
    wordsAdded += s.wordsAdded;
    wordsRemoved += s.wordsRemoved;
  }
  return { sectionsChanged, sectionsTotal: sections.length, hunks, wordsAdded, wordsRemoved };
}

/* ------------------------------------------------------------------ */
/* Metadata fields                                                      */
/* ------------------------------------------------------------------ */

/**
 * A titled pair of strings compared on its own — the title, the abstract, the
 * data-availability statement. These live in manuscript.json rather than in
 * the prose, and reviewers comment on them as often as on the Methods, so a
 * comparison that showed only manuscript.md would miss the change a reviewer
 * asked for most explicitly.
 */
export interface FieldDiff {
  id: string;
  label: string;
  baseText: string;
  headText: string;
  ops: DiffOp[];
  hunks: DiffHunk[];
  wordsAdded: number;
  wordsRemoved: number;
}

export function diffFields(
  fields: readonly { id: string; label: string; base: string; head: string }[],
): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const field of fields) {
    if (field.base === field.head) continue;
    const ops = wordDiff(field.base, field.head);
    let wordsAdded = 0;
    let wordsRemoved = 0;
    for (const op of ops) {
      if (op.kind === 'insert') wordsAdded += countWords(field.head.slice(op.bFrom, op.bTo));
      else if (op.kind === 'delete') wordsRemoved += countWords(field.base.slice(op.aFrom, op.aTo));
    }
    out.push({
      id: field.id,
      label: field.label,
      baseText: field.base,
      headText: field.head,
      ops,
      hunks: hunksFromOps(ops),
      wordsAdded,
      wordsRemoved,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bibliography                                                         */
/* ------------------------------------------------------------------ */

export type BibChange = 'added' | 'removed' | 'modified';

export interface BibEntryDiff {
  citekey: string;
  change: BibChange;
  baseText: string;
  headText: string;
}

/**
 * References compared by CITE KEY rather than as text.
 *
 * "Added [@smith2023]" is the sentence a response letter needs — a word-level
 * diff of a .bib file answers it only after the reader has mentally parsed
 * BibTeX, and reorders the whole file the moment somebody runs a formatter
 * over it. Keys are stable; byte order is not.
 */
export function diffBibliography(base: string, head: string): BibEntryDiff[] {
  const b = bibEntries(base);
  const h = bibEntries(head);
  const keys = [...new Set([...b.keys(), ...h.keys()])].sort((x, y) => x.localeCompare(y));
  const out: BibEntryDiff[] = [];
  for (const citekey of keys) {
    const before = b.get(citekey);
    const after = h.get(citekey);
    if (before === undefined && after !== undefined) {
      out.push({ citekey, change: 'added', baseText: '', headText: after });
    } else if (before !== undefined && after === undefined) {
      out.push({ citekey, change: 'removed', baseText: before, headText: '' });
    } else if (before !== undefined && after !== undefined && normalizeBib(before) !== normalizeBib(after)) {
      out.push({ citekey, change: 'modified', baseText: before, headText: after });
    }
  }
  return out;
}

/** Whitespace between BibTeX fields is a formatter's choice, not an edit. */
function normalizeBib(entry: string): string {
  return entry.replace(/\s+/g, ' ').trim();
}

const BIB_START_RE = /^[ \t]*@([A-Za-z]+)[ \t]*[{(][ \t]*([^,\s}]+)[ \t]*,/;

/**
 * Cut a .bib into entries by key. Brace-counted rather than regex-matched to
 * the closing brace, because a title field routinely holds braces of its own
 * ("The {Hubble} Constant") and a lazy match would end the entry inside one.
 */
function bibEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = BIB_START_RE.exec(lines[i]!);
    if (m === null) {
      i += 1;
      continue;
    }
    const citekey = m[2]!;
    const collected: string[] = [];
    let depth = 0;
    let started = false;
    while (i < lines.length) {
      const line = lines[i]!;
      collected.push(line);
      for (const ch of line) {
        if (ch === '{' || ch === '(') {
          depth += 1;
          started = true;
        } else if (ch === '}' || ch === ')') depth -= 1;
      }
      i += 1;
      if (started && depth <= 0) break;
    }
    entries.set(citekey, collected.join('\n').trim());
  }
  return entries;
}
