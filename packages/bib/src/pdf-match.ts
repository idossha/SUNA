import {
  PDF_EVIDENCE_IDS,
  type LitResult,
  type MatchConfidence,
  type PdfEvidenceId,
} from '@suna/core';
import { detectArxivId } from './model.js';
import { PDF_SAMPLE_BYTES, asciiSample } from './pdf-bytes.js';

/**
 * "Is this file on disk that paper?" — the pure half of the local PDF search
 * (feature-plan-10 §Layer 2, "pdf-match.ts"). The scanner in @suna/agent owns
 * the disk, because `fs` may not be imported here; this module owns the
 * judgement, so the desktop app, the standalone MCP server and these tests all
 * rank candidates through one implementation and cannot drift apart.
 *
 * Evidence comes in two tiers and the tier is what the confidence ladder keys
 * on (the vocabulary itself lives in @suna/core's `PDF_EVIDENCE_IDS`):
 *
 * - **Byte-level** — read out of the file's own leading bytes. Publisher PDFs
 *   carry their XMP metadata packet as UNCOMPRESSED XML (`dc:identifier`,
 *   `dc:title`, `prism:doi`), and Crossref/arXiv stamp the DOI into the first
 *   page's text as well. A raw byte search for the DOI string is therefore
 *   genuinely effective and needs no PDF parser, no zlib and no font tables —
 *   which is the only reason a package forbidden from touching `fs` can verify
 *   a file at all.
 * - **Filename-level** — cheap, available for every candidate, and wrong often
 *   enough (`Gunn 1972` names four papers) that it can never reach `high` on
 *   its own.
 *
 * The ladder, spelled out in `confidenceFor` below, is a hard contract: `high`
 * requires at least one byte-level hit; a filename-only match never exceeds
 * `medium`; a title-words-only filename match is `low`. `low` means the caller
 * reports the ambiguity and does not write.
 */

/* ------------------------------------------------------------- thresholds -- */

/**
 * Share of a title's significant tokens that must appear in the byte sample
 * for `title-in-bytes` (feature-plan-10 §Layer 2). Not 100 %: hyphenation,
 * ligatures and line-broken kerning runs routinely damage a word or two in a
 * PDF's text layer, and the XMP title can be a subtitle-less short form.
 */
export const BYTES_TITLE_TOKEN_RATIO = 0.6;

/**
 * The same share for a filename, held lower on purpose: every filesystem caps
 * a name near 255 bytes and Zotero truncates a long title to fit, so the tail
 * of the title is routinely simply absent. Two tokens minimum keeps a single
 * common word from qualifying.
 */
export const FILENAME_TITLE_TOKEN_RATIO = 0.5;
const FILENAME_TITLE_MIN_TOKENS = 2;

/* ------------------------------------------------------------------ types -- */

export interface PdfCandidate {
  /**
   * Absolute path on this machine, as the host found it. Only the last two
   * segments are ever read: the file's own name, plus its immediate parent for
   * the downloaders that shard a DOI across a directory (`10.1086/151605.pdf`).
   * A root folder's name is not evidence about a file inside it.
   */
  path: string;
  /**
   * The file's leading bytes — the scanner reads the first `PDF_SAMPLE_BYTES`
   * of its best filename candidates and re-scores them (feature-plan-10 §Layer
   * 3 step 3). Explicitly `null` when the file has not been read: the two-pass
   * design means "no bytes yet" is the normal state, not an omission.
   */
  bytesSample?: Uint8Array | null;
  /**
   * Which of Spotlight's full-text (`kMDItemTextContent`) queries matched this
   * file, or explicitly `null` when none did / the host does not use Spotlight.
   *
   * The two are NOT the same evidence, which is the whole reason this is not a
   * boolean. Spotlight is the OS having done the byte read for us, so `'doi'`
   * is exactly `doi-in-bytes` and decides the question on its own; `'title'` is
   * exactly `title-in-bytes`, and a citing paper's reference list, an erratum
   * or a syllabus all carry a title in their text, so it stays `medium` until
   * something else corroborates it. Treating both as decisive would auto-copy
   * a review article into `references/` because it quoted the paper's name.
   */
  spotlightContentHit?: SpotlightContentHit | null;
}

/** Which Spotlight content query matched: the DOI, or the exact title. */
export type SpotlightContentHit = 'doi' | 'title';

export interface PdfCandidateScore {
  /** Always non-empty, always in `PDF_EVIDENCE_IDS` order so output is stable. */
  evidence: PdfEvidenceId[];
  confidence: MatchConfidence;
}

