/**
 * Reply markup — the three voices in a response letter (feature-plan-12 §6c,
 * "the black/blue/red role styling both real documents use").
 *
 * Read off the two response documents in this user's own corpus
 * (`examples/peer-review/`), which agree with each other exactly:
 *
 * | voice | reply-a reply-to-referees | reply-b response |
 * |---|---|---|
 * | the reviewer's comment | black, upright | black, upright |
 * | our reply | `#0432FF`, prefixed `RE:` | `#0432FF` |
 * | manuscript text quoted unchanged | black italic, inside `" "` | black italic |
 * | manuscript text that is NEW | `#EE0000` italic | `#FF0000` italic |
 *
 * That is the whole vocabulary, and it is worth having because a reader of a
 * response letter is doing exactly one thing: deciding, sentence by sentence,
 * who wrote this. Colour answers that before the sentence is read.
 *
 * **Marks, not anchors.** A quoted change is written into the reply with two
 * plain-text marks — `::quote … ::` around a manuscript excerpt, `+++ … +++`
 * around the part of it that is new. feature-plan-12 §6c specifies a further
 * step (`::quote{id=q7}` resolved through `anchor.ts locate()` at format
 * time, so a quote can never go stale) and that step is still worth taking;
 * this is the authoring surface it will resolve INTO. Until then red is
 * authored intent rather than a derived diff, which has the honest property
 * that nothing silently changes colour behind the author's back.
 *
 * **Forgiving by construction.** A half-typed reply is the normal state of a
 * reply, so an unclosed `::quote` simply runs to the end and an unpaired
 * `+++` stays literal text. Nothing here can throw, and nothing here rewrites
 * the author's characters — the source string is the truth and every consumer
 * is a view of it.
 */

/** What a stretch of a reply is. `marker` is the syntax itself. */
export type ReplyRole = 'reply' | 'quote' | 'change' | 'marker';

/** The reviewer's own words. Not produced by this module — they are not in
 * the reply string — but named here so both sides of the palette live
 * together. */
export type ResponseRole = ReplyRole | 'comment';

/**
 * The palette, for a white page. These are the observed values, not chosen
 * ones: `#0432FF` is the blue in both documents, `#EE0000` the red reply-a
 * uses for revised prose (reply-b uses `#FF0000`; they are the same
 * intent and one of them has to be ours).
 *
 * The workspace does NOT use these directly — the app's surfaces are dark,
 * and `#000000` on `#1e1e26` is unreadable. It maps the same roles onto
 * theme tokens (`--s-role-*` in tokens.css) which resolve to exactly these
 * values under the light themes. Export always uses these, because an
 * exported response is read on paper.
 */
export const RESPONSE_ROLE_COLORS: Readonly<Record<Exclude<ResponseRole, 'marker'>, string>> = {
  comment: '#000000',
  reply: '#0432FF',
  quote: '#000000',
  change: '#EE0000',
};

/** Opens a manuscript excerpt. Alone on its line. */
export const QUOTE_OPEN = '::quote';
/** Closes one. Alone on its line. */
export const QUOTE_CLOSE = '::';
/** Wraps manuscript text that is new or changed. */
export const CHANGE_MARK = '+++';
/** The opening both real documents put on every reply. */
export const REPLY_PREFIX = 'RE: ';

const QUOTE_OPEN_RE = /^[ \t]*::quote[ \t]*$/;
const QUOTE_CLOSE_RE = /^[ \t]*::[ \t]*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const CHANGE_RE = /\+\+\+([\s\S]*?)\+\+\+/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/* ------------------------------------------------------------------ */
/* The scan — one pass, two views                                       */
/* ------------------------------------------------------------------ */

interface LineRec {
  /** Offsets of the line's text, excluding its newline. */
  from: number;
  to: number;
  /** A `::quote` / `::` fence line, which contributes no prose. */
  fence: boolean;
  /** Whitespace only. */
  blank: boolean;
  /** Inside a quote block — fences themselves report the state they leave. */
  inQuote: boolean;
}

interface Scan {
  /** One role per character of the source. Coalesced by `replySpans`. */
  roles: ReplyRole[];
  lines: LineRec[];
}

