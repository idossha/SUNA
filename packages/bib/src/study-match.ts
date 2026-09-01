import type { LitResult, MatchConfidence, StudyResolution } from '@suna/core';
import { detectArxivId } from './model.js';

/**
 * Mention → one work (ARCHITECTURE §9, `study-match.ts`). The user
 * says "the Gunn & Gott 1972 ram-pressure stripping paper"; the providers
 * answer with dozens of records across four APIs; this module turns the first
 * into hints, folds the second into one candidate list, ranks it, and reports
 * how sure it is.
 *
 * Pure by doctrine — no `fetch`, no `fs`, no `child_process` — so the desktop
 * main process and the standalone MCP server run the identical matcher and
 * can never disagree about which paper a mention meant.
 *
 * The whole point of the module is the honesty rule, so it is stated once,
 * here, and implemented exactly once below in `resolveStudy`:
 *
 *   - A DOI or arXiv-id hint that matches a candidate is DECISIVE. The user
 *     handed us the identifier; there is nothing left to guess, and the
 *     result is `high` no matter what the titles say.
 *   - Otherwise the answer is `low` when the top two scores are within 10 % of
 *     each other, or when the best title similarity is under 0.5.
 *   - A near-tie returns `chosen: null` WITH the tied works in
 *     `alternatives`. The plan's fifth outcome — "matched several works too
 *     closely to choose" — is reported as ambiguity, "never papered over by
 *     picking the first hit". `cite_study` refuses to write on `low`, so a
 *     dishonest `high` here would silently cite the wrong paper.
 *
 * Nothing in here throws: a mention that parses to nothing is empty hints, and
 * an empty candidate list is a null choice — never an exception, and never an
 * empty list standing in for a provider that failed (that is what
 * `StudyResolution.errors` carries).
 */

/* ---------------------------------------------------------------- shapes -- */

/**
 * What a free-text mention actually told us. Every field is present and
 * explicitly null when the mention said nothing about it — the same rule the
 * shared schemas in `@suna/core` follow, so a caller never has to tell "absent"
 * from "unknown".
 */
export interface MentionHints {
  /** Normalized: prefix stripped and lowercased — a DOI is case-insensitive (ISO 26324). */
  doi: string | null;
  /** Normalized: `arXiv:` prefix and any `vN` suffix dropped, lowercased. */
  arxivId: string | null;
  /** ASCII-folded, lowercased, deduped, in the order written: `['gunn', 'gott']`. */
  surnames: string[];
  year: number | null;
  /** Inner text of the first `"…"` / `“…”` span, verbatim and trimmed. */
  quotedTitle: string | null;
  /** Folded, deduped, significant words left once every hint above was taken out. */
  freeWords: string[];
}

/** One candidate with the numbers that placed it, best first out of `rankCandidates`. */
export interface RankedCandidate {
  result: LitResult;
  /** Composite: title similarity plus surname/year adjustments, clamped at 0. */
  score: number;
  /**
   * Token-set Dice on folded tokens, 0…1. Reported separately from `score`
   * because the confidence rules key on it directly, not on the composite.
   */
  titleSimilarity: number;
  /** A DOI or arXiv-id hint named this exact record. Sorts ahead of everything. */
  decisive: boolean;
}

/**
 * The provider bookkeeping `resolveStudy` copies into its answer. It is the
 * caller's, not the matcher's: only the caller knows which providers it
 * dispatched to and which of them failed. Passing it is what keeps a 429 from
 * OpenAlex from being mistaken for "no such paper".
 */
export interface StudyResolutionContext {
  providersTried: readonly string[];
  errors: readonly string[];
}

/* ------------------------------------------------------------ normalizing -- */

/**
 * The identity rules below are deliberately the same ones `findExistingKey`
 * (bib-write.ts) uses to decide a work is ALREADY in `references.bib`: DOI,
 * then arXiv id, then folded title. If the two disagreed, `cite_study` could
 * merge two provider records into one candidate and then fail to recognize
 * the entry it wrote for it last week — or the reverse. They are kept
 * side-by-side rather than shared because neither module exports them, and a
 * pure copy of a four-line rule is cheaper to read than a new dependency edge.
 */

/** Bare, `doi:`-prefixed and doi.org-URL shapes all fold to the same string. */
function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
}