/**
 * A scored candidate, best first. Deliberately `PdfMatch` minus `sizeBytes`:
 * the host stat()s the file and adds that one field to build the
 * `PdfMatchSchema` value the MCP verbs and the References view consume.
 */
export interface RankedPdfCandidate extends PdfCandidateScore {
  path: string;
}

/* ------------------------------------------------------------------ text --- */

/**
 * ASCII-fold and lowercase while keeping every separator in place — unlike
 * `pdf.ts`'s `fold`, which strips whitespace, because here the gaps between
 * words are what the word-boundary checks below are made of.
 */
function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[đĐ]/g, 'd')
    .replace(/[łŁ]/g, 'l')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/ß/g, 'ss')
    .toLowerCase();
}

/**
 * Folded, with every run of non-alphanumerics collapsed to a single '-'. This
 * is what makes the filename rules indifferent to the separator a downloader
 * chose: `10.1086_151605`, `10.1086-151605` and the directory form
 * `10.1086/151605` all become `10-1086-151605`.
 */
function slug(text: string): string {
  return foldText(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Folded with every separator removed: `van der Waals` → `vanderwaals`. */
function compact(text: string): string {
  return foldText(text).replace(/[^a-z0-9]+/g, '');
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isLetter(char: string | undefined): boolean {
  return char !== undefined && char >= 'a' && char <= 'z';
}

/**
 * `needle` occurs in `haystack` without a digit butting against either end —
 * so the DOI `10.1086/1516` does not match a file named for `10.1086/151605`,
 * and the arXiv id `2401.01234` does not match `2401.012345`. Letters may
 * follow (`2401.01234v2` is the same preprint, one version later).
 */
function includesIdentifier(haystack: string, needle: string): boolean {
  if (needle === '') return false;
  for (let from = 0; ; from += 1) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    if (!isDigit(haystack[at - 1]) && !isDigit(haystack[at + needle.length])) return true;
    from = at;
  }
}

/**
 * `needle` occurs in `haystack` as a whole word — no letter on either side, so
 * "gunn" does not match "gunning". Digits may abut it, because the citekey form
 * `gunn1972infall` runs the surname, the year and a title word together with no
 * separator at all.
 */
function includesWord(haystack: string, needle: string): boolean {
  if (needle === '') return false;
  for (let from = 0; ; from += 1) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    if (!isLetter(haystack[at - 1]) && !isLetter(haystack[at + needle.length])) return true;
    from = at;
  }
}

/**
 * Title words that carry identity. The stopword list is the one from
 * `lit-entry.ts` (which builds cite keys from the same idea) plus the
 * connectives that survive into filenames; anything under three characters
 * goes too, which also drops the stray digits left by a title like `z = 2.32`.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'on',
  'in',
  'for',
  'and',
  'to',
  'with',
  'from',
  'at',
  'by',
  'is',
  'as',
  'into',
  'its',
  'via',
  'their',
  'that',
  'this',
  'are',
  'new',
  'using',
  'toward',
  'towards',
]);

function titleTokens(title: string): string[] {
  const tokens = new Set<string>();
  for (const token of foldText(title).split(/[^a-z0-9]+/)) {
    if (token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return [...tokens];
}

function countPresent(tokens: readonly string[], haystack: string): number {
  let hits = 0;
  for (const token of tokens) {
    if (includesWord(haystack, token)) hits += 1;
  }
  return hits;
}

/* ------------------------------------------------------------ identifiers -- */

/**
 * A DOI reduced to its bare `10.xxxx/suffix` form and lowercased (DOIs are
 * case-insensitive by definition). Anything that is not shaped like a DOI is
 * rejected outright rather than matched loosely — a two-character prefix would
 * turn into a substring that hits half the library.
 */
function normalizeDoi(doi: string | null): string | null {
  if (doi === null) return null;
  const bare = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(bare) ? bare : null;
}

function stripArxivPrefix(id: string): string {
  return id.replace(/^arxiv:\s*/i, '');
}

/**
 * The arXiv id this result denotes, version suffix removed so `2401.01234v2`
 * on disk answers for `2401.01234` in the metadata and the other way round.
 * Sourced exactly as `lit-entry.ts` does it, so the id that ends up in the
 * BibTeX entry and the id we match a file against are always the same one.
 */
function arxivIdOf(result: LitResult): string | null {
  const detected = detectArxivId({
    eprint: result.source === 'arxiv' ? stripArxivPrefix(result.id) : undefined,
    url: result.openAccessUrl ?? undefined,
    doi: result.doi ?? undefined,
  });
  if (detected === undefined) return null;
  return detected.replace(/v\d+$/, '').toLowerCase();
}

/** Lowercase name particles that belong to the surname, not to the given names. */
const NAME_PARTICLES = new Set([
  'van',
  'von',
  'de',
  'del',
  'della',
  'den',
  'der',
  'di',
  'da',
  'das',
  'dos',
  'du',
  'la',
  'le',
  'ten',
  'ter',
  'bin',
  'ibn',
  'al',
]);

/**
 * Ways the first author's surname can show up in a filename. `LitResult`
 * authors are already-joined display names ("Johannes van der Waals"), so the
 * last token is the usual answer — but a downloader may have written the
 * particles too, and Zotero certainly does, so `vanderwaals` is offered
 * alongside `waals`.
 */
function surnameNeedles(displayName: string): string[] {
  const parts = displayName.trim().split(/\s+/).filter((part) => part !== '');
  const last = parts[parts.length - 1];
  if (last === undefined) return [];

  const needles = new Set<string>();
  const bare = compact(last);
  if (bare !== '') needles.add(bare);

  let start = parts.length - 1;
  while (start > 0) {
    const previous = parts[start - 1];
    if (previous === undefined || !NAME_PARTICLES.has(previous.toLowerCase())) break;
    start -= 1;
  }
  if (start < parts.length - 1) {
    const joined = compact(parts.slice(start).join(''));
    if (joined !== '') needles.add(joined);
  }
  return [...needles];
}

/* ----------------------------------------------------------------- paths --- */

/** The last `count` segments of a path, POSIX- and Windows-separated alike. */
function pathTail(path: string, count: number): string {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '');
  return parts.slice(Math.max(0, parts.length - count)).join('/');
}

