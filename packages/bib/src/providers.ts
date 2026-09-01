import { LitResultSchema, type LitProviderId, type LitResult } from '@suna/core'

/**
 * Literature providers — the pure fetch/mapping core, dependency-free besides
 * `fetch` (global in both Electron's main process and Node 22+, so this
 * module works unmodified in two hosts):
 *   - the desktop app's main process (apps/desktop/src/main/services/lit.ts
 *     re-exports this module — no renderer CORS/CSP issues that way)
 *   - the standalone MCP server (packages/agent/src/mcp), which runs outside
 *     Electron entirely and needs the exact same provider behavior for its
 *     search_literature / lookup_doi / add_reference tools
 *
 * Every call has an 8s budget and failures come back as a human-readable
 * `error` string — never a thrown exception and never an empty result list
 * pretending nothing matched.
 *
 * Probed 2026-08-14: Crossref works keyless with a polite mailto; OpenAlex
 * answers HTTP 429 ("Insufficient budget…") without budget or a key; arXiv's
 * Atom feed can come back empty from some networks. bioRxiv/medRxiv have no
 * search API of their own — their preprints are searched through Crossref
 * (openRxiv member 54368, posted-content), so that provider is keyless too.
 */

const TIMEOUT_MS = 8_000

export interface LitRequestOptions {
  /** Max results for a search. Ignored by DOI lookups. */
  limit?: number
  /** Provider key from safeStorage, when the user has stored one. */
  apiKey?: string | null
  /** Polite-pool contact address (Crossref, OpenAlex). */
  mailto?: string | null
}

export interface LitSearchOutcome {
  results: LitResult[]
  error: string | null
}

export interface LitLookupOutcome {
  result: LitResult | null
  error: string | null
}

/* ------------------------------------------------------------------ http -- */

interface HttpOk {
  ok: true
  status: number
  text: string
}
interface HttpErr {
  ok: false
  message: string
}

function describeTransportError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return `no response within ${TIMEOUT_MS / 1000}s`
    }
    const cause = (error as { cause?: unknown }).cause
    if (cause instanceof Error && cause.message !== '') return cause.message
    return error.message
  }
  return String(error)
}