/** `arXiv:2401.00001v2`, `2401.00001v2` and `2401.00001` are one paper. */
function normalizeArxivId(id: string): string {
  return id
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/v\d+$/i, '')
    .toLowerCase();
}

function stripArxivPrefix(id: string): string {
  return id.startsWith('arXiv:') ? id.slice('arXiv:'.length) : id;
}

/**
 * The result's arXiv id, derived exactly as `litResultToBibEntry` derives the
 * one it would WRITE — same `detectArxivId` call, same inputs — so the
 * preprint a provider returned and the entry a previous append made from it
 * are recognized as the same work.
 */
function arxivIdOfResult(result: LitResult): string | null {
  const id = detectArxivId({
    eprint: result.source === 'arxiv' ? stripArxivPrefix(result.id) : undefined,
    url: result.openAccessUrl ?? undefined,
    doi: result.doi ?? undefined,
  });
  return id === undefined ? null : normalizeArxivId(id);
}

/**
 * Letters and digits only, diacritics folded — the same ASCII fold
 * `generateCiteKey` (lit-entry.ts) and `resolvePdfPath` (pdf.ts) use, so
 * `Ram-Pressure Stripping!` and `{Ram pressure stripping}` are one string.
 * Deliberately lossy: it is the last-resort identity, used only once both
 * identifiers have come up empty.
 */
function foldTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** LitResult authors are already-joined display names ("Given Family"). */
function familyNameOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? displayName.trim();
}

/* --------------------------------------------------------------- tokens -- */

/**
 * Function words carry no discriminating power in a title, and leaving them in
 * inflates Dice for every candidate equally — "On the infall of matter into
 * clusters of galaxies" and "On the formation of galaxies" would share four
 * tokens on nothing but grammar. Dropped from BOTH sides, so the measure stays
 * symmetric.
 */
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'not', 'of', 'on', 'in', 'into', 'for', 'from',
  'to', 'with', 'without', 'at', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'its',
  'it', 'that', 'this', 'these', 'those', 'their', 'our', 'we', 'us', 'they', 'than', 'then',
  'about', 'above', 'after', 'before', 'between', 'during', 'over', 'under', 'through', 'upon',
  'via', 'per', 'vs', 'versus', 'so', 'such', 'some', 'any', 'all', 'both', 'each', 'more',
  'most', 'other', 'within', 'across', 'against', 'among', 'around', 'near', 'out', 'up',
  'only', 'same', 'too', 'very', 'can', 'will', 'just', 'do', 'does', 'did', 'has', 'have',
  'had', 'may', 'might', 'must', 'should', 'would', 'could',
]);

/**
 * Words about the ACT of citing, not about the paper. "the Gunn & Gott 1972
 * ram-pressure stripping paper" is asking for a paper, and every candidate is
 * one, so `paper` only dilutes the score. Stripped from the mention's free
 * words alone — a candidate title (or a title the user took the trouble to
 * quote) keeps every word it has.
 */
const MENTION_NOISE = new Set([
  'paper', 'papers', 'article', 'articles', 'study', 'studies', 'preprint', 'preprints',
  'publication', 'publications', 'manuscript', 'work', 'works', 'ref', 'refs', 'reference',
  'references', 'cite', 'citation', 'citations', 'find', 'get', 'add', 'please', 'pdf',
  'doi', 'arxiv', 'et', 'al',
]);

/** Folded, deduped, order-preserving tokens; single characters are noise. */
function rawTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const chunk of text.split(/[^\p{L}\p{N}\p{M}]+/u)) {
    const token = foldTitle(chunk);
    if (token.length < 2) continue;
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

function titleTokens(text: string): string[] {
  return rawTokens(text).filter((token) => !TITLE_STOPWORDS.has(token));
}

/**
 * Tokens to compare. A title made entirely of function words ("On Being") would
 * otherwise reduce to nothing and score 0 against itself, so the unfiltered
 * tokens stand in when the filtered set is empty.
 */
function similarityTokens(text: string): string[] {
  const filtered = titleTokens(text);
  return filtered.length === 0 ? rawTokens(text) : filtered;
}

/**
 * Token-set Dice: `2·|A∩B| / (|A|+|B|)`. Both inputs are already deduped, so
 * they are sets. Symmetric, and it punishes a mention that names three words
 * of a twelve-word title — which is correct: three words is not enough to be
 * sure, and the 0.5 floor turns that into `low` rather than a bad guess.
 */
function diceSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const other = new Set(b);
  let shared = 0;
  for (const token of a) {
    if (other.has(token)) shared += 1;
  }
  return (2 * shared) / (a.length + b.length);
}