function scan(source: string): Scan {
  const roles: ReplyRole[] = new Array<ReplyRole>(source.length).fill('reply');
  const lines: LineRec[] = [];

  let inQuote = false;
  let cursor = 0;
  while (cursor <= source.length) {
    const nl = source.indexOf('\n', cursor);
    const end = nl === -1 ? source.length : nl;
    const text = source.slice(cursor, end);

    let fence = false;
    if (!inQuote && QUOTE_OPEN_RE.test(text)) {
      fence = true;
      inQuote = true;
    } else if (inQuote && QUOTE_CLOSE_RE.test(text)) {
      fence = true;
      inQuote = false;
    }

    // A fence's own characters are syntax; everything else takes the role of
    // the block it sits in. The newline goes with the block either way, so a
    // coalesced span does not break at every line ending.
    const base: ReplyRole = inQuote || (fence && !QUOTE_OPEN_RE.test(text)) ? 'quote' : 'reply';
    for (let i = cursor; i < end; i += 1) roles[i] = fence ? 'marker' : base;
    if (nl !== -1) roles[nl] = base;

    lines.push({ from: cursor, to: end, fence, blank: text.trim() === '', inQuote });
    if (nl === -1) break;
    cursor = nl + 1;
  }

  // Inline marks last, so they win over the block role: `+++…+++` means the
  // same thing inside a quote (revised manuscript prose) and outside it (a
  // sentence we are flagging as new).
  for (const match of source.matchAll(CHANGE_RE)) {
    const from = match.index;
    const to = from + match[0].length;
    for (let i = from; i < to; i += 1) {
      roles[i] = i < from + CHANGE_MARK.length || i >= to - CHANGE_MARK.length ? 'marker' : 'change';
    }
  }

  // An HTML comment is a note to a co-author, not prose. Dimmed here, dropped
  // from the export — the same treatment `letterBlocks` gives it.
  for (const match of source.matchAll(COMMENT_RE)) {
    for (let i = match.index; i < match.index + match[0].length; i += 1) roles[i] = 'marker';
  }

  return { roles, lines };
}

/* ------------------------------------------------------------------ */
/* View 1 — spans over the source, for the editor overlay               */
/* ------------------------------------------------------------------ */

export interface ReplySpan {
  from: number;
  to: number;
  role: ReplyRole;
}

/**
 * Contiguous role spans covering the WHOLE source, markers included.
 *
 * The workspace paints these behind a transparent textarea, so they must
 * account for every character the author typed — a span list with holes in it
 * would render a reply with letters missing.
 */
