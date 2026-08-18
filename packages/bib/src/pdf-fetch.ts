import { DEFAULT_LIBRARY_CONFIG, type DownloadPolicy, type LitResult } from '@suna/core';
import { detectArxivId } from './model.js';
import { isPdfBytes, looksLikeHtml } from './pdf-bytes.js';

/**
 * Where a PDF might be, and getting it — feature-plan-10 Layer 2,
 * `pdf-fetch.ts`. Pure URL derivation first (`pdfUrlCandidates` /
 * `citationPdfUrlFromHtml`), then one guarded fetch (`downloadPdf`).
 *
 * This lives in @suna/bib for the same reason providers.ts does: it needs
 * nothing but global `fetch`, so the Electron main process and the standalone
 * MCP server run byte-identical acquisition logic. Nothing here touches the
 * disk — `downloadPdf` hands bytes back and the host decides where they land
 * (Layer 3's `savePdfBytes`, confined to the project root by `resolveInside`).
 *
 * **Never a paywall bypass.** The ladder only visits sources that publish the
 * PDF openly: arXiv, bioRxiv/medRxiv, the record's own open-access URL,
 * Unpaywall's `best_oa_location`, and — under policy 'publisher' only — the
 * publisher's own landing page, read for the `citation_pdf_url` tag the
 * publisher puts there for Google Scholar to index. There is no Sci-Hub, no
 * institutional proxy, no credential or cookie replay, and no retry dressed
 * up as a subscriber. A 403 is reported as a 403 and the ladder moves on.
 *
 * **And never an inward fetch.** Every URL here — the derived candidates, each
 * `Location` hop, Unpaywall's `url_for_pdf`, a page's `citation_pdf_url` — is
 * data supplied by somebody else, so all of it passes `publicHttpUrlRefusal`
 * before a request is made: http(s) only, and never a host that denotes this
 * machine or a private network. See the comment on that function.
 *
 * Failures are strings, never exceptions and never a silent null: when every
 * candidate fails, the error names every URL tried and why each one failed,
 * plus every step that was skipped (the policy gate, or Unpaywall without a
 * contact email). That is the whole point of the ladder — the caller has to
 * be able to say which of feature-plan-10's four outcomes happened, and why.
 *
 * **One budget for the whole call.** `downloadPdf` returns within
 * TOTAL_BUDGET_MS (60 s), full stop. The 20 s hop timeout is a SUB-limit of
 * that, not a multiplier: without a shared deadline, six candidates × two
 * requests × four redirect hops × 20 s is twelve minutes of a wedged
 * `library:acquire-pdf` IPC call or a wedged MCP turn, which is exactly what a
 * server answering every hop at 19 s buys. The deadline is created once at
 * entry to `downloadPdf` and honoured by both loops — the redirect loop inside
 * `httpGet` and the candidate loop — and a caller may pass its own
 * `AbortSignal` to cut the call short earlier still. Running out is an
 * ordinary failure string that names the rungs that never got their turn.
 */

/** One network hop's budget (spec: 20 s per URL), capped by TOTAL_BUDGET_MS. */
const TIMEOUT_MS = 20_000;

/**
 * The ceiling on one whole `downloadPdf` call, shared by every rung and every
 * redirect hop. Six candidates still fit comfortably when servers answer at
 * normal speed; only a stalling ladder ever meets this wall.
 */
const TOTAL_BUDGET_MS = 60_000;

/** Spec: at most 3 redirects, so a redirect loop cannot spin forever. */
const MAX_REDIRECTS = 3;

/** Spec: 50 MB, enforced WHILE streaming — a caller may ask for less. */
export const PDF_MAX_BYTES = 50 * 1024 * 1024;

/** Landing pages and Unpaywall's JSON are text; past this it is not a page. */
const TEXT_MAX_BYTES = 4 * 1024 * 1024;

/** Matches providers.ts, so a publisher sees one identifiable client. */
const USER_AGENT = 'SUNA/0.1';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Which rung of the ladder produced a URL. `'biorxiv'` covers medRxiv too —
 * the two servers share one code path here, exactly as they share the
 * 'biorxiv' provider id in @suna/core.
 */
export const PDF_URL_VIAS = [
  'arxiv',
  'biorxiv',
  'openalex-mirror',
  'open-access-pdf',
  'unpaywall',
  'open-access-landing',
  'doi-landing',
] as const;
export type PdfUrlVia = (typeof PDF_URL_VIAS)[number];

/**
 * How `downloadPdf` must treat the response at a candidate's URL: the bytes
 * themselves, Unpaywall's JSON, or an HTML page to read a `citation_pdf_url`
 * out of. The two indirect kinds cost an extra request, which is why they sit
 * below the direct ones in the ordered list.
 */
export type PdfUrlKind = 'pdf' | 'unpaywall' | 'openalex' | 'landing';

export interface PdfUrlCandidate {
  url: string;
  via: PdfUrlVia;
  kind: PdfUrlKind;
}

export interface PdfUrlPlan {
  /** In the spec's preference order; the first success wins. */
  candidates: PdfUrlCandidate[];
  /**
   * Rungs that were NOT attempted, each saying why. An omitted step is a
   * fact the user needs ("no contact email, so Unpaywall was never asked"),
   * not something to swallow — project doctrine: no silent empty list.
   */
  skipped: string[];
}

