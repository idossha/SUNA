/**
 * W3C-style text-quote anchoring, shared by the renderer's comment UI
 * (apps/desktop/src/renderer/src/comments/anchor.ts re-exports this) and the
 * MCP `add_comment`/comment tools (packages/agent/src/mcp/comments.ts import
 * this directly) — a comment created by an agent over raw file text and one
 * created by a human over live editor text resolve to the same span given
 * the same manuscript content, because both call this exact code.
 *
 * Strategy, in order:
 *  1. exact quote match — if the quote appears exactly once, that's it,
 *     regardless of whether the surrounding prefix/suffix has drifted (an
 *     edit elsewhere in the document should never detach a still-unique
 *     quote).
 *  2. the quote appears more than once — disambiguate using the stored
 *     prefix/suffix context, preferring the occurrence whose actual
 *     surrounding text matches.
 *  3. the quote does not appear verbatim — fall back to a whitespace-
 *     normalized fuzzy match (handles rewrapped paragraphs, collapsed
 *     whitespace).
 *  4. nothing matches — null. The caller marks the comment `detached` and
 *     keeps it; this module never decides to drop anything.
 */

export interface AnchorRange {
  from: number;
  to: number;
}

export interface QuoteAnchorLike {
  quote: string;
  prefix?: string;
  suffix?: string;
}

/** Characters of context captured on each side when a comment is created. */
const CONTEXT_CHARS = 32;

/** Build a W3C-style quote anchor for the span [from, to) of `text`. */
export function makeAnchor(
  text: string,
  from: number,
  to: number,
): { quote: string; prefix: string; suffix: string } {
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT_CHARS), from),
    suffix: text.slice(to, to + CONTEXT_CHARS),
  };
}

function allIndicesOf(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + needle.length);
  }
  return out;
}

function contextScore(
  text: string,
  from: number,
  to: number,
  prefix: string,
  suffix: string,
): number {
  let score = 0;
  if (prefix.length > 0 && text.slice(Math.max(0, from - prefix.length), from) === prefix) {
    score += 2;
  }
  if (suffix.length > 0 && text.slice(to, to + suffix.length) === suffix) {
    score += 2;
  }
  return score;
}

function bestOccurrence(
  text: string,
  occurrences: readonly number[],
  quoteLen: number,
  prefix: string,
  suffix: string,
): AnchorRange {
  let best = occurrences[0] ?? 0;
  let bestScore = -1;
  for (const from of occurrences) {
    const to = from + quoteLen;
    const score = contextScore(text, from, to, prefix, suffix);
    if (score > bestScore) {
      bestScore = score;
      best = from;
    }
  }
  return { from: best, to: best + quoteLen };
}

/** Collapse runs of whitespace to a single space and trim; keep a map back to original indices. */
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = '';
  const map: number[] = [];
  let lastWasSpace = true; // leading whitespace is dropped, same as a trim()
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        normalized += ' ';
        map.push(i);
        lastWasSpace = true;
      }
    } else {
      normalized += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { normalized, map };
}

function fuzzyLocate(
  text: string,
  quote: string,
  prefix: string,
  suffix: string,
): AnchorRange | null {
  const { normalized, map } = normalizeWithMap(text);
  const needle = normalizeWithMap(quote).normalized;
  if (needle.length === 0) return null;

  const occurrences = allIndicesOf(normalized, needle);
  if (occurrences.length === 0) return null;

  let bestPos = occurrences[0] as number;
  if (occurrences.length > 1) {
    const normPrefix = normalizeWithMap(prefix).normalized;
    const normSuffix = normalizeWithMap(suffix).normalized;
    let bestScore = -1;
    for (const pos of occurrences) {
      let score = 0;
      const actualPrefix = normalized.slice(Math.max(0, pos - normPrefix.length), pos);
      const actualSuffix = normalized.slice(
        pos + needle.length,
        pos + needle.length + normSuffix.length,
      );
      if (normPrefix.length > 0 && actualPrefix === normPrefix) score += 2;
      if (normSuffix.length > 0 && actualSuffix === normSuffix) score += 2;
      if (score > bestScore) {
        bestScore = score;
        bestPos = pos;
      }
    }
  }

  const from = map[bestPos];
  const to = map[bestPos + needle.length - 1];
  if (from === undefined || to === undefined) return null;
  return { from, to: to + 1 };
}

/**
 * Locate an anchor's quote in `text`. Returns the character range [from, to)
 * of the best match, or null when the quote cannot be found by any tier.
 */
export function locate(text: string, anchor: QuoteAnchorLike): AnchorRange | null {
  const quote = anchor.quote;
  if (quote.length === 0) return null;
  const prefix = anchor.prefix ?? '';
  const suffix = anchor.suffix ?? '';

  const occurrences = allIndicesOf(text, quote);
  if (occurrences.length === 1) {
    const from = occurrences[0] as number;
    return { from, to: from + quote.length };
  }
  if (occurrences.length > 1) {
    return bestOccurrence(text, occurrences, quote.length, prefix, suffix);
  }
  return fuzzyLocate(text, quote, prefix, suffix);
}