export function replySpans(source: string): ReplySpan[] {
  if (source === '') return [];
  const { roles } = scan(source);
  const out: ReplySpan[] = [];
  let start = 0;
  for (let i = 1; i <= roles.length; i += 1) {
    if (i < roles.length && roles[i] === roles[start]) continue;
    out.push({ from: start, to: i, role: roles[start] as ReplyRole });
    start = i;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* View 1b — decorations, for the live-preview editor                   */
/* ------------------------------------------------------------------ */

/** A stretch of visible text painted in one voice. */
export interface ReplyMarkRange {
  from: number;
  to: number;
  role: Exclude<ReplyRole, 'marker'>;
}

/**
 * A run of syntax the editor conceals — `::quote`, `::`, `+++`, an HTML note.
 *
 * `[from,to)` is what disappears; `[revealFrom,revealTo)` is the larger range
 * the caret has to be inside for it to come back. The two differ because the
 * useful unit of reveal is the CONSTRUCT, not the mark: putting the caret
 * anywhere in a quoted excerpt should show both of its fences at once, so you
 * can see where the block you are typing in begins and ends. Showing only the
 * fence you happen to be sitting on tells you nothing.
 *
 * A fence's hidden range deliberately swallows one newline — the open fence
 * takes the one after it, the close fence the one before it — so a concealed
 * block collapses to just its prose instead of leaving two blank lines behind
 * where the syntax used to be.
 */
export interface ReplyHideRange {
  from: number;
  to: number;
  revealFrom: number;
  revealTo: number;
}

export interface ReplyDecorations {
  marks: ReplyMarkRange[];
  hides: ReplyHideRange[];
  /**
   * Start offset of every line belonging to a quoted excerpt, fences
   * included. The editor indents these, which is the other half of what
   * makes a quote read as the paper speaking inside our reply — colour alone
   * stops working the moment somebody prints in greyscale.
   */
  quoteLineStarts: number[];
}

/**
 * Everything the reply editor draws, in one pass over the source.
 *
 * Kept here rather than in the editor because it is pure offset arithmetic
 * over the same scan the exporter uses — which is what stops the box and the
 * exported file from ever disagreeing about where a quote starts.
 */
export function replyDecorations(source: string): ReplyDecorations {
  const { roles, lines } = scan(source);

  // Quote blocks, from fence to fence. An unclosed one runs to the end: the
  // author is mid-type, and the block they are inside is still that block.
  const blocks: { from: number; to: number; openLine: number; closeLine: number }[] = [];
  let openIndex = -1;
  lines.forEach((line, index) => {
    if (!line.fence) return;
    if (line.inQuote) {
      openIndex = index;
      return;
    }
    if (openIndex === -1) return;
    blocks.push({
      from: lines[openIndex]!.from,
      to: line.to,
      openLine: openIndex,
      closeLine: index,
    });
    openIndex = -1;
  });
  if (openIndex !== -1) {
    blocks.push({
      from: lines[openIndex]!.from,
      to: source.length,
      openLine: openIndex,
      closeLine: lines.length - 1,
    });
  }

  const hides: ReplyHideRange[] = [];
  const quoteLineStarts: number[] = [];

  for (const block of blocks) {
    for (let i = block.openLine; i <= block.closeLine; i += 1) {
      const line = lines[i];
      if (line !== undefined) quoteLineStarts.push(line.from);
    }
    const open = lines[block.openLine]!;
    // Swallow the newline after the open fence, so hiding it removes the
    // line rather than leaving an empty one.
    const openTo = Math.min(open.to + 1, source.length);
    hides.push({ from: open.from, to: openTo, revealFrom: block.from, revealTo: block.to });

    const close = lines[block.closeLine];
    if (close === undefined || !close.fence) continue;
    // ...and the newline BEFORE the close fence, for the same reason. Clamped
    // to where the open fence's hide ended: an empty block (`::quote` then
    // `::`) would otherwise produce two overlapping ranges, which the editor
    // cannot draw.
    const closeFrom = Math.max(close.from - 1, openTo);
    if (closeFrom < close.to) {
      hides.push({
        from: closeFrom,
        to: close.to,
        revealFrom: block.from,
        revealTo: block.to,
      });
    }
  }

  // The change marks. Reveal range is the whole `+++…+++`, so a caret inside
  // the marked words shows both marks and you can see what you are editing.
  for (const match of source.matchAll(CHANGE_RE)) {
    const from = match.index;
    const to = from + match[0].length;
    hides.push({ from, to: from + CHANGE_MARK.length, revealFrom: from, revealTo: to });
    hides.push({ from: to - CHANGE_MARK.length, to, revealFrom: from, revealTo: to });
  }

  for (const match of source.matchAll(COMMENT_RE)) {
    const from = match.index;
    const to = from + match[0].length;
    hides.push({ from, to, revealFrom: from, revealTo: to });
  }

  // Visible text, coalesced by voice. Marker characters are skipped: the
  // editor conceals them, and where it does not, they are drawn by their own
  // decoration.
  const marks: ReplyMarkRange[] = [];
  for (let i = 0; i < roles.length; i += 1) {
    const role = roles[i] as ReplyRole;
    if (role === 'marker') continue;
    const last = marks[marks.length - 1];
    if (last !== undefined && last.to === i && last.role === role) last.to = i + 1;
    else marks.push({ from: i, to: i + 1, role });
  }

  hides.sort((a, b) => a.from - b.from || a.to - b.to);
  quoteLineStarts.sort((a, b) => a - b);
  return { marks, hides, quoteLineStarts };
}

/* ------------------------------------------------------------------ */
/* View 2 — blocks, for the export                                      */
/* ------------------------------------------------------------------ */

/** A stretch of one voice inside a block. Markers are already gone. */
export interface ReplyRun {
  text: string;
  role: Exclude<ReplyRole, 'marker'>;
}

export interface ReplyBlock {
  kind: 'paragraph' | 'heading' | 'quote';
  /** Heading depth; 0 for everything else. */
  level: number;
  runs: ReplyRun[];
}

/** Coalesce a source range into runs, dropping every marker character. */
function runsIn(source: string, roles: readonly ReplyRole[], from: number, to: number): ReplyRun[] {
  const out: ReplyRun[] = [];
  for (let i = from; i < to; i += 1) {
    const role = roles[i] as ReplyRole;
    if (role === 'marker') continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.role === role) last.text += source[i];
    else out.push({ text: source[i] as string, role });
  }
  // Marker removal leaves the edges ragged — `::quote\nText\n::` becomes
  // `\nText\n`. Trim the ends of the block, never the middle: interior line
  // breaks are the author's paragraphing.
  if (out.length > 0) {
    out[0]!.text = out[0]!.text.replace(/^\s+/, '');
    out[out.length - 1]!.text = out[out.length - 1]!.text.replace(/\s+$/, '');
  }
  return out.filter((run) => run.text !== '');
}

/**
 * A reply, in the shape the exporters render.
 *
 * Blank lines separate paragraphs, `#` heads a heading, and a `::quote` block
 * becomes one `quote` block per paragraph inside it — the same Markdown
 * `letterBlocks` accepts, plus the two marks. A reply written before this
 * module existed parses as one `reply` run per paragraph, which is exactly
 * what it looked like before.
 */
export function replyBlocks(source: string): ReplyBlock[] {
  const { roles, lines } = scan(source);
  const blocks: ReplyBlock[] = [];

  let openFrom = -1;
  let openTo = -1;
  let openQuote = false;

  const flush = (): void => {
    if (openFrom === -1) return;
    const runs = runsIn(source, roles, openFrom, openTo);
    openFrom = -1;
    if (runs.length === 0) return;
    blocks.push({ kind: openQuote ? 'quote' : 'paragraph', level: 0, runs });
  };

  for (const line of lines) {
    if (line.fence) {
      flush();
      continue;
    }
    if (line.blank) {
      flush();
      continue;
    }
    if (openFrom === -1) {
      // A heading is a heading only at the top of a paragraph and only
      // outside a quote — inside one, `#` is the reviewer's or the paper's
      // own character and rewriting it as structure would be a lie.
      const heading = line.inQuote ? null : HEADING_RE.exec(source.slice(line.from, line.to));
      if (heading !== null) {
        const runs = runsIn(source, roles, line.from + heading[1]!.length + 1, line.to);
        if (runs.length > 0) {
          blocks.push({ kind: 'heading', level: heading[1]!.length, runs });
        }
        continue;
      }
      openFrom = line.from;
      openQuote = line.inQuote;
    }
    openTo = line.to;
  }
  flush();
  return blocks;
}

/** The reply as plain text, markers stripped — for a word count or a prompt. */
export function replyPlainText(source: string): string {
  return replyBlocks(source)
    .map((block) => block.runs.map((run) => run.text).join(''))
    .join('\n\n');
}

/** True when the reply contains at least one quoted manuscript excerpt. */
export function hasQuotedChange(source: string): boolean {
  return replyBlocks(source).some(
    (block) => block.kind === 'quote' || block.runs.some((run) => run.role === 'change'),
  );
}

/* ------------------------------------------------------------------ */
/* Quick insertions — the pure half of the editor's triggers            */
/* ------------------------------------------------------------------ */

/**
 * The result of a quick insertion: the whole new reply, and where the caret
 * goes. Whole-string rather than a patch because the textarea is
 * uncontrolled-with-a-draft and setting `.value` is what it already does.
 */
export interface ReplyEdit {
  text: string;
  /** Caret, or the start of a selection to leave selected. */
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Insert a manuscript excerpt scaffold, wrapping the selection if there is
 * one. Blank lines are added around it only where the surrounding text does
 * not already provide them — a fence glued to the previous paragraph reads
 * as part of it.
 */
export function insertQuoteBlock(source: string, start: number, end: number): ReplyEdit {
  const body = source.slice(start, end).trim();
  // Trailing spaces on the line we are breaking would be stranded at the end
  // of it. Newlines are left alone — those are the author's paragraphing.
  const before = source.slice(0, start).replace(/[ \t]+$/, '');
  const after = source.slice(end);
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = after === '' || after.startsWith('\n') ? '' : '\n';
  const block = `${lead}${QUOTE_OPEN}\n${body}\n${QUOTE_CLOSE}\n${tail}`;
  // Caret on the body line: an empty scaffold is something you type into, and
  // a filled one is something you may want to mark part of.
  const bodyStart = before.length + lead.length + QUOTE_OPEN.length + 1;
  return {
    text: `${before}${block}${after}`,
    selectionStart: bodyStart,
    selectionEnd: bodyStart + body.length,
  };
}

/**
 * Mark the selection as new manuscript text. With no selection, drop an empty
 * pair and put the caret between the marks.
 */
export function markChange(source: string, start: number, end: number): ReplyEdit {
  const selected = source.slice(start, end);
  // Whitespace at the edges of a selection is the author's spacing, not part
  // of what they meant to mark: double-clicking a word and dragging one pixel
  // takes the following space with it, and `+++word +++` puts a red space in
  // the document.
  const lead = /^\s*/.exec(selected)![0];
  const tail = selected === lead ? '' : /\s*$/.exec(selected)![0];
  const inner = selected.slice(lead.length, selected.length - tail.length);

  // Marking a selection that is already marked unmarks it — the same toggle
  // every bold shortcut has, and the only way to undo a mis-click without
  // hunting for six plus signs.
  if (
    inner.length >= CHANGE_MARK.length * 2 &&
    inner.startsWith(CHANGE_MARK) &&
    inner.endsWith(CHANGE_MARK)
  ) {
    const bare = inner.slice(CHANGE_MARK.length, -CHANGE_MARK.length);
    return {
      text: `${source.slice(0, start)}${lead}${bare}${tail}${source.slice(end)}`,
      selectionStart: start + lead.length,
      selectionEnd: start + lead.length + bare.length,
    };
  }

  const wrapped = `${CHANGE_MARK}${inner}${CHANGE_MARK}`;
  const at = start + lead.length;
  return {
    text: `${source.slice(0, start)}${lead}${wrapped}${tail}${source.slice(end)}`,
    selectionStart: inner === '' ? at + CHANGE_MARK.length : at,
    selectionEnd: inner === '' ? at + CHANGE_MARK.length : at + wrapped.length,
  };
}

/**
 * The sentence that points one reviewer at an answer given to another.
 *
 * Its wording is the convention already written into the suggested
 * `context/PEER-REVIEW.md` ("answer it once in full and point at that answer
 * from the other"), so the trigger and the guide cannot drift.
 */
export function crossReferenceSentence(reviewerIndex: number, pointIndex: number): string {
  return `This point is also addressed in our reply to Reviewer ${reviewerIndex}, point ${pointIndex}.`;
}

/** Insert a cross-reference at the caret, spaced off the text around it. */
export function insertCrossReference(source: string, start: number, end: number, sentence: string): ReplyEdit {
  const before = source.slice(0, start);
  const after = source.slice(end);
  const lead = before === '' || /\s$/.test(before) ? '' : ' ';
  const tail = after === '' || /^\s/.test(after) ? '' : ' ';
  const caret = start + lead.length + sentence.length;
  return {
    text: `${before}${lead}${sentence}${tail}${after}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/**
 * True when `at` sits inside a quoted excerpt.
 *
 * The `::` trigger asks this before it fires: inside a quote, `::` is the
 * closing fence and hijacking it would make the block impossible to end by
 * hand. Outside one it is not valid syntax for anything, which is what makes
 * it free to use as the shortcut.
 */
export function insideQuoteBlock(source: string, at: number): boolean {
  const { lines } = scan(source);
  for (const line of lines) {
    if (at < line.from) break;
    // A position ON the closing fence is still inside the block it closes;
    // `line.inQuote` reports the state the line LEAVES, so a fence needs the
    // opposite answer from the body lines around it.
    if (at <= line.to) return line.fence ? true : line.inQuote;
  }
  return lines[lines.length - 1]?.inQuote ?? false;
}

/**
 * The `RE: ` opening, added when the reply does not already have one.
 *
 * Both real documents open every reply with it, and it is the one convention
 * an author is guaranteed to retype eighty-four times. Applied on the first
 * keystroke into an empty box rather than by pre-filling it, so a reply left
 * untouched stays genuinely empty — an empty reply is what the unaddressed
 * count and the export gap are counting.
 */
export function withReplyPrefix(source: string, caret: number): ReplyEdit {
  if (/^\s*RE\s*\d*\s*:/i.test(source)) {
    return { text: source, selectionStart: caret, selectionEnd: caret };
  }
  return {
    text: `${REPLY_PREFIX}${source}`,
    selectionStart: caret + REPLY_PREFIX.length,
    selectionEnd: caret + REPLY_PREFIX.length,
  };
}