export interface PdfFetchOptions {
  /** Defaults to DEFAULT_LIBRARY_CONFIG.download ('publisher', the user's pick). */
  policy?: DownloadPolicy;
  /** Unpaywall's required contact address; absent or null skips that rung. */
  mailto?: string | null;
  /** Stricter than the 50 MB doctrine cap, never looser. */
  maxBytes?: number;
  /**
   * The caller's own cancel, checked alongside the 60 s budget at every rung
   * and every redirect hop: the References view closing, or an MCP turn being
   * abandoned, should not leave a download running to its deadline.
   */
  signal?: AbortSignal | null;
}

/**
 * WHY a download failed, as a value the UI can branch on. Reporting every
 * failure as "download failed" is what makes this feature feel broken when it
 * is being honest: a paper whose only open copy sits behind Cloudflare is a
 * link the user can click and get, while a 1972 paper with no open copy
 * anywhere is not. Those need different sentences.
 *
 *   'refused'      — a host answered 401/403, or served an HTML interstitial
 *                    where the PDF should be. The bytes exist; this route may
 *                    not have them. Offer the URL.
 *   'no-open-copy' — nothing to try, or every aggregator reports no OA
 *                    location. Cite from metadata.
 *   'unreachable'  — transport failure, timeout, or the 60 s budget.
 */
export const PDF_FAILURE_KINDS = ['refused', 'no-open-copy', 'unreachable'] as const;
export type PdfFailureKind = (typeof PDF_FAILURE_KINDS)[number];

export interface PdfDownloadOutcome {
  /** The verified PDF, or null when nothing could be fetched. */
  bytes: Uint8Array | null;
  /** The URL the bytes actually came from, after any redirects. */
  sourceUrl: string | null;
  via: PdfUrlVia | null;
  /** Null on success; on failure it names every URL tried and every skip. */
  error: string | null;
  /** Null on success. On failure, the reason — see PdfFailureKind. */
  failure: PdfFailureKind | null;
  /**
   * Hosts that refused us (401/403/interstitial), so a caller can say WHICH
   * publisher to open by hand. Empty unless `failure` is 'refused'.
   */
  refusedBy: string[];
}

/* ------------------------------------------------------------ url shapes -- */

/** Strip the resolver prefix a provider may have baked into the DOI. */
function normalizeDoi(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/i, '');
  return trimmed === '' ? null : trimmed;
}