/** Drop a trailing `.pdf` so the extension cannot pose as a title word. */
function stripPdfExtension(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

/* --------------------------------------------------------------- scoring -- */

/**
 * The confidence ladder, and the reasoning behind each rung:
 *
 * - a DOI or an arXiv id read out of the file's own bytes names this exact
 *   work — nothing else is needed, and nothing weaker can substitute;
 * - a Spotlight hit on the DOI query is the same read, performed by the OS
 *   indexer (its title query is graded as `title-in-bytes`, one rung down —
 *   see `PdfCandidate.spotlightContentHit`);
 * - a title carried in the bytes is strong but not decisive on its own (an
 *   erratum, a reply, a citing paper's reference list can all carry it), so it
 *   reaches `high` only with corroboration from the name and is `medium` alone;
 * - everything filename-only stops at `medium`, however specific it looks,
 *   because a name is a claim by whoever saved the file;
 * - title words in a filename and nothing else is `low` — reportable, never
 *   actionable without the user.
 */
function confidenceFor(evidence: ReadonlySet<PdfEvidenceId>): MatchConfidence {
  if (
    evidence.has('doi-in-bytes') ||
    evidence.has('arxiv-id-in-bytes') ||
    evidence.has('spotlight-content-hit')
  ) {
    return 'high';
  }
  if (evidence.has('title-in-bytes')) return evidence.size > 1 ? 'high' : 'medium';
  if (
    evidence.has('filename-doi') ||
    evidence.has('filename-arxiv-id') ||
    evidence.has('filename-author-year')
  ) {
    return 'medium';
  }
  return 'low';
}

function orderEvidence(evidence: ReadonlySet<PdfEvidenceId>): PdfEvidenceId[] {
  return PDF_EVIDENCE_IDS.filter((id) => evidence.has(id));
}

/**
 * What this file says about being that paper, or `null` when it says nothing.
 *
 * `null` is not an error and not a failure — it is the honest answer "no rule
 * matched", which is why the caller drops the candidate rather than reporting
 * it with an empty evidence list (`PdfMatchSchema` rejects one: a match with no
 * evidence is a guess, and guesses are not returned).
 *
 * Filename rules run always; byte rules run only when the host supplied
 * `bytesSample`, which is the two-pass design of the scanner — score every
 * `.pdf` in the roots cheaply, then read the leading bytes of the few that
 * looked plausible and score those again for a verdict that can reach `high`.
 */
export function scorePdfCandidate(
  result: LitResult,
  candidate: PdfCandidate,
): PdfCandidateScore | null {
  const doi = normalizeDoi(result.doi);
  const arxivId = arxivIdOf(result);
  const tokens = titleTokens(result.title);

  const evidence = new Set<PdfEvidenceId>();

  // Identifiers may live in the parent directory; names, years and titles may not.
  const identifierName = slug(stripPdfExtension(pathTail(candidate.path, 2)));
  const fileName = slug(stripPdfExtension(pathTail(candidate.path, 1)));
  const fileNameCompact = compact(fileName);

  if (doi !== null && includesIdentifier(identifierName, slug(doi))) {
    evidence.add('filename-doi');
  }
  if (arxivId !== null && includesIdentifier(identifierName, slug(arxivId))) {
    evidence.add('filename-arxiv-id');
  }

  const firstAuthor = result.authors[0];
  if (firstAuthor !== undefined && result.year !== null) {
    const surnameHit = surnameNeedles(firstAuthor).some(
      (needle) => includesWord(fileName, needle) || includesWord(fileNameCompact, needle),
    );
    if (surnameHit && includesIdentifier(fileName, String(result.year))) {
      evidence.add('filename-author-year');
    }
  }

  if (tokens.length > 0) {
    const hits = countPresent(tokens, fileName);
    const enough = tokens.length === 1 ? hits === 1 : hits >= FILENAME_TITLE_MIN_TOKENS;
    if (enough && hits / tokens.length >= FILENAME_TITLE_TOKEN_RATIO) {
      evidence.add('filename-title-words');
    }
  }

  const sample = candidate.bytesSample;
  if (sample !== undefined && sample !== null && sample.length > 0) {
    const bytes = foldText(asciiSample(sample, PDF_SAMPLE_BYTES));
    if (doi !== null && includesIdentifier(bytes, doi)) evidence.add('doi-in-bytes');
    if (arxivId !== null && includesIdentifier(bytes, arxivId)) evidence.add('arxiv-id-in-bytes');
    if (tokens.length > 0) {
      const hits = countPresent(tokens, bytes);
      if (hits / tokens.length >= BYTES_TITLE_TOKEN_RATIO) evidence.add('title-in-bytes');
    }
  }

  // Spotlight's index read the bytes for us — but only the DOI query names the
  // work. The title query is the same fact as `title-in-bytes` and is graded
  // like it, corroboration and all.
  if (candidate.spotlightContentHit === 'doi') evidence.add('spotlight-content-hit');
  else if (candidate.spotlightContentHit === 'title') evidence.add('title-in-bytes');

  if (evidence.size === 0) return null;
  return { evidence: orderEvidence(evidence), confidence: confidenceFor(evidence) };
}

/**
 * Ordering weight per evidence id. Only ever compared within one confidence
 * tier — the tier always wins first, so no amount of filename evidence can
 * float a candidate past one the bytes confirmed.
 */
const EVIDENCE_WEIGHT: Record<PdfEvidenceId, number> = {
  'doi-in-bytes': 100,
  'arxiv-id-in-bytes': 90,
  'spotlight-content-hit': 70,
  'title-in-bytes': 45,
  'filename-doi': 40,
  'filename-arxiv-id': 36,
  'filename-author-year': 18,
  'filename-title-words': 10,
};

const CONFIDENCE_RANK: Record<MatchConfidence, number> = { high: 2, medium: 1, low: 0 };

function weigh(evidence: readonly PdfEvidenceId[]): number {
  let total = 0;
  for (const id of evidence) total += EVIDENCE_WEIGHT[id];
  return total;
}

/**
 * Every candidate that matched, best first: confidence tier, then summed
 * evidence weight, then path — the last so that two equally-evidenced files
 * come back in the same order whatever sequence the directory walk handed them
 * over in, which is what makes the scanner's output reproducible.
 *
 * Candidates that matched nothing are dropped, so an empty array means "no file
 * on this machine looks like this paper". That is a real answer, not a swallowed
 * failure: the scanner reports the roots it searched alongside it, and the
 * `metadata-only` outcome is what the caller falls back to.
 */
export function rankPdfCandidates(
  result: LitResult,
  candidates: readonly PdfCandidate[],
): RankedPdfCandidate[] {
  const scored: { entry: RankedPdfCandidate; weight: number }[] = [];
  for (const candidate of candidates) {
    const score = scorePdfCandidate(result, candidate);
    if (score === null) continue;
    scored.push({
      entry: { path: candidate.path, confidence: score.confidence, evidence: score.evidence },
      weight: weigh(score.evidence),
    });
  }

  scored.sort((a, b) => {
    const tier = CONFIDENCE_RANK[b.entry.confidence] - CONFIDENCE_RANK[a.entry.confidence];
    if (tier !== 0) return tier;
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (a.entry.path < b.entry.path) return -1;
    if (a.entry.path > b.entry.path) return 1;
    return 0;
  });

  return scored.map((item) => item.entry);
}