/* -------------------------------------------------------- parsing mentions -- */

/** `"quoted title"` or `“quoted title”`. Single quotes are apostrophes far too often. */
const QUOTED_TITLE = /"([^"]+)"|“([^”]+)”/;

/**
 * Bare, `doi:`-prefixed, or a doi.org URL — the three shapes prose uses.
 *
 * `<` and `>` are deliberately NOT excluded from the suffix. A DOI's suffix is
 * opaque by definition and the SICI shape Wiley used for its whole 1996–2004
 * back catalogue puts angle brackets in the middle of it
 * (`10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2`, the
 * DOI Handbook's own example). Stopping at the `<` did not merely shorten the
 * identifier: the truncated string became the whole provider query, `1661` was
 * read as the publication year and the remains of the suffix became title
 * words. `trimDoiTail` handles the one case the exclusion was there for — a
 * DOI wrapped in the RFC 3986 angle-bracket form, `<https://doi.org/10.x/y>`.
 */
const DOI_IN_TEXT = /(?:https?:\/\/)?(?:dx\.)?(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"']+)/i;

/** `arXiv:2401.01234v2`, `arXiv 2401.01234`, `arxiv.org/abs/astro-ph/9901234`. */
const ARXIV_IN_TEXT =
  /\barxiv(?:\.org\/(?:abs|pdf)\/|\s*:\s*|\s+)([A-Za-z-]+(?:\.[A-Za-z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/i;

/**
 * A surname run, recognized only where it is ANCHORED — by a connector
 * (`Gunn & Gott`, `Gunn and Gott`, `Smith, Jones, and Brown`), by `et al.`, or
 * by an adjacent year (`Gunn 1972`, `Gunn (1972)`, `Gunn, 1972a`). Without
 * that anchor a capitalized word is just a capitalized word: "Ram-Pressure
 * Stripping in Virgo" must not parse as three authors. Dutch/Romance particles
 * ride along so `de Vaucouleurs` and `van der Waals` stay whole.
 */
const NAME_PARTICLE = String.raw`(?:van|von|de|del|della|da|das|dos|di|du|le|la|den|der|ten|ter)\s+`;
const NAME_TOKEN = String.raw`(?:${NAME_PARTICLE})*\p{Lu}[\p{L}'’]*(?:-\p{Lu}?[\p{L}'’]+)*`;
const YEAR_PATTERN = String.raw`(?:1[6-9]\d{2}|20\d{2})`;
const NAME_CONNECTOR = String.raw`\s*(?:&|,\s*and\b|,|\band\b)\s+`;
const ET_AL = String.raw`\s+et\s+al\.?`;
const YEAR_TAIL = String.raw`\s*[,(\[]?\s*(${YEAR_PATTERN})[a-z]?\s*[)\]]?`;

const NAME_RUN = new RegExp(
  `(${NAME_TOKEN}(?:${NAME_CONNECTOR}${NAME_TOKEN})*)(${ET_AL})?(?:${YEAR_TAIL})?`,
  'gu',
);
const NAME_CONNECTOR_SPLIT = new RegExp(NAME_CONNECTOR, 'gu');
/** Not preceded by a digit or a dot, so `10.1086` and `2401.01234` stay out of it. */
const STANDALONE_YEAR = new RegExp(String.raw`(?<![\d.])${YEAR_PATTERN}(?![\d])`, 'g');

/**
 * Replace a span with spaces of the same length. Blanking rather than deleting
 * keeps every later match index valid, so one pass over the text can extract
 * several hints and still hand the leftovers to the free-word tokenizer.
 */
function blank(text: string, start: number, length: number): string {
  return `${text.slice(0, start)}${' '.repeat(length)}${text.slice(start + length)}`;
}

function findAll(text: string, pattern: RegExp): RegExpExecArray[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);
  const matches: RegExpExecArray[] = [];
  let match = scanner.exec(text);
  while (match !== null) {
    matches.push(match);
    if (match[0] === '') scanner.lastIndex += 1;
    match = scanner.exec(text);
  }
  return matches;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const character of text) {
    if (character === char) count += 1;
  }
  return count;
}

/**
 * A DOI written in prose collects the sentence's punctuation. Trailing stops
 * and quotes always go; a closing bracket goes only when the DOI did not open
 * it, because `10.1002/(SICI)1097-0258` legitimately contains a balanced pair —
 * and so does a SICI's `<1661::AID-SIM968>`, which is why `>` is judged by the
 * same balance rule rather than banned from the suffix outright.
 */
function trimDoiTail(raw: string): string {
  let out = raw;
  for (;;) {
    const stripped = out.replace(/[.,;:!?'"“”‘’]+$/, '');
    const unbalanced =
      (stripped.endsWith(')') && countChar(stripped, ')') > countChar(stripped, '(')) ||
      (stripped.endsWith(']') && countChar(stripped, ']') > countChar(stripped, '[')) ||
      (stripped.endsWith('>') && countChar(stripped, '>') > countChar(stripped, '<'));
    const next = unbalanced ? stripped.slice(0, -1) : stripped;
    if (next === out) return out;
    out = next;
  }
}

/**
 * Read a free-text mention. Each hint is taken out of the text as it is found,
 * so a quoted title's words never become surnames, a DOI's digits never become
 * a year, and what is left over is genuinely free text.
 *
 * Never throws and never guesses: a mention with nothing citable in it comes
 * back as all-null hints and empty lists, which `resolveStudy` then reports as
 * an honest `low`.
 */
export function parseMention(text: string): MentionHints {
  let rest = text;

  let quotedTitle: string | null = null;
  const quoted = QUOTED_TITLE.exec(rest);
  if (quoted !== null) {
    const inner = (quoted[1] ?? quoted[2] ?? '').trim();
    quotedTitle = inner === '' ? null : inner;
    rest = blank(rest, quoted.index, quoted[0].length);
  }

  // One mention names one work, so the first identifier is the hint — but
  // EVERY identifier leaves the text, or a second DOI's digits would come back
  // as free words and drag the title score down.
  let doi: string | null = null;
  for (const found of findAll(rest, DOI_IN_TEXT)) {
    const raw = found[1];
    if (doi === null && raw !== undefined) {
      const trimmed = trimDoiTail(raw);
      if (trimmed !== '') doi = normalizeDoi(trimmed);
    }
    rest = blank(rest, found.index, found[0].length);
  }

  let arxivId: string | null = null;
  for (const found of findAll(rest, ARXIV_IN_TEXT)) {
    const raw = found[1];
    if (arxivId === null && raw !== undefined) {
      const detected = detectArxivId({ eprint: raw });
      if (detected !== undefined) arxivId = normalizeArxivId(detected);
    }
    rest = blank(rest, found.index, found[0].length);
  }
  // 10.48550/arXiv.… is both identifiers at once; the DOI form is authoritative.
  if (arxivId === null && doi !== null) {
    const fromDoi = detectArxivId({ doi });
    if (fromDoi !== undefined) arxivId = normalizeArxivId(fromDoi);
  }

  const surnames: string[] = [];
  let year: number | null = null;
  for (const run of findAll(rest, NAME_RUN)) {
    const names = run[1];
    if (names === undefined) continue;
    const parts = names
      .split(NAME_CONNECTOR_SPLIT)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    const anchored = parts.length > 1 || run[2] !== undefined || run[3] !== undefined;
    if (!anchored) continue;
    for (const part of parts) {
      // A lone initial ("Gunn, J. E.") folds to one letter and names nobody.
      const folded = foldTitle(part);
      if (folded.length >= 2 && !surnames.includes(folded)) surnames.push(folded);
    }
    const runYear = run[3];
    if (year === null && runYear !== undefined) year = Number.parseInt(runYear, 10);
    rest = blank(rest, run.index, run[0].length);
  }

  // A year is metadata about the citation, never a word of its title, so every
  // one of them leaves the free words — quote a title that really needs one.
  for (const found of findAll(rest, STANDALONE_YEAR)) {
    if (year === null) year = Number.parseInt(found[0], 10);
    rest = blank(rest, found.index, found[0].length);
  }

  const freeWords = titleTokens(rest).filter((token) => !MENTION_NOISE.has(token));
  return { doi, arxivId, surnames, year, quotedTitle, freeWords };
}

/* ------------------------------------------------------------- merging -- */

interface MergeBucket {
  result: LitResult;
  /** Folded into another bucket; kept in place so the surviving order is first-seen order. */
  absorbed: boolean;
}

function identityKeys(result: LitResult): string[] {
  const keys: string[] = [];
  const doi = result.doi === null ? '' : normalizeDoi(result.doi);
  if (doi !== '') keys.push(`doi:${doi}`);
  const arxivId = arxivIdOfResult(result);
  if (arxivId !== null && arxivId !== '') keys.push(`arxiv:${arxivId}`);
  const title = foldTitle(result.title);
  if (title !== '') keys.push(`title:${title}`);
  return keys;
}

/**
 * How much a record actually tells us, in the plan's own order of preference:
 * an `openAccessUrl` (the PDF ladder's next step), an abstract, a DOI. The DOI
 * outweighs the rest because it is the only field that also decides identity.
 */
function richness(result: LitResult): number {
  return (
    (result.doi !== null ? 8 : 0) +
    (result.openAccessUrl !== null ? 4 : 0) +
    (result.abstract !== null ? 2 : 0) +
    (result.venue !== null ? 1 : 0) +
    (result.year !== null ? 1 : 0) +
    (result.citedByCount !== null ? 1 : 0) +
    (result.authors.length > 0 ? 1 : 0)
  );
}

/**
 * The richer record wins `source`/`id`/`title` — the fields that say WHICH
 * record this is — and every null it has is filled from the other, so nothing
 * a provider knew is thrown away. A tie keeps the record seen first, which is
 * the caller's own provider order.
 */
function richerOf(a: LitResult, b: LitResult): LitResult {
  const base = richness(b) > richness(a) ? b : a;
  const other = base === a ? b : a;
  return {
    source: base.source,
    id: base.id,
    doi: base.doi ?? other.doi,
    title: base.title,
    authors: base.authors.length > 0 ? base.authors : other.authors,
    year: base.year ?? other.year,
    venue: base.venue ?? other.venue,
    citedByCount: base.citedByCount ?? other.citedByCount,
    openAccessUrl: base.openAccessUrl ?? other.openAccessUrl,
    abstract: base.abstract ?? other.abstract,
  };
}

/**
 * One candidate list out of every provider's answer, deduped on normalized
 * DOI, then arXiv id, then folded title — the same ladder `findExistingKey`
 * climbs. Providers are visited in the caller's own order, and that order is
 * preserved: the first record to claim an identity keeps its place in the
 * list, however many later records merge into it.
 *
 * A record that touches two existing buckets folds them together, which is how
 * an arXiv preprint and its published version end up as one work when a third
 * provider returns both identifiers on one record.
 */
export function mergeCandidates(
  byProvider: Readonly<Record<string, readonly LitResult[]>>,
): LitResult[] {
  const buckets: MergeBucket[] = [];
  const index = new Map<string, MergeBucket>();

  for (const results of Object.values(byProvider)) {
    for (const result of results) {
      const keys = identityKeys(result);
      const hits: MergeBucket[] = [];
      for (const key of keys) {
        const bucket = index.get(key);
        if (bucket !== undefined && !hits.includes(bucket)) hits.push(bucket);
      }

      const first = hits[0];
      if (first === undefined) {
        const bucket: MergeBucket = { result, absorbed: false };
        buckets.push(bucket);
        for (const key of keys) {
          if (!index.has(key)) index.set(key, bucket);
        }
        continue;
      }

      for (const other of hits.slice(1)) {
        first.result = richerOf(first.result, other.result);
        other.absorbed = true;
        for (const [key, bucket] of index) {
          if (bucket === other) index.set(key, first);
        }
      }
      first.result = richerOf(first.result, result);
      for (const key of identityKeys(first.result)) {
        if (!index.has(key)) index.set(key, first);
      }
    }
  }

  return buckets.filter((bucket) => !bucket.absorbed).map((bucket) => bucket.result);
}

/* ------------------------------------------------------------- ranking -- */

/** Title similarity dominates; the adjustments below only ever nudge it. */
const SURNAME_WEIGHT = 0.4;
const YEAR_EXACT_BONUS = 0.2;
/** A preprint and its published version are routinely a year apart. */
const YEAR_NEAR_BONUS = 0.1;
/** Two years or more apart is a different paper, and saying so is the point. */
const YEAR_MISMATCH_PENALTY = 0.2;
/** "Within 10 %": the runner-up scoring at least 90 % of the winner is a tie. */
const AMBIGUITY_RATIO = 0.9;
/** Under this, the title match is too thin to act on — the plan's 0.5 floor. */
const TITLE_FLOOR = 0.5;
/** At or over this (with nothing contradicting it), the match is `high`. */
const TITLE_HIGH = 0.75;

function matchesIdentifierHint(hints: MentionHints, result: LitResult): boolean {
  if (hints.doi !== null) {
    const doi = result.doi === null ? null : normalizeDoi(result.doi);
    if (doi !== null && doi === hints.doi) return true;
  }
  if (hints.arxivId !== null) {
    const arxivId = arxivIdOfResult(result);
    if (arxivId !== null && arxivId === hints.arxivId) return true;
  }
  return false;
}

/**
 * Fraction of the mention's surnames found among the candidate's authors. A
 * folded family name matches outright; a longer surname also matches at the
 * END of a folded full name, which is what lets `van der Waals` meet
 * "Johannes Diderik van der Waals", whose last whitespace-separated token is
 * only "Waals". Anchoring at the end rather than anywhere inside is what keeps
 * `Gott` off "Gottfried Leibniz"; short names are held to the exact rule on
 * top of that, so `Wu` cannot ride in on "Lin Xiaowu".
 */
function surnameOverlap(surnames: readonly string[], authors: readonly string[]): number {
  if (surnames.length === 0) return 0;
  const families = authors.map((author) => foldTitle(familyNameOf(author)));
  const full = authors.map((author) => foldTitle(author));
  let hits = 0;
  for (const surname of surnames) {
    if (families.includes(surname)) {
      hits += 1;
      continue;
    }
    if (surname.length >= 4 && full.some((name) => name.endsWith(surname))) hits += 1;
  }
  return hits / surnames.length;
}

function yearAdjustment(hintYear: number | null, resultYear: number | null): number {
  if (hintYear === null || resultYear === null) return 0;
  const distance = Math.abs(hintYear - resultYear);
  if (distance === 0) return YEAR_EXACT_BONUS;
  if (distance === 1) return YEAR_NEAR_BONUS;
  return -YEAR_MISMATCH_PENALTY;
}

/** Unknown counts sort last: a provider that reports 0 knows more than one that reports nothing. */
function citedBy(result: LitResult): number {
  return result.citedByCount ?? -1;
}

/**
 * The mention's own title words: the quoted title when the user took the
 * trouble to quote one, otherwise the free words. Never both — mixing the
 * surrounding prose back into a quoted title only dilutes the one signal the
 * user was precise about.
 */
function mentionTitleTokens(hints: MentionHints): string[] {
  return hints.quotedTitle !== null ? similarityTokens(hints.quotedTitle) : hints.freeWords;
}

/**
 * Score every candidate, best first.
 *
 * A DOI or arXiv-id hit is flagged `decisive` and sorts ahead of the field —
 * it is an identity, not a similarity, so it deliberately does not compete on
 * points. Everything else is title similarity adjusted by surname overlap and
 * year agreement. `citedByCount` is NOT in the score at all: it breaks ties in
 * the comparator and nowhere else, so a popular paper can never outrank a
 * better title match.
 */
export function rankCandidates(
  hints: MentionHints,
  candidates: readonly LitResult[],
): RankedCandidate[] {
  const wanted = mentionTitleTokens(hints);
  const ranked = candidates.map((result): RankedCandidate => {
    const titleSimilarity = diceSimilarity(wanted, similarityTokens(result.title));
    const adjusted =
      titleSimilarity +
      SURNAME_WEIGHT * surnameOverlap(hints.surnames, result.authors) +
      yearAdjustment(hints.year, result.year);
    return {
      result,
      score: Math.max(0, adjusted),
      titleSimilarity,
      decisive: matchesIdentifierHint(hints, result),
    };
  });

  // Array.prototype.sort is stable, so equal candidates keep provider order.
  ranked.sort((a, b) => {
    if (a.decisive !== b.decisive) return a.decisive ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    if (b.titleSimilarity !== a.titleSimilarity) return b.titleSimilarity - a.titleSimilarity;
    return citedBy(b.result) - citedBy(a.result);
  });
  return ranked;
}

/* ------------------------------------------------------------ resolving -- */

/** Nothing in the mention contradicts the candidate's year. */
function yearAgrees(hintYear: number | null, resultYear: number | null): boolean {
  if (hintYear === null || resultYear === null) return true;
  return Math.abs(hintYear - resultYear) <= 1;
}

/** Nothing in the mention contradicts the candidate's author list. */
function surnamesAgree(surnames: readonly string[], authors: readonly string[]): boolean {
  return surnames.length === 0 || surnameOverlap(surnames, authors) > 0;
}

/**
 * Confidence for a clear winner that no identifier hint named. `high` needs a
 * strong title match AND nothing in the mention arguing against it; a thin
 * title match is `low` however well the authors and year line up, because a
 * mention that never described the paper cannot confirm which paper it is.
 */
function confidenceOf(best: RankedCandidate, hints: MentionHints): MatchConfidence {
  if (best.titleSimilarity < TITLE_FLOOR) return 'low';
  const unopposed =
    yearAgrees(hints.year, best.result.year) && surnamesAgree(hints.surnames, best.result.authors);
  return best.titleSimilarity >= TITLE_HIGH && unopposed ? 'high' : 'medium';
}

/**
 * `StudyResolution.providersTried` and `.errors` are `z.string().min(1)`
 * arrays, so a blank string would make the whole answer fail to parse at the
 * IPC/MCP boundary. Blanks are dropped and repeats collapsed — naming the same
 * provider twice is noise, not information.
 */
function cleanStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed !== '' && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * One mention, one answer — and an honest one.
 *
 *   - An identifier hint that named a candidate wins outright: `high`, with
 *     everything else as alternatives.
 *   - A near-tie (top two within 10 %) refuses to choose: `chosen: null`,
 *     `low`, and EVERY candidate in `alternatives`, best first, so the caller
 *     can show the ambiguity and ask for an explicit DOI. This is the plan's
 *     fifth outcome, `unresolved`; picking the first hit here is exactly the
 *     failure the feature exists to avoid.
 *   - Otherwise the winner is returned with `high`/`medium`/`low` per
 *     `confidenceOf`, and the runners-up follow it in `alternatives`. A `low`
 *     winner is still returned: `find_study` may show it, `cite_study` may not
 *     write it.
 *   - No candidates at all is `chosen: null` and `low` — never an error, since
 *     the reason (a provider that failed vs. a paper that does not exist) is
 *     in `context.errors`, which is copied through untouched.
 *
 * `context` is optional only so the two-argument call in the plan keeps
 * working; every real caller passes it, because a resolution that cannot name
 * the providers it asked cannot be read honestly.
 */
export function resolveStudy(
  hints: MentionHints,
  candidates: readonly LitResult[],
  context?: StudyResolutionContext,
): StudyResolution {
  const providersTried = cleanStrings(context?.providersTried ?? []);
  const errors = cleanStrings(context?.errors ?? []);
  const ranked = rankCandidates(hints, candidates);

  const best = ranked[0];
  if (best === undefined) {
    return { chosen: null, confidence: 'low', alternatives: [], providersTried, errors };
  }
  const runnersUp = ranked.slice(1).map((candidate) => candidate.result);

  if (best.decisive) {
    return {
      chosen: best.result,
      confidence: 'high',
      alternatives: runnersUp,
      providersTried,
      errors,
    };
  }

  const runnerUp = ranked[1];
  const tooClose =
    runnerUp !== undefined && (best.score <= 0 || runnerUp.score >= best.score * AMBIGUITY_RATIO);
  if (tooClose) {
    return {
      chosen: null,
      confidence: 'low',
      alternatives: ranked.map((candidate) => candidate.result),
      providersTried,
      errors,
    };
  }

  return {
    chosen: best.result,
    confidence: confidenceOf(best, hints),
    alternatives: runnersUp,
    providersTried,
    errors,
  };
}