async function httpGetText(
  url: string,
  headers: Record<string, string>
): Promise<HttpOk | HttpErr> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    const text = await response.text()
    return { ok: true, status: response.status, text }
  } catch (error) {
    return { ok: false, message: describeTransportError(error) }
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/* ---------------------------------------------------------- unknown readers */

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function firstString(value: unknown): string | null {
  for (const entry of asArray(value)) {
    const text = asString(entry)
    if (text !== null) return text
  }
  return asString(value)
}

/** Collapse whitespace and drop markup a provider may embed in text fields. */
function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep only results that satisfy the shared contract; skip malformed items. */
function collect(candidates: unknown[]): LitResult[] {
  const out: LitResult[] = []
  for (const candidate of candidates) {
    const parsed = LitResultSchema.safeParse(candidate)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

function serverDetail(text: string): string | null {
  const json = asObject(parseJson(text))
  if (json !== null) {
    const message = asString(json['message'])
    const error = asString(json['error'])
    if (error !== null && message !== null) return `${error} — ${message}`
    return message ?? error
  }
  const snippet = plainText(text).slice(0, 200)
  return snippet === '' ? null : snippet
}

/* -------------------------------------------------------------- crossref -- */

const CROSSREF_BASE = 'https://api.crossref.org/works'

function crossrefUserAgent(mailto: string | null): string {
  return mailto === null ? 'SUNA/0.1' : `SUNA/0.1 (mailto:${mailto})`
}

function crossrefHeaders(mailto: string | null): Record<string, string> {
  return { Accept: 'application/json', 'User-Agent': crossrefUserAgent(mailto) }
}

function mapCrossrefItem(item: Record<string, unknown>): Record<string, unknown> {
  const doi = asString(item['DOI'])
  const title = firstString(item['title'])
  const authors: string[] = []
  for (const entry of asArray(item['author'])) {
    const author = asObject(entry)
    if (author === null) continue
    const given = asString(author['given'])
    const family = asString(author['family'])
    const name = [given, family].filter((part) => part !== null).join(' ')
    const display = name === '' ? asString(author['name']) : name
    if (display !== null) authors.push(display)
  }
  const issued = asObject(item['issued'])
  const year = asInt(asArray(asArray(issued?.['date-parts'])[0])[0])
  const abstract = asString(item['abstract'])
  return {
    source: 'crossref',
    id: doi ?? asString(item['URL']) ?? title ?? 'crossref-result',
    doi,
    title: title === null ? '(untitled)' : plainText(title),
    authors,
    year,
    venue: firstString(item['container-title']),
    citedByCount: asInt(item['is-referenced-by-count']),
    openAccessUrl: null,
    abstract: abstract === null ? null : plainText(abstract)
  }
}

function crossrefError(status: number, text: string): string {
  const detail = serverDetail(text)
  const suffix = detail === null ? '' : `: ${detail}`
  if (status === 429) {
    return `Crossref is rate-limiting this machine (HTTP 429)${suffix} — add your email in Settings for the polite pool.`
  }
  return `Crossref request failed (HTTP ${status})${suffix}.`
}

async function crossrefSearch(
  query: string,
  limit: number,
  mailto: string | null
): Promise<LitSearchOutcome> {
  const url = new URL(CROSSREF_BASE)
  // `query.bibliographic` searches title/author/venue rather than every field,
  // and the type filter keeps grant and dataset records — which frequently
  // carry no title at all — out of a literature search.
  url.searchParams.set('query.bibliographic', query)
  url.searchParams.set('filter', 'type:journal-article')
  url.searchParams.set('rows', String(limit))
  if (mailto !== null) url.searchParams.set('mailto', mailto)

  const response = await httpGetText(url.toString(), crossrefHeaders(mailto))
  if (!response.ok) return { results: [], error: `Crossref is unreachable — ${response.message}.` }
  if (response.status !== 200) {
    return { results: [], error: crossrefError(response.status, response.text) }
  }
  const body = asObject(parseJson(response.text))
  if (body === null) return { results: [], error: 'Crossref returned a response SUNA could not read.' }
  const items = asArray(asObject(body['message'])?.['items'])
  return {
    results: collect(items.map((item) => asObject(item)).filter((item) => item !== null).map(mapCrossrefItem)),
    error: null
  }
}

async function crossrefByDoi(
  doi: string,
  mailto: string | null,
  map: (item: Record<string, unknown>) => unknown = mapCrossrefItem
): Promise<LitLookupOutcome> {
  const url = new URL(`${CROSSREF_BASE}/${encodeURIComponent(doi)}`)
  if (mailto !== null) url.searchParams.set('mailto', mailto)
  const response = await httpGetText(url.toString(), crossrefHeaders(mailto))
  if (!response.ok) return { result: null, error: `Crossref is unreachable — ${response.message}.` }
  if (response.status === 404) return { result: null, error: null }
  if (response.status !== 200) {
    return { result: null, error: crossrefError(response.status, response.text) }
  }
  const message = asObject(asObject(parseJson(response.text))?.['message'])
  if (message === null) return { result: null, error: null }
  return { result: collect([map(message)])[0] ?? null, error: null }
}

/* -------------------------------------------------------------- openalex -- */

const OPENALEX_BASE = 'https://api.openalex.org/works'

function openAlexParams(url: URL, mailto: string | null, apiKey: string | null): void {
  if (mailto !== null) url.searchParams.set('mailto', mailto)
  if (apiKey !== null) url.searchParams.set('api_key', apiKey)
}

/** OpenAlex ships abstracts as an inverted index; rebuild the running text. */
function reconstructAbstract(index: unknown): string | null {
  const map = asObject(index)
  if (map === null) return null
  const words: Array<{ position: number; word: string }> = []
  for (const [word, positions] of Object.entries(map)) {
    for (const position of asArray(positions)) {
      const at = asInt(position)
      if (at !== null) words.push({ position: at, word })
    }
  }
  if (words.length === 0) return null
  words.sort((a, b) => a.position - b.position)
  const text = words.map((entry) => entry.word).join(' ').trim()
  return text === '' ? null : text
}

function stripPrefix(value: string | null, prefix: string): string | null {
  if (value === null) return null
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function mapOpenAlexWork(work: Record<string, unknown>): unknown {
  const openAlexId = stripPrefix(asString(work['id']), 'https://openalex.org/')
  const doi = stripPrefix(asString(work['doi']), 'https://doi.org/')
  const title = asString(work['display_name']) ?? asString(work['title'])
  const authors: string[] = []
  for (const entry of asArray(work['authorships'])) {
    const name = asString(asObject(asObject(entry)?.['author'])?.['display_name'])
    if (name !== null) authors.push(name)
  }
  const source = asObject(asObject(work['primary_location'])?.['source'])
  const openAccess = asObject(work['open_access'])
  const bestOa = asObject(work['best_oa_location'])
  return {
    source: 'openalex',
    id: openAlexId ?? doi ?? title ?? 'openalex-result',
    doi,
    title: title === null ? '(untitled)' : plainText(title),
    authors,
    year: asInt(work['publication_year']),
    venue: asString(source?.['display_name']) ?? asString(asObject(work['host_venue'])?.['display_name']),
    citedByCount: asInt(work['cited_by_count']),
    openAccessUrl:
      asString(openAccess?.['oa_url']) ??
      asString(bestOa?.['pdf_url']) ??
      asString(bestOa?.['landing_page_url']),
    abstract: reconstructAbstract(work['abstract_inverted_index'])
  }
}

/** The metered 429 is mapped to a message that names the fix — never swallowed. */
function openAlexError(status: number, text: string): string {
  const detail = serverDetail(text)
  const suffix = detail === null ? '' : `: ${detail}`
  if (status === 429) {
    return `OpenAlex is rate-limited or out of budget (HTTP 429)${suffix} — add an OpenAlex key in Settings, or search with Crossref.`
  }
  if (status === 401 || status === 403) {
    return `OpenAlex rejected the stored key (HTTP ${status})${suffix} — check it in Settings.`
  }
  return `OpenAlex request failed (HTTP ${status})${suffix}.`
}

async function openAlexSearch(
  query: string,
  limit: number,
  mailto: string | null,
  apiKey: string | null
): Promise<LitSearchOutcome> {
  const url = new URL(OPENALEX_BASE)
  url.searchParams.set('search', query)
  url.searchParams.set('per-page', String(limit))
  openAlexParams(url, mailto, apiKey)

  const response = await httpGetText(url.toString(), { Accept: 'application/json' })
  if (!response.ok) return { results: [], error: `OpenAlex is unreachable — ${response.message}.` }
  if (response.status !== 200) {
    return { results: [], error: openAlexError(response.status, response.text) }
  }
  const works = asArray(asObject(parseJson(response.text))?.['results'])
  return {
    results: collect(works.map((work) => asObject(work)).filter((work) => work !== null).map(mapOpenAlexWork)),
    error: null
  }
}

async function openAlexByDoi(
  doi: string,
  mailto: string | null,
  apiKey: string | null
): Promise<LitLookupOutcome> {
  const url = new URL(`${OPENALEX_BASE}/doi:${doi}`)
  openAlexParams(url, mailto, apiKey)
  const response = await httpGetText(url.toString(), { Accept: 'application/json' })
  if (!response.ok) return { result: null, error: `OpenAlex is unreachable — ${response.message}.` }
  if (response.status === 404) return { result: null, error: null }
  if (response.status !== 200) {
    return { result: null, error: openAlexError(response.status, response.text) }
  }
  const work = asObject(parseJson(response.text))
  if (work === null) return { result: null, error: null }
  return { result: collect([mapOpenAlexWork(work)])[0] ?? null, error: null }
}

/* --------------------------------------------------------------- biorxiv -- */

/**
 * bioRxiv and medRxiv publish no text-search API of their own, but every
 * preprint is registered in Crossref as `posted-content` under openRxiv —
 * Crossref member 54368, the nonprofit that took both servers over from
 * Cold Spring Harbor Laboratory (whose old member id 246 retains only a
 * residual handful of works) — so this provider is a keyless Crossref query
 * narrowed to that member, sharing Crossref's polite-pool handling.
 * Verified 2026-08: member 54368 holds ~433k posted-content works and
 * queries return both bioRxiv and medRxiv records.
 */
const BIORXIV_FILTER = 'member:54368,type:posted-content'

/** The registering server name ("bioRxiv" / "medRxiv") — the venue to display. */
function preprintServer(item: Record<string, unknown>): string | null {
  for (const entry of asArray(item['institution'])) {
    const name = asString(asObject(entry)?.['name'])
    if (name !== null) return name
  }
  // Older deposits carry a single institution object or only a group-title.
  return asString(asObject(item['institution'])?.['name']) ?? asString(item['group-title'])
}

/** Same Crossref record shape; posted-content has no container-title, so the
 * venue comes from the registering server name instead. */
function mapBiorxivItem(item: Record<string, unknown>): unknown {
  return { ...mapCrossrefItem(item), source: 'biorxiv', venue: preprintServer(item) }
}

function biorxivError(status: number, text: string): string {
  const detail = serverDetail(text)
  const suffix = detail === null ? '' : `: ${detail}`
  if (status === 429) {
    return `bioRxiv/medRxiv search is rate-limited (Crossref HTTP 429)${suffix} — add your email in Settings for the polite pool.`
  }
  return `bioRxiv/medRxiv search failed (Crossref HTTP ${status})${suffix}.`
}

async function biorxivSearch(
  query: string,
  limit: number,
  mailto: string | null
): Promise<LitSearchOutcome> {
  const url = new URL(CROSSREF_BASE)
  url.searchParams.set('query', query)
  url.searchParams.set('filter', BIORXIV_FILTER)
  url.searchParams.set('rows', String(limit))
  if (mailto !== null) url.searchParams.set('mailto', mailto)

  const response = await httpGetText(url.toString(), crossrefHeaders(mailto))
  if (!response.ok) {
    return { results: [], error: `bioRxiv/medRxiv (via Crossref) is unreachable — ${response.message}.` }
  }
  if (response.status !== 200) {
    return { results: [], error: biorxivError(response.status, response.text) }
  }
  const body = asObject(parseJson(response.text))
  if (body === null) return { results: [], error: 'Crossref returned a response SUNA could not read.' }
  const items = asArray(asObject(body['message'])?.['items'])
  return {
    results: collect(items.map((item) => asObject(item)).filter((item) => item !== null).map(mapBiorxivItem)),
    error: null
  }
}

/* ----------------------------------------------------------------- arxiv -- */

const ARXIV_BASE = 'http://export.arxiv.org/api/query'

function tagText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(block)
  const value = match?.[1]
  return value === undefined ? null : (asString(plainText(value)) ?? null)
}

function tagTexts(block: string, tag: string): string[] {
  const out: string[] = []
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  let match = pattern.exec(block)
  while (match !== null) {
    const value = asString(plainText(match[1] ?? ''))
    if (value !== null) out.push(value)
    match = pattern.exec(block)
  }
  return out
}

function mapArxivEntry(block: string): unknown {
  const rawId = tagText(block, 'id')
  const arxivId = rawId === null ? null : (rawId.split('/abs/')[1] ?? rawId)
  const title = tagText(block, 'title')
  const published = tagText(block, 'published')
  const year = published === null ? null : asInt(published.slice(0, 4))
  return {
    source: 'arxiv',
    id: arxivId === null ? (title ?? 'arxiv-result') : `arXiv:${arxivId}`,
    doi: tagText(block, 'arxiv:doi'),
    title: title === null ? '(untitled)' : title,
    authors: tagTexts(block, 'name'),
    year,
    venue: tagText(block, 'arxiv:journal_ref') ?? 'arXiv',
    citedByCount: null,
    openAccessUrl: rawId,
    abstract: tagText(block, 'summary')
  }
}

/**
 * Best-effort Atom parsing with regex extraction — no XML dependency. A feed we
 * cannot read becomes an error string; this never throws.
 */
function parseArxivFeed(xml: string): LitSearchOutcome {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) ?? []
  if (entries.length === 0) {
    const total = asInt(tagText(xml, 'opensearch:totalResults'))
    if (total === 0) return { results: [], error: null }
    return {
      results: [],
      error: 'arXiv returned no readable entries (its API answers empty from some networks).'
    }
  }
  return { results: collect(entries.map(mapArxivEntry)), error: null }
}

async function arxivSearch(query: string, limit: number): Promise<LitSearchOutcome> {
  const url = new URL(ARXIV_BASE)
  url.searchParams.set('search_query', `all:${query}`)
  url.searchParams.set('start', '0')
  url.searchParams.set('max_results', String(limit))

  const response = await httpGetText(url.toString(), { Accept: 'application/atom+xml' })
  if (!response.ok) return { results: [], error: `arXiv is unreachable — ${response.message}.` }
  if (response.status !== 200) {
    return { results: [], error: `arXiv request failed (HTTP ${response.status}).` }
  }
  try {
    return parseArxivFeed(response.text)
  } catch (error) {
    return {
      results: [],
      error: `arXiv feed could not be parsed — ${error instanceof Error ? error.message : String(error)}.`
    }
  }
}

async function arxivByDoi(doi: string): Promise<LitLookupOutcome> {
  const outcome = await arxivSearch(`"${doi}"`, 1)
  if (outcome.error !== null) return { result: null, error: outcome.error }
  return { result: outcome.results[0] ?? null, error: null }
}

/* ------------------------------------------------------------------ ai-cli -- */

/**
 * Pure parsing for the 'ai-cli' provider (ARCHITECTURE §15.6): a Claude Code
 * or Codex CLI child process, spawned by the main process
 * (apps/desktop/src/main/services/lit.ts — the only place that touches
 * child_process), is prompted to answer with ONLY a JSON array of
 * `{title, authors[], year, venue, doi, url, abstract}`. Everything below is
 * dependency-free (no fetch, no fs, no child_process) so it runs unmodified
 * under plain vitest and inside the bundled main process alike.
 *
 * Ground truth probed 2026-08-14 (ARCHITECTURE §9, plus a live
 * verification run for codex during this build):
 *   - `claude -p "<prompt>" --output-format json --allowed-tools WebSearch`
 *     exits 0 and prints ONE JSON object whose `.result` is a STRING holding
 *     the model's answer; `.is_error` flags a failed turn.
 *   - `codex --ask-for-approval never --sandbox read-only --search exec
 *     --json --skip-git-repo-check -C <dir> --output-last-message <file>
 *     "<prompt>"` exits 0, streams JSONL progress events on stdout, and
 *     writes the model's raw answer text (no envelope) to `<file>`.
 */

export interface AiCliOutcome {
  results: LitResult[]
  error: string | null
}

/** First `n` chars of the model's raw answer — an honest error, never an empty list. */
function firstChars(text: string, n: number): string {
  const trimmed = text.trim()
  if (trimmed === '') return '(empty output)'
  return trimmed.length <= n ? trimmed : `${trimmed.slice(0, n)}…`
}

/** Strip a ```json / ``` fence wrapping the ENTIRE trimmed text, if present. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed)
  return fenced?.[1] !== undefined ? fenced[1].trim() : trimmed
}

function tryParseArray(text: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** The substring from the first `[` to the last `]` — recovers an array the model wrapped in prose. */
function extractBracketedArray(text: string): string | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

/** Raw `{title, authors, year, venue, doi, url, abstract}` -> LitResult, tagged `source: 'ai-cli'`. */
function mapAiCliItem(raw: unknown): unknown {
  const item = asObject(raw)
  if (item === null) return null
  const title = asString(item['title'])
  const doi = asString(item['doi'])
  const authorsField = item['authors']
  const authors = Array.isArray(authorsField)
    ? authorsField.map((entry) => asString(entry)).filter((entry): entry is string => entry !== null)
    : []
  return {
    source: 'ai-cli',
    // no stable provider-native id from a model answer: DOI first, else the title.
    id: doi ?? title ?? 'ai-cli-result',
    doi,
    title: title === null ? '(untitled)' : title,
    authors,
    year: asInt(item['year']),
    venue: asString(item['venue']),
    citedByCount: null,
    openAccessUrl: asString(item['url']),
    abstract: asString(item['abstract'])
  }
}

/**
 * Parse a model's raw text answer into LitResults: tolerates a bare array, a
 * fenced array, and prose wrapped around the array, and drops malformed
 * items rather than failing the whole search — the parse pipeline promised
 * by DECISIONS 2026-08-14.
 */
export function parseAiCliText(text: string): AiCliOutcome {
  const unfenced = stripCodeFence(text)
  let candidates = tryParseArray(unfenced)
  if (candidates === null) {
    const bracketed = extractBracketedArray(unfenced)
    candidates = bracketed === null ? null : tryParseArray(bracketed)
  }
  if (candidates === null) return { results: [], error: firstChars(text, 300) }
  return { results: collect(candidates.map(mapAiCliItem)), error: null }
}

/**
 * Parse `claude -p "<prompt>" --output-format json` stdout. Non-zero exit,
 * unparseable JSON, `is_error: true`, or a `.result` that isn't a parseable
 * array all come back as `{ results: [], error: <first 300 chars> }` —
 * never a silent empty list.
 */
export function parseClaudeCliOutput(stdout: string, stderr: string, exitCode: number): AiCliOutcome {
  if (exitCode !== 0) {
    return { results: [], error: firstChars(stdout !== '' ? stdout : stderr, 300) }
  }
  const envelope = asObject(parseJson(stdout))
  if (envelope === null) {
    return { results: [], error: firstChars(stdout !== '' ? stdout : stderr, 300) }
  }
  if (envelope['is_error'] === true) {
    const message = asString(envelope['result']) ?? stdout
    return { results: [], error: firstChars(message, 300) }
  }
  const result = asString(envelope['result'])
  if (result === null) {
    return { results: [], error: firstChars(stdout, 300) }
  }
  return parseAiCliText(result)
}

/**
 * Parse a `codex exec --output-last-message <file>` run: `lastMessage` is
 * that file's content — the model's raw answer text, with no envelope
 * (verified live 2026-08-14, see module doc above).
 */
export function parseCodexCliOutput(lastMessage: string, stderr: string, exitCode: number): AiCliOutcome {
  if (exitCode !== 0 || lastMessage.trim() === '') {
    return { results: [], error: firstChars(lastMessage !== '' ? lastMessage : stderr, 300) }
  }
  return parseAiCliText(lastMessage)
}

/**
 * Progress ticks from codex's `--json` JSONL event stream, one call per
 * line (verified live 2026-08-14): thread/turn lifecycle plus web_search /
 * agent_message item events. Null for a line with nothing worth surfacing
 * (unparseable, blank, or an event type we don't narrate).
 */
export function codexProgressFromLine(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  const event = asObject(parseJson(trimmed))
  if (event === null) return null
  const type = asString(event['type'])
  const itemType = asString(asObject(event['item'])?.['type'])
  switch (type) {
    case 'thread.started':
      return 'Starting Codex…'
    case 'turn.started':
      return 'Thinking…'
    case 'item.started':
      return itemType === 'web_search' ? 'Searching the web…' : null
    case 'item.completed':
      if (itemType === 'web_search') return 'Reading results…'
      if (itemType === 'agent_message') return 'Compiling results…'
      return null
    case 'turn.completed':
      return 'Finishing…'
    default:
      return null
  }
}

/* ------------------------------------------------------------------- api -- */

function normalizeOptions(options: LitRequestOptions): {
  limit: number
  apiKey: string | null
  mailto: string | null
} {
  const limit = options.limit === undefined ? 20 : Math.max(1, Math.min(100, options.limit))
  const apiKey = options.apiKey === undefined || options.apiKey === null || options.apiKey === '' ? null : options.apiKey
  const mailto = options.mailto === undefined || options.mailto === null || options.mailto === '' ? null : options.mailto
  return { limit, apiKey, mailto }
}

/** Never throws: transport and HTTP failures come back as `error`. */
export async function searchLiterature(
  provider: LitProviderId,
  query: string,
  options: LitRequestOptions = {}
): Promise<LitSearchOutcome> {
  const { limit, apiKey, mailto } = normalizeOptions(options)
  try {
    switch (provider) {
      case 'crossref':
        return await crossrefSearch(query, limit, mailto)
      case 'openalex':
        return await openAlexSearch(query, limit, mailto, apiKey)
      case 'biorxiv':
        return await biorxivSearch(query, limit, mailto)
      case 'arxiv':
        return await arxivSearch(query, limit)
    }
  } catch (error) {
    return { results: [], error: `${provider} search failed — ${describeTransportError(error)}.` }
  }
}

/** Never throws: transport and HTTP failures come back as `error`. */
export async function lookupByDoi(
  provider: LitProviderId,
  doi: string,
  options: LitRequestOptions = {}
): Promise<LitLookupOutcome> {
  const { apiKey, mailto } = normalizeOptions(options)
  try {
    switch (provider) {
      case 'crossref':
        return await crossrefByDoi(doi, mailto)
      case 'openalex':
        return await openAlexByDoi(doi, mailto, apiKey)
      case 'biorxiv':
        // A preprint DOI resolves on the same Crossref endpoint; only the
        // mapping (source tag + server-name venue) differs.
        return await crossrefByDoi(doi, mailto, mapBiorxivItem)
      case 'arxiv':
        return await arxivByDoi(doi)
    }
  } catch (error) {
    return { result: null, error: `${provider} lookup failed — ${describeTransportError(error)}.` }
  }
}