function normalizeMailto(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function parseUrl(raw: string | null): URL | null {
  if (raw === null || raw.trim() === '') return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/**
 * The arXiv id hiding in a result, wherever the provider put it: arXiv's own
 * `arXiv:2401.01234` id, an `arxiv.org/abs/…` open-access URL, or the
 * `10.48550/arXiv.…` DOI that Crossref and OpenAlex carry. `detectArxivId`
 * validates the shape, so feeding it a non-arXiv id is harmless.
 */
function arxivIdOf(result: LitResult): string | null {
  return (
    detectArxivId({
      eprint: result.id.replace(/^arxiv:/i, ''),
      archivePrefix: 'arXiv',
      url: result.openAccessUrl ?? undefined,
      doi: result.doi ?? undefined,
    }) ?? null
  );
}

const PREPRINT_HOSTS = /(^|\.)(biorxiv|medrxiv)\.org$/i;

/**
 * bioRxiv and medRxiv serve every version's PDF at the landing URL plus
 * `.full.pdf` (`/content/10.1101/2020.01.01.123456v1` →
 * `/content/10.1101/2020.01.01.123456v1.full.pdf`). Null when the URL is not
 * one of those servers, or is already a PDF — rung 3 owns that case.
 */
function preprintFullPdfUrl(landing: URL): string | null {
  if (!PREPRINT_HOSTS.test(landing.hostname)) return null;
  const path = landing.pathname.replace(/\/+$/, '');
  if (path === '' || /\.pdf$/i.test(path)) return null;
  const out = new URL(landing.toString());
  out.pathname = `${path.replace(/\.full(-text)?$/i, '')}.full.pdf`;
  out.search = '';
  out.hash = '';
  return out.toString();
}

function isPdfUrl(url: URL): boolean {
  return /\.pdf$/i.test(url.pathname);
}

/**
 * An identifier is a PATH SEGMENT, not a URL. DOIs legitimately contain `#`,
 * `?`, `&`, `<` and `>` — SICI-style suffixes such as
 * `10.1002/(SICI)1097-4571(199601)47:1<23::AID-ASI3>3.0.CO;2-#` are ordinary
 * registered DOIs — and `encodeURI` escapes none of `#`, `?` or `&`. Left that
 * way, `10.1234/abc#def` makes everything after the `#` a fragment that `fetch`
 * strips before sending: Unpaywall is asked for `10.1234/abc` WITHOUT its
 * mandatory `email` parameter (its keyless API answers 422), and doi.org
 * resolves `10.1234/abc` — a different work, whose PDF would then be verified
 * and saved under this reference's cite key. `encodeURIComponent` escapes all
 * of them; the `/` separators are kept literal because the resolver reads the
 * prefix/suffix split as structure, and because arXiv's old-style ids
 * (`astro-ph/0601001v1`) are two segments of a real path.
 */
function encodeIdPath(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/');
}

/**
 * The full ordered ladder plus the rungs that were skipped and why —
 * feature-plan-10 Layer 2, `pdf-fetch.ts`:
 *
 *   1. arXiv id            → https://arxiv.org/pdf/<id>
 *   2. bioRxiv/medRxiv     → <landing>.full.pdf
 *   3. openAccessUrl       → when it already ends .pdf
 *   4. Unpaywall           → best_oa_location.url_for_pdf (needs a mailto)
 *   5. openAccessUrl page  → citation_pdf_url
 *   6. https://doi.org/…   → citation_pdf_url  (policy 'publisher' only)
 *
 * Policy 'off' yields no candidates at all. Duplicates are collapsed, so a
 * record whose openAccessUrl is already `https://doi.org/<doi>` is fetched
 * once, not twice.
 */
export function pdfUrlPlan(result: LitResult, options: PdfFetchOptions = {}): PdfUrlPlan {
  const policy = options.policy ?? DEFAULT_LIBRARY_CONFIG.download;
  const mailto = normalizeMailto(options.mailto);
  const candidates: PdfUrlCandidate[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  const add = (candidate: PdfUrlCandidate): void => {
    const fingerprint = `${candidate.kind} ${candidate.url}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    candidates.push(candidate);
  };

  if (policy === 'off') {
    skipped.push("every source: the download policy is 'off'");
    return { candidates, skipped };
  }

  const doi = normalizeDoi(result.doi);
  const openAccess = parseUrl(result.openAccessUrl);

  const arxivId = arxivIdOf(result);
  if (arxivId !== null) {
    // Encoded like the DOI: `detectArxivId` validates the eprint and URL forms
    // against NEW_STYLE/OLD_STYLE, but its `10.48550/arXiv.<rest>` branch
    // returns whatever followed the prefix, so the id can still carry a `#`.
    add({ url: `https://arxiv.org/pdf/${encodeIdPath(arxivId)}`, via: 'arxiv', kind: 'pdf' });
  }

  if (openAccess !== null) {
    const full = preprintFullPdfUrl(openAccess);
    if (full !== null) add({ url: full, via: 'biorxiv', kind: 'pdf' });
  }

  // BEFORE the publisher rungs, deliberately. `result.openAccessUrl` is
  // OpenAlex's `best_oa_location`, which names the publisher for most works —
  // the one host most likely to answer 403. Asking OpenAlex for the FULL
  // `locations[]` list first is what surfaces the arXiv and PubMed Central
  // copies that actually serve bytes (see openAlexMirrorUrls for the probes).
  if (doi !== null) {
    const api = new URL(`https://api.openalex.org/works/doi:${encodeIdPath(doi)}`);
    if (mailto !== null) api.searchParams.set('mailto', mailto);
    add({ url: api.toString(), via: 'openalex-mirror', kind: 'openalex' });
  }

  if (openAccess !== null && isPdfUrl(openAccess)) {
    add({ url: openAccess.toString(), via: 'open-access-pdf', kind: 'pdf' });
  }

  if (doi === null) {
    skipped.push('Unpaywall: it is a DOI service and this record carries no DOI');
  } else if (mailto === null) {
    skipped.push(
      'Unpaywall: its keyless API requires a contact email and none is configured (Settings → contact email)',
    );
  } else {
    // Built through URL/URLSearchParams so the email survives whatever the DOI
    // contains: string interpolation is how the `#` bug got in.
    const api = new URL(`https://api.unpaywall.org/v2/${encodeIdPath(doi)}`);
    api.searchParams.set('email', mailto);
    add({ url: api.toString(), via: 'unpaywall', kind: 'unpaywall' });
  }

  if (openAccess !== null && !isPdfUrl(openAccess)) {
    add({ url: openAccess.toString(), via: 'open-access-landing', kind: 'landing' });
  }

  if (policy !== 'publisher') {
    skipped.push(`the publisher landing page: the download policy is '${policy}'`);
  } else if (doi === null) {
    skipped.push(
      'the publisher landing page: it is reached through https://doi.org/… and this record carries no DOI',
    );
  } else {
    add({ url: `https://doi.org/${encodeIdPath(doi)}`, via: 'doi-landing', kind: 'landing' });
  }

  return { candidates, skipped };
}

/** The ordered candidate list alone; `pdfUrlPlan` also reports the skips. */
export function pdfUrlCandidates(
  result: LitResult,
  options: PdfFetchOptions = {},
): PdfUrlCandidate[] {
  return pdfUrlPlan(result, options).candidates;
}

/* ---------------------------------------------------------- html scraping -- */

/** The handful of entities that actually turn up inside a URL attribute. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#0*39);/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * Attributes of one tag body, lowercased names, first spelling wins. Written
 * as a scan rather than one big regex because attribute ORDER varies in the
 * wild — `content` before `name` is common in publisher templates — and both
 * quote styles (and no quotes at all) occur.
 */
function attributesOf(body: string): Record<string, string> {
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
  const out: Record<string, string> = {};
  let match = pattern.exec(body);
  while (match !== null) {
    const name = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (!(name in out)) out[name] = decodeEntities(value);
    match = pattern.exec(body);
  }
  return out;
}

/**
 * The PDF a landing page points at: `<meta name="citation_pdf_url">` — the
 * Google-Scholar tag, near-universal on publisher and repository pages —
 * falling back to `<link rel="alternate" type="application/pdf">`. Pure: no
 * fetch, no DOM, tolerant of either attribute order and of single, double or
 * absent quotes.
 *
 * A relative href is resolved against `baseUrl`, which must be the page's
 * FINAL url after redirects — `https://doi.org/<doi>` always redirects, and
 * resolving `/content/x.pdf` against doi.org would produce a dead link.
 * Returns null when the page advertises no PDF, or when the href and base
 * together are not a URL.
 */
export function citationPdfUrlFromHtml(html: string, baseUrl: string): string | null {
  const tags = /<(meta|link)\b([^>]*?)\/?\s*>/gi;
  let fromMeta: string | null = null;
  let fromLink: string | null = null;

  let match = tags.exec(html);
  while (match !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    const attributes = attributesOf(match[2] ?? '');
    if (tag === 'meta' && fromMeta === null) {
      const name = (attributes['name'] ?? attributes['property'] ?? '').trim().toLowerCase();
      const content = (attributes['content'] ?? '').trim();
      if (name === 'citation_pdf_url' && content !== '') fromMeta = content;
    } else if (tag === 'link' && fromLink === null) {
      const rel = (attributes['rel'] ?? '').trim().toLowerCase().split(/\s+/);
      const type = (attributes['type'] ?? '').trim().toLowerCase();
      const href = (attributes['href'] ?? '').trim();
      if (rel.includes('alternate') && type === 'application/pdf' && href !== '') fromLink = href;
    }
    match = tags.exec(html);
  }

  const href = fromMeta ?? fromLink;
  if (href === null) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ http -- */

interface HttpBytes {
  ok: true;
  /** The final URL, after redirects — what a relative href resolves against. */
  url: string;
  bytes: Uint8Array;
}
interface HttpFailure {
  ok: false;
  message: string;
  /**
   * The HTTP status, when there was one. Carried so the caller can classify a
   * failure from the STATUS rather than by matching the prose of `message` —
   * "this host refuses scripts" and "there is no free copy" are different
   * facts a user acts on differently, and a substring search for '403' would
   * quietly reclassify the day someone rewords a sentence.
   */
  status?: number;
}
type HttpOutcome = HttpBytes | HttpFailure;

/**
 * The one deadline for a whole `downloadPdf` call. Passed down rather than
 * re-derived, because a per-hop or per-rung timeout multiplies: the point is
 * that six candidates share this, not that each gets one.
 */
interface Budget {
  /** `Date.now()` past which nothing further may be requested. */
  readonly deadline: number;
  /** How long the budget was, for the sentence a user reads. */
  readonly totalMs: number;
  /** The caller's cancel, or null when it did not supply one. */
  readonly signal: AbortSignal | null;
}

function describeDuration(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${Math.max(0, Math.round(ms))}ms`;
}

/** Null while there is still budget left; otherwise why the call must stop. */
function budgetRefusal(budget: Budget): string | null {
  if (budget.signal !== null && budget.signal.aborted) {
    return 'cancelled by the caller';
  }
  if (Date.now() >= budget.deadline) {
    return `the ${describeDuration(budget.totalMs)} budget for the whole download ran out`;
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * An abort has three causes and they are three different facts to whoever
 * reads the report: this hop was slow, the whole call's budget is gone, or the
 * caller cancelled. Only the first is a timeout worth retrying.
 */
function describeAbort(budget: Budget, error: unknown): string {
  if (isAbortError(error)) {
    const stopped = budgetRefusal(budget);
    if (stopped !== null) return stopped;
  }
  return describeTransportError(error);
}

function describeTransportError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return `no response within ${TIMEOUT_MS / 1000}s`;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== '') return cause.message;
    return error.message;
  }
  return String(error);
}

function describeBytes(count: number): string {
  if (count >= 1024 * 1024) return `${Math.round(count / (1024 * 1024))} MB`;
  if (count >= 1024) return `${Math.round(count / 1024)} KB`;
  return `${count} bytes`;
}

/** A refusal is reported as a refusal — this is where the no-bypass rule bites. */
function describeStatus(status: number): string {
  if (status === 403) {
    return 'HTTP 403 — access denied. SUNA reports a paywall, it never tries to defeat one';
  }
  if (status === 401) {
    return 'HTTP 401 — the server wants credentials, which SUNA does not supply';
  }
  if (status === 404) return 'HTTP 404 — no document there';
  if (status === 429) return 'HTTP 429 — the server is rate-limiting this machine';
  return `HTTP ${status}`;
}

async function cancelQuietly(cancellable: { cancel: () => Promise<unknown> }): Promise<void> {
  try {
    await cancellable.cancel();
  } catch {
    // The transfer is already gone; there is nothing left to report.
  }
}

/**
 * Read a body with the cap enforced WHILE streaming: the moment the running
 * total passes `maxBytes` the reader is cancelled, so a hostile or misdeclared
 * 4 GB response costs us `maxBytes` of memory, not 4 GB. Checking the length
 * after the fact would be far too late.
 */
async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  budget: Budget,
): Promise<{ ok: true; bytes: Uint8Array } | HttpFailure> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done === true) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await cancelQuietly(reader);
        return {
          ok: false,
          message: `the body went past the ${describeBytes(maxBytes)} cap (the transfer was aborted mid-stream)`,
        };
      }
      chunks.push(value);
    }
  } catch (error) {
    await cancelQuietly(reader);
    return { ok: false, message: describeAbort(budget, error) };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function resolveLocation(location: string, current: string): string | null {
  try {
    return new URL(location.trim(), current).toString();
  } catch {
    return null;
  }
}

/* --------------------------------------------------- the SSRF perimeter -- */

/**
 * Every URL this module fetches comes from somewhere outside SUNA: a provider
 * record's `openAccessUrl`, Unpaywall's `url_for_pdf`, a `Location` header, a
 * `citation_pdf_url` written by whatever page `https://doi.org/<doi>` happened
 * to redirect to. None of that is trusted input, and the ladder's whole job is
 * to follow it — so without a gate, a landing page can point SUNA at
 * `http://127.0.0.1:9200/` or `http://169.254.169.254/latest/meta-data/` and
 * (if the answer happens to start with `%PDF-`) have an internal service's
 * response written into the user's project as `references/<key>.pdf`. Even
 * without that, the per-URL failure sentences would report the internal
 * endpoint's status back to the agent, which is a port scanner.
 *
 * So: one gate, applied to the START of every request AND to every redirect
 * hop, which is why it lives inside `httpGet` rather than at the call sites.
 * Only `http:`/`https:` pass (this alone rules out `data:`, `blob:` and
 * anything else a runtime may accept), and the host may not be a name or a
 * literal that denotes this machine or a private network.
 *
 * The check is on the URL's host, not on a resolved address: @suna/bib may not
 * import `node:dns` any more than it may import `node:fs`, and a same-host
 * rebind is a far smaller problem than a link that says `127.0.0.1` outright.
 * A rejection is an ordinary failure string, so the ladder simply moves on to
 * the next rung and the report says which URL was refused and why.
 */
function expandIpv6(host: string): number[] | null {
  const halves = host.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const piece of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * The IPv4 ranges that are not the public internet. 0/8, 10/8, 127/8,
 * 169.254/16 (link-local, which is where cloud metadata services live),
 * 172.16/12, 192.168/16 and 100.64/10 (carrier NAT) are the ones an SSRF
 * actually reaches; multicast and reserved space are refused as well because a
 * PDF is never there and letting them through only widens the surface.
 */
function isPrivateIpv4(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(groups: readonly number[]): boolean {
  const first = groups[0] ?? 0;
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  // ::ffff:a.b.c.d and the deprecated ::a.b.c.d both carry an IPv4 address.
  const mapped = groups.slice(0, 5).every((group) => group === 0);
  if (mapped && (groups[5] === 0xffff || groups[5] === 0)) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return isPrivateIpv4(high >> 8, high & 0xff, low >> 8, low & 0xff);
  }
  return false;
}

/** Null when the URL may be fetched; otherwise the sentence explaining the refusal. */
export function publicHttpUrlRefusal(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'SUNA could not read that as a URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `refused: ${url.protocol} is not http(s), and SUNA only fetches over http(s)`;
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return 'refused: the URL names no host';

  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = expandIpv6(host.slice(1, -1));
    if (groups === null) return `refused: ${url.hostname} is not an address SUNA can check`;
    return isPrivateIpv6(groups)
      ? `refused: ${url.hostname} is a loopback, link-local or private address, not a publisher`
      : null;
  }

  const dotted = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (dotted !== null) {
    const octets = dotted.slice(1, 5).map((part) => Number.parseInt(part, 10));
    return isPrivateIpv4(octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0)
      ? `refused: ${host} is a loopback, link-local or private address, not a publisher`
      : null;
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return `refused: ${host} names this machine or this network, not a publisher`;
  }
  return null;
}

/**
 * One GET with the whole guard rail: the SSRF perimeter re-checked at every
 * hop, 20 s per hop WITHIN the caller's shared budget, redirects followed by
 * hand so the 3-hop ceiling is ours and not the runtime's, and a streamed body
 * cap. Never throws — every failure is a sentence a user can act on.
 */
async function httpGet(
  startUrl: string,
  accept: string,
  maxBytes: number,
  budget: Budget,
): Promise<HttpOutcome> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // Checked before each hop, because the 3-hop ceiling alone still lets one
    // request consume four hop timeouts — 80 s of a 60 s call.
    const stopped = budgetRefusal(budget);
    if (stopped !== null) return { ok: false, message: stopped };

    // Every hop, not just the first: a public landing page is free to redirect
    // to 127.0.0.1, and following that hop is the whole vulnerability.
    const refusal = publicHttpUrlRefusal(url);
    if (refusal !== null) return { ok: false, message: refusal };

    const controller = new AbortController();
    // The hop timeout is a sub-limit: whichever of the two runs out first ends
    // this request, so the hops can never add up past the call's deadline.
    const hopMs = Math.max(0, Math.min(TIMEOUT_MS, budget.deadline - Date.now()));
    const timer = setTimeout(() => controller.abort(), hopMs);
    const cancelOnCallerAbort = (): void => controller.abort();
    budget.signal?.addEventListener('abort', cancelOnCallerAbort);
    try {
      const response = await fetch(url, {
        headers: { Accept: accept, 'User-Agent': USER_AGENT },
        redirect: 'manual',
        signal: controller.signal,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        if (response.body !== null) await cancelQuietly(response.body);
        const location = response.headers.get('location');
        if (location === null || location.trim() === '') {
          return { ok: false, message: `HTTP ${response.status} with no Location header` };
        }
        const next = resolveLocation(location, url);
        if (next === null) {
          return {
            ok: false,
            message: `HTTP ${response.status} to a Location SUNA could not read (${location.trim()})`,
          };
        }
        if (hop === MAX_REDIRECTS) {
          return { ok: false, message: `more than ${MAX_REDIRECTS} redirects (next hop was ${next})` };
        }
        url = next;
        continue;
      }

      if (response.status !== 200) {
        return { ok: false, message: describeStatus(response.status), status: response.status };
      }
      const body = response.body;
      if (body === null) return { ok: false, message: 'HTTP 200 with an empty body' };
      const read = await readCapped(body, maxBytes, budget);
      if (!read.ok) return read;
      return { ok: true, url, bytes: read.bytes };
    } catch (error) {
      return { ok: false, message: describeAbort(budget, error) };
    } finally {
      clearTimeout(timer);
      budget.signal?.removeEventListener('abort', cancelOnCallerAbort);
    }
  }
  return { ok: false, message: `more than ${MAX_REDIRECTS} redirects` };
}

/* -------------------------------------------------------------- download -- */

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Unpaywall's answer: `best_oa_location.url_for_pdf`. "This DOI has no open
 * copy" and "the API said something unreadable" are different facts, so they
 * come back as different sentences.
 */
function unpaywallPdfUrl(text: string): { url: string | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { url: null, error: 'Unpaywall returned a response SUNA could not read' };
  }
  const best = asObject(asObject(parsed)?.['best_oa_location']);
  const url = asString(best?.['url_for_pdf']);
  if (url === null) {
    return { url: null, error: 'Unpaywall lists no best_oa_location.url_for_pdf for this DOI' };
  }
  return { url, error: null };
}

/**
 * A PMC id out of any of the landing-page shapes OpenAlex records for a
 * PubMed Central location: `.../articles/PMC3552618`, `.../articles/3463246`
 * (Europe PMC drops the prefix), with or without a trailing slash.
 */
function pmcIdFrom(url: string): string | null {
  const match = /\/articles\/(?:PMC)?(\d+)\b/i.exec(url);
  return match?.[1] === undefined ? null : `PMC${match[1]}`;
}

/**
 * Hosts that serve a PDF to a script without an interstitial. Probed
 * 2026-08-18: europepmc.org and arxiv.org answer 200 `application/pdf` to
 * SUNA's own User-Agent, while the publishers below them (Wiley, MDPI,
 * Elsevier) answer 403 to a current Chrome UA — so this is a reachability
 * ranking, not a preference about who "should" host the paper.
 */
const MIRROR_HOSTS = /(^|\.)(arxiv\.org|europepmc\.org|biorxiv\.org|medrxiv\.org|osti\.gov|zenodo\.org)$/i;

/**
 * Every OA location OpenAlex knows for a work, ordered MIRRORS FIRST.
 *
 * This exists because `best_oa_location` — the one field the ladder used to
 * read — names the PUBLISHER for most works, and the publisher is precisely
 * the host most likely to refuse a script. Probed 2026-08-18 with three
 * specimens:
 *   - MDPI `10.3390/e23010081`: best_oa_location is mdpi.com (HTTP 403), while
 *     `locations[]` also carries `arxiv.org/pdf/2012.11763` — 200, 377 KB.
 *   - eLife `10.7554/eLife.00013` and Cell `10.1016/j.cell.2020.02.052`: every
 *     location has `pdf_url: null`, but each lists a PubMed Central landing
 *     page whose id yields a working Europe PMC PDF (1.4 MB and up).
 *   - Wiley `10.1111/j.1469-8137.2009.03069.x`: the publisher is the ONLY
 *     location and `any_repository_has_fulltext` is false. Nothing to fall
 *     back to — bronze OA, free to read on a page no script can reach. That
 *     specimen is why this function returning an empty list is a real answer
 *     and not a bug.
 *
 * Europe PMC is used rather than ncbi.nlm.nih.gov, which serves HTML to a
 * script at the same `/pdf/` path (probed the same day).
 */
export function openAlexMirrorUrls(text: string): { urls: string[]; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { urls: [], error: 'OpenAlex returned a response SUNA could not read' };
  }
  const work = asObject(parsed);
  if (work === null) return { urls: [], error: 'OpenAlex returned no work record' };

  const mirrors: string[] = [];
  const publishers: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null, into: string[]): void => {
    const url = parseUrl(raw);
    if (url === null || seen.has(url.toString())) return;
    seen.add(url.toString());
    into.push(url.toString());
  };

  const locations = Array.isArray(work['locations']) ? work['locations'] : [];
  for (const entry of locations) {
    const location = asObject(entry);
    if (location === null) continue;
    // A non-OA location is a paywalled copy; following it wastes a rung.
    if (location['is_oa'] !== true) continue;

    const landing = asString(location['landing_page_url']);
    const pdf = asString(location['pdf_url']);

    // A PMC copy almost never carries pdf_url, which is why reading only
    // pdf_url made eLife and Cell look like they had no free copy at all.
    const pmc = landing === null ? null : pmcIdFrom(landing);
    if (pmc !== null) push(`https://europepmc.org/articles/${pmc}?pdf=render`, mirrors);

    if (pdf === null) continue;
    const host = parseUrl(pdf)?.hostname ?? '';
    push(pdf, MIRROR_HOSTS.test(host) ? mirrors : publishers);
  }

  return { urls: [...mirrors, ...publishers], error: null };
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function clampMaxBytes(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return PDF_MAX_BYTES;
  // A caller may be stricter than the 50 MB doctrine cap; it may never be looser.
  return Math.min(PDF_MAX_BYTES, Math.max(1, Math.trunc(requested)));
}

interface Attempt {
  maxBytes: number;
  /** The one deadline shared by every rung and every hop of this call. */
  budget: Budget;
  /** URLs already fetched as PDFs, so a redirect ring is not re-walked. */
  attempted: Set<string>;
  /** One "<url> — <why>" line per URL, in the order they were tried. */
  failures: string[];
  /** Hosts that answered 401/403 — the signal behind a 'refused' verdict. */
  refused: Set<string>;
  /**
   * True once a request failed with NO HTTP status — a transport error, a
   * timeout, the budget, or the SSRF perimeter. A 404, by contrast, is a
   * perfectly reachable server telling us there is no document, which is a
   * fact about the copy and not about the network.
   */
  transport: boolean;
}

/**
 * Fetch one URL and insist it really is a PDF. HTML is checked FIRST because
 * a login wall or a "choose your institution" interstitial served at a .pdf
 * URL is the common failure, and saying so is far more useful than "no %PDF-
 * header".
 */
async function attemptPdf(
  url: string,
  via: PdfUrlVia,
  derivedFrom: string | null,
  attempt: Attempt,
): Promise<PdfDownloadOutcome | null> {
  const label = derivedFrom === null ? url : `${url} (from ${derivedFrom})`;
  if (attempt.attempted.has(url)) {
    attempt.failures.push(`${label} — already tried above`);
    return null;
  }
  attempt.attempted.add(url);

  const read = await httpGet(url, 'application/pdf', attempt.maxBytes, attempt.budget);
  if (!read.ok) {
    if (read.status === 401 || read.status === 403) {
      attempt.refused.add(parseUrl(url)?.hostname ?? url);
    } else if (read.status === undefined) {
      attempt.transport = true;
    }
    attempt.failures.push(`${label} — ${read.message}`);
    return null;
  }
  // A host that answers 200 with an HTML interstitial is refusing us just as
  // surely as one that answers 403 — Cloudflare's "Just a moment…" challenge
  // is a 403, but some publishers serve a login page with a 200. Both mean
  // "the bytes exist and you may not have them this way".
  if (looksLikeHtml(read.bytes)) {
    attempt.refused.add(parseUrl(url)?.hostname ?? url);
    attempt.failures.push(`${label} — the server sent an HTML page, not a PDF`);
    return null;
  }
  if (!isPdfBytes(read.bytes)) {
    attempt.failures.push(`${label} — the body is not a PDF (no %PDF- header)`);
    return null;
  }
  return { bytes: read.bytes, sourceUrl: read.url, via, error: null, failure: null, refusedBy: [] };
}

async function attemptCandidate(
  candidate: PdfUrlCandidate,
  attempt: Attempt,
): Promise<PdfDownloadOutcome | null> {
  switch (candidate.kind) {
    case 'pdf':
      return await attemptPdf(candidate.url, candidate.via, null, attempt);

    case 'unpaywall': {
      const read = await httpGet(
        candidate.url,
        'application/json',
        TEXT_MAX_BYTES,
        attempt.budget,
      );
      if (!read.ok) {
        attempt.failures.push(`${candidate.url} — ${read.message}`);
        return null;
      }
      const answer = unpaywallPdfUrl(decodeText(read.bytes));
      if (answer.url === null) {
        attempt.failures.push(`${candidate.url} — ${answer.error ?? 'no PDF location'}`);
        return null;
      }
      return await attemptPdf(answer.url, candidate.via, candidate.url, attempt);
    }

    case 'openalex': {
      const read = await httpGet(
        candidate.url,
        'application/json',
        TEXT_MAX_BYTES,
        attempt.budget,
      );
      if (!read.ok) {
        attempt.failures.push(`${candidate.url} — ${read.message}`);
        return null;
      }
      const answer = openAlexMirrorUrls(decodeText(read.bytes));
      if (answer.error !== null) {
        attempt.failures.push(`${candidate.url} — ${answer.error}`);
        return null;
      }
      if (answer.urls.length === 0) {
        attempt.failures.push(
          `${candidate.url} — OpenAlex lists no open-access location for this DOI`,
        );
        return null;
      }
      // Unlike every other rung this one yields a LIST, so it walks it: the
      // whole point is that the first mirror may be blocked and the second
      // not. Each miss is recorded by attemptPdf, and the shared budget stops
      // the walk, so a work with many dead locations cannot run long.
      for (const url of answer.urls) {
        const got = await attemptPdf(url, candidate.via, candidate.url, attempt);
        if (got !== null) return got;
        if (budgetRefusal(attempt.budget) !== null) return null;
      }
      return null;
    }

    case 'landing': {
      const read = await httpGet(candidate.url, 'text/html', TEXT_MAX_BYTES, attempt.budget);
      if (!read.ok) {
        attempt.failures.push(`${candidate.url} — ${read.message}`);
        return null;
      }
      // Resolve against read.url, the page we actually landed on.
      const pdfUrl = citationPdfUrlFromHtml(decodeText(read.bytes), read.url);
      if (pdfUrl === null) {
        attempt.failures.push(
          `${candidate.url} — the page carries no citation_pdf_url meta tag and no application/pdf alternate link`,
        );
        return null;
      }
      return await attemptPdf(pdfUrl, candidate.via, candidate.url, attempt);
    }
  }
}

function failureReport(
  result: LitResult,
  derived: number,
  failures: readonly string[],
  skipped: readonly string[],
): string {
  const parts: string[] = [];
  if (failures.length === 0) {
    // "Derived none" and "derived some but never got to fetch them" (a
    // cancel, or the budget running out on the first rung) are different
    // facts; claiming the first when the plan had URLs would be a lie.
    parts.push(
      derived === 0
        ? `No PDF URL could be derived for "${result.title}".`
        : `No PDF could be downloaded for "${result.title}".`,
    );
  } else {
    const count = `${failures.length} URL${failures.length === 1 ? '' : 's'}`;
    parts.push(`No PDF could be downloaded for "${result.title}". Tried ${count}: ${failures.join('; ')}.`);
  }
  if (skipped.length > 0) parts.push(`Not tried: ${skipped.join('; ')}.`);
  return parts.join(' ');
}

/**
 * Walk the ladder and stop at the first URL that yields real PDF bytes.
 *
 * Never throws, and never runs longer than TOTAL_BUDGET_MS (60 s) — one
 * deadline created here and honoured by the candidate loop below AND by the
 * redirect loop inside `httpGet`, plus `options.signal` when the caller wants
 * to cut it shorter. That guarantee is the whole call's, not each URL's.
 *
 * On failure `bytes`, `sourceUrl` and `via` are all explicitly null and
 * `error` names every URL that was tried with the reason it failed, plus every
 * rung that was skipped — including the rungs the budget cut off, so a
 * user who sees "Unpaywall was never asked" always learns why. That is how the
 * agent can say "the publisher answered 403 and no contact email is set"
 * instead of an unexplained "not found".
 */
export async function downloadPdf(
  result: LitResult,
  options: PdfFetchOptions = {},
): Promise<PdfDownloadOutcome> {
  const plan = pdfUrlPlan(result, options);
  const budget: Budget = {
    deadline: Date.now() + TOTAL_BUDGET_MS,
    totalMs: TOTAL_BUDGET_MS,
    signal: options.signal ?? null,
  };
  const attempt: Attempt = {
    maxBytes: clampMaxBytes(options.maxBytes),
    budget,
    attempted: new Set<string>(),
    failures: [],
    refused: new Set<string>(),
    transport: false,
  };
  const skipped = [...plan.skipped];

  for (const [index, candidate] of plan.candidates.entries()) {
    const stopped = budgetRefusal(budget);
    if (stopped !== null) {
      // Named, not dropped: the rungs that never got their turn are exactly
      // the ones the user would otherwise assume had been tried and failed.
      const remaining = plan.candidates.slice(index).map((rung) => rung.url);
      skipped.push(`${remaining.join(', ')}: ${stopped}`);
      break;
    }
    try {
      const outcome = await attemptCandidate(candidate, attempt);
      if (outcome !== null) return outcome;
    } catch (error) {
      // Defence in depth: the helpers above already return their failures.
      attempt.failures.push(`${candidate.url} — ${describeAbort(budget, error)}`);
    }
  }

  const refusedBy = [...attempt.refused];
  return {
    bytes: null,
    sourceUrl: null,
    via: null,
    error: failureReport(result, plan.candidates.length, attempt.failures, skipped),
    failure: failureKind(plan.candidates.length, attempt),
    refusedBy,
  };
}

/**
 * The lead sentence for a failed download, chosen by WHY it failed. The
 * ladder's `error` still follows with every URL tried; this is the part a
 * user reads first and acts on.
 *
 * The distinction is the whole point of PdfFailureKind: "Wiley refused us,
 * here is the link" and "no free copy exists" were previously the same
 * sentence, which made an honest report look like a broken feature.
 */
export function describePdfFailure(outcome: PdfDownloadOutcome): string {
  switch (outcome.failure) {
    case 'refused': {
      const hosts = outcome.refusedBy.length === 0 ? 'the publisher' : outcome.refusedBy.join(', ');
      return `${hosts} refused an automated download — the PDF is free to read there, so open it in a browser and attach it by hand`;
    }
    case 'no-open-copy':
      return 'no open-access copy is listed anywhere — cite it from its metadata';
    case 'unreachable':
      return 'no open copy could be fetched (network, timeout, or the 60s budget)';
    default:
      return 'no PDF could be downloaded';
  }
}

/**
 * Rank the reasons rather than taking the last one: a ladder usually fails
 * several ways at once, and 'refused' is the one the user can act on — it
 * means the PDF is really there and one click away — so a single refusal
 * outranks everything beside it.
 *
 * 'unreachable' requires an actual TRANSPORT failure. A ladder that fetched
 * every page successfully and simply found no PDF — a 404 at the OA url, a
 * landing page with no `citation_pdf_url`, an aggregator listing no location
 * — is 'no-open-copy'. Gunn & Gott 1972 is the specimen: nothing was
 * unreachable, there is just no free copy of a 1972 paper, and "check your
 * network" would send the user after the wrong problem.
 */
function failureKind(_derived: number, attempt: Attempt): PdfFailureKind {
  if (attempt.refused.size > 0) return 'refused';
  if (attempt.transport) return 'unreachable';
  return 'no-open-copy';
}
