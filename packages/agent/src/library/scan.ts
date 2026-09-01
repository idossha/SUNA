import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  copyFile,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  PDF_SAMPLE_BYTES,
  isPdfBytes,
  rankPdfCandidates,
  type PdfCandidate,
  type SpotlightContentHit
} from '@suna/bib'
import type { LibraryConfig, LitResult, PdfAcquisition, PdfMatch } from '@suna/core'
import { resolveInside } from '../mcp/project'
import { describeExternalError, errorCode, expandRoots, quoteExternalPath } from './config'

/**
 * The disk half of study acquisition (ARCHITECTURE §15.5, "scan.ts").
 * It lives here rather than in @suna/bib because it touches `fs` and
 * `child_process`, which that package is forbidden; the *judgement* — is this
 * file that paper? — stays in @suna/bib's `scorePdfCandidate`, so the desktop
 * app and the standalone MCP server rank the same files the same way.
 *
 * The security boundary the plan states plainly, restated where it is enforced:
 *
 * - **Reads leave the project, writes never do.** `findLocalPdf` reads only
 *   inside the roots the user configured, and it is strictly read-only: it
 *   copies nothing and executes nothing it finds. A PDF is bytes to be
 *   pattern-matched, never something to run or parse as code.
 * - **That root boundary is CHECKED, not assumed** (`insideRoots`). The walk
 *   is confined by construction, but a Spotlight hit is somebody else's
 *   answer: `mdfind -onlyin` is a request rather than a guarantee, and
 *   `SpotlightRunner` is an injectable seam. Since `PdfMatch.path` is
 *   documented as "always inside a configured root" and is then opened, read,
 *   returned over IPC and handed to `importPdfIntoProject`, every candidate —
 *   walked or indexed — is re-checked against the realpath-resolved roots
 *   before a single byte of it is read, and a stray one is dropped with a note.
 *   The candidate is realpath-resolved too (`normalizeCandidate`), so a
 *   symlink *inside* a root cannot carry the read to a target outside one, and
 *   only a regular file is ever opened (`notRegularNote`).
 * - **Everything found on disk is DATA, never instructions** — see
 *   `quoteExternalPath` (config.ts, re-exported below), through which every
 *   path this module interpolates into a note travels: the name of a file
 *   somebody else put on disk, and the library roots alike. The roots come
 *   from the user's own library.json and so are not the third-party channel
 *   the quoting exists for, but they are paths like any other and are quoted
 *   too, so the rule has no exception that a later reader has to remember (or,
 *   having forgotten it, copy). That last sentence was not true four review
 *   passes running, which is why it is now checked by
 *   `external-paths.test.ts` rather than asserted here.
 * - `importPdfIntoProject` and `savePdfBytes` resolve their destination
 *   through `resolveInside`, the same confinement gate every manuscript verb
 *   uses, so an attacker-supplied cite key cannot write outside the project —
 *   and then re-assert it against the filesystem with `realpath`, because
 *   `resolveInside` is a string comparison and a symlinked `references/` walks
 *   straight through it (see `prepareReferencesDir`).
 * - `mdfind` is invoked through `execFile` with an **argv array** and no
 *   shell, so a title containing quotes, backticks or `$(…)` is inert. What
 *   is still escaped below is mdfind's *own* query language, not the shell's.
 * - Copies, never moves: the file in the user's library is left untouched.
 * - Never overwrite: an existing `references/<key>.pdf` is reported back as
 *   `already-present`, never replaced.
 */

/* ---------------------------------------------------------------- limits -- */

/** Per-query Spotlight budget (ARCHITECTURE §15.5). */
export const SPOTLIGHT_TIMEOUT_MS = 5_000

/** Hits kept per Spotlight query; the rest are a note, not silence. */
export const SPOTLIGHT_MAX_RESULTS = 200

/**
 * How many of the filename-ranked candidates get their leading bytes read.
 * The whole point of the two-pass design is that reading is expensive and
 * naming is free: a dozen reads of 256 KB is milliseconds, reading every PDF
 * in ~/Downloads is not.
 */
export const BYTE_READ_CANDIDATES = 12

/**
 * Directories the walk never enters. `Caches` is matched only under
 * `Library` — the macOS cache tree the plan names — because a user's own
 * folder called "Caches" may well hold papers.
 */
export const WALK_SKIP_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  '.Trash',
  '.venv',
  '__pycache__'
]

/** stdout ceiling for one `mdfind` run; 200 paths never come close. */
const MDFIND_MAX_BUFFER = 4 * 1024 * 1024

/** Project-relative home of reference PDFs, matching @suna/bib's `resolvePdfPath`. */
const REFERENCES_DIR = 'references'

/* ---------------------------------------------------- outside paths as data -- */

/**
 * The two escapers every note in this module goes through live in config.ts —
 * the lowest module of this layer, because `expandRoots`'s own notes name
 * paths too and importing scan.ts from there would be a cycle. They are
 * re-exported here because this is where the package index and the desktop
 * host have always taken `quoteExternalPath` from, and because this module is
 * where the rule is most load-bearing.
 *
 * BOTH of them, and that is the point. For a while only `quoteExternalPath`
 * made it out of the package, so the desktop host — which has the same notes,
 * the same trust class and the same readers — could reach the path escaper
 * but not the error one, and kept a local `describeError` instead. An escaper
 * that half the callers cannot import is a rule half the callers cannot obey.
 *
 * `external-paths.test.ts` reads this file's source and fails when a
 * path-bearing expression is interpolated without one of them.
 */
export { describeExternalError, quoteExternalPath }

/* ------------------------------------------------------------- spotlight -- */

export interface SpotlightOutcome {
  /** Absolute paths mdfind printed; empty is a real answer, not a failure. */
  paths: string[]
  /**
   * False only when `mdfind` itself is not on this machine. The scanner stops
   * asking after that instead of repeating one note per root × query.
   */
  available: boolean
  /** Human-readable reason this query produced nothing usable, or null. */
  error: string | null
}

/**
 * How the scanner runs Spotlight. Injectable so the tests exercise the
 * scanner's own logic on a machine without an index — and so a host that
 * already has a better catalogue can supply it.
 */
export type SpotlightRunner = (
  args: readonly string[],
  timeoutMs: number
) => Promise<SpotlightOutcome>

const execFileAsync = promisify(execFile)

/** Split mdfind's `-0` output; anything that is not an absolute path is noise. */
function parseMdfindOutput(stdout: string): string[] {
  return stdout.split('\0').filter((path) => path.startsWith('/'))
}

/**
 * The real Spotlight runner: `execFile('mdfind', argv)` — an argv array, never
 * a shell string, so no part of a paper's title can become a command.
 */
export async function runMdfind(
  args: readonly string[],
  timeoutMs: number = SPOTLIGHT_TIMEOUT_MS
): Promise<SpotlightOutcome> {
  try {
    const { stdout } = await execFileAsync('mdfind', [...args], {
      timeout: timeoutMs,
      maxBuffer: MDFIND_MAX_BUFFER,
      encoding: 'utf8',
      windowsHide: true
    })
    return { paths: parseMdfindOutput(stdout), available: true, error: null }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') {
      return { paths: [], available: false, error: 'mdfind is not available on this machine' }
    }
    const killed =
      typeof error === 'object' && error !== null && (error as { killed?: unknown }).killed === true
    if (code === 'ETIMEDOUT' || killed) {
      return { paths: [], available: true, error: `mdfind timed out after ${timeoutMs} ms` }
    }
    return { paths: [], available: true, error: describeExternalError(error) }
  }
}

/**
 * Quote a value into an mdfind query literal.
 *
 * `execFile` already made the shell irrelevant; what is left is mdfind's own
 * grammar, where an unescaped `"` or `\` ends the literal early and `*`/`?`
 * are wildcards. Quotes and backslashes are escaped; wildcards and control
 * characters become spaces. Dropping a `*` is lossy on purpose: a Spotlight
 * hit is only ever a *candidate*, and every candidate is re-scored by
 * `scorePdfCandidate` afterwards, so a slightly wider query costs nothing and
 * a malformed one costs the whole result.
 */
function quoteSpotlightValue(value: string): string {
  return value
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[\\"]/g, (char) => `\\${char}`)
    .replace(/[*?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Family name of the first author; display names arrive as "Given Family". */
function firstSurname(result: LitResult): string {
  const first = result.authors[0]
  if (first === undefined) return ''
  const parts = first.trim().split(/\s+/)
  const last = parts[parts.length - 1]
  return (last ?? '').replace(/[.,;:]+$/, '')
}

interface SpotlightQuery {
  query: string
  /**
   * Which byte-level evidence a hit on this query IS, or null for the filename
   * query, whose hits carry no evidence of their own and are scored by name
   * like any other candidate.
   *
   * The DOI and title queries both read `kMDItemTextContent` — Spotlight's
   * index did the byte read for us — but they are not the same fact, so they
   * are not reported as the same evidence: the DOI names the work, while a
   * title turns up verbatim in every paper that cites it. `scorePdfCandidate`
   * grades the two accordingly (`spotlight-content-hit` vs `title-in-bytes`).
   */
  hit: SpotlightContentHit | null
}

/** The three queries of ARCHITECTURE §15.5, in that order. */
function spotlightQueries(result: LitResult): SpotlightQuery[] {
  const queries: SpotlightQuery[] = []

  const doi = quoteSpotlightValue(result.doi ?? '')
  if (doi !== '') {
    queries.push({
      query: `kMDItemContentType == "com.adobe.pdf" && kMDItemTextContent == "${doi}"`,
      hit: 'doi'
    })
  }

  const title = quoteSpotlightValue(result.title)
  if (title !== '') {
    queries.push({
      query: `kMDItemContentType == "com.adobe.pdf" && kMDItemTextContent == "${title}"`,
      hit: 'title'
    })
  }

  const surname = quoteSpotlightValue(firstSurname(result))
  if (surname !== '' && result.year !== null) {
    queries.push({
      query: `kMDItemFSName == "*${surname}*${result.year}*"cd`,
      hit: null
    })
  }

  return queries
}

/* ------------------------------------------------------------------ walk -- */

function isPdfName(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf')
}

function shouldSkipDir(name: string, parentName: string): boolean {
  if (WALK_SKIP_DIRS.includes(name)) return true
  return name === 'Caches' && parentName === 'Library'
}

interface WalkState {
  paths: string[]
  scanned: number
  truncated: boolean
  notes: string[]
}

/**
 * Depth-first, alphabetical, bounded. Entries are sorted so the truncation
 * point of a capped scan is reproducible rather than filesystem-dependent.
 *
 * Depth counts from the root: `maxDepth: 1` walks the root and one level of
 * subdirectories. Symlinks are not followed — a directory link can form a
 * cycle, and a file link's target is found through its own root if the user
 * configured one.
 */
async function walkRoot(root: string, config: LibraryConfig, state: WalkState): Promise<void> {
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    if (state.scanned >= config.maxFilesScanned) {
      state.truncated = true
      return
    }

    let entries
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch (error) {
      state.notes.push(
        `could not list ${quoteExternalPath(current.dir)} (${describeExternalError(error)}); skipped`
      )
      continue
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    const subdirs: { dir: string; depth: number }[] = []
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (current.depth >= config.maxDepth) continue
        if (shouldSkipDir(entry.name, basename(current.dir))) continue
        subdirs.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (state.scanned >= config.maxFilesScanned) {
        state.truncated = true
        return
      }
      state.scanned += 1
      if (isPdfName(entry.name)) state.paths.push(join(current.dir, entry.name))
    }

    // Reversed, because a stack pops last-in first: this makes the alphabetical
    // order above the order the tree is actually visited in.
    subdirs.reverse()
    for (const subdir of subdirs) stack.push(subdir)
  }
}

/* ------------------------------------------------------------ the boundary -- */

/**
 * Is this candidate really inside one of the roots the user configured?
 *
 * The roots arrive from `expandRoots` already absolute and realpath-resolved,
 * so this is a prefix test against a resolved path and nothing else — the
 * candidate is normalized by its caller before it gets here, because
 * `/Users/me/Papers/../../../etc/x.pdf` starts with `/Users/me/Papers/` and a
 * raw prefix test would wave it through.
 *
 * `path === root` is included for completeness; a root is a directory, so it
 * cannot actually be a PDF.
 */
function insideRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    if (path === root) return true
    return path.startsWith(root.endsWith(sep) ? root : root + sep)
  })
}

/**
 * Turn a path Spotlight printed into the path that will actually be opened.
 *
 * `realpath`, not `resolve`: `resolve` only folds away `.` and `..`, so a
 * candidate that is a SYMLINK sitting inside a configured root — say
 * `~/Papers/Gunn_1972.pdf` → `~/.ssh/id_rsa` — passes `insideRoots` as its own
 * name and is then opened at its target, outside every root. Resolving it here
 * makes the boundary check judge what `open` will actually reach.
 *
 * That also gives the two discovery paths one rule stated two ways: the walk
 * refuses a symlink outright (`entry.isSymbolicLink()`), and a Spotlight hit is
 * replaced by its target, which must then pass the boundary check on its own.
 * Neither path ever opens a file *as* a link, and neither can be carried out of
 * a root by one; a link that stays inside a root simply becomes the ordinary
 * candidate the walk would have found anyway, and dedupes against it.
 *
 * A path that cannot be resolved — it does not exist, or a link in the chain
 * is broken — falls back to `resolve`. It cannot be opened either, so nothing
 * escapes; letting it through keeps the failure reported in the one wording
 * every other unreadable candidate gets, naming the file, instead of
 * disappearing into a second note about resolution.
 */
async function normalizeCandidate(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/* ----------------------------------------------------------------- bytes -- */

/**
 * Why a candidate that is not a regular file is dropped instead of opened.
 *
 * A name ending in `.pdf` is not a promise about what is behind it, and
 * `readHead` opens whatever it is handed. Spotlight indexes bundles, which are
 * directories; and anyone who can write into a library root can leave a FIFO
 * called `Gunn_1972.pdf` there. `open()` on a FIFO **blocks** until a writer
 * appears, so one hostile name would hang the scan — and with it the IPC call
 * and the agent turn waiting on it. A directory is milder on macOS (the open
 * succeeds, the read fails EISDIR) but still lies twice: a note claiming the
 * file could not be read, and then a `PdfMatch` whose `path` is a directory,
 * handed on to `importPdfIntoProject`. So: stat first, open only a regular
 * file, and say which candidate was dropped and why.
 */
function notRegularNote(path: string): string {
  return `ignored a candidate that is not a regular file (a directory, a FIFO or a device) — it was never opened: ${quoteExternalPath(path)}`
}

/**
 * Read at most `limit` leading bytes. Never reads a whole 300 MB scan-of-a-thesis.
 *
 * Callers stat first and hand this only a regular file — see `notRegularNote`.
 */
async function readHead(path: string, limit: number): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
  } finally {
    await handle.close()
  }
}

/* ----------------------------------------------------------- findLocalPdf -- */

export interface FindLocalPdfOptions {
  /** Environment used to expand `~` in the configured roots. */
  env?: NodeJS.ProcessEnv
  /** Defaults to `process.platform`; Spotlight exists only on darwin. */
  platform?: NodeJS.Platform
  /** Per-query mdfind budget; defaults to `SPOTLIGHT_TIMEOUT_MS`. */
  spotlightTimeoutMs?: number
  /** How mdfind is run; defaults to `runMdfind`. */
  spotlight?: SpotlightRunner
  /** How many filename candidates get read; defaults to `BYTE_READ_CANDIDATES`. */
  byteReadLimit?: number
}

export interface FindLocalPdfResult {
  /** Best first. Empty means "nothing on this machine looks like this paper". */
  matches: PdfMatch[]
  /** Absolute, symlink-resolved roots that were actually walked. */
  rootsSearched: string[]
  /** Configured roots that were dropped, in their stored (`~/…`) form. */
  rootsMissing: string[]
  /** Files the bounded walk examined. Spotlight hits are not walked, so they do not count. */
  scanned: number
  /** True when `maxFilesScanned` stopped the walk early — the answer is partial. */
  truncated: boolean
  /** Everything the caller must be told: skipped roots, Spotlight state, unreadable files. */
  notes: string[]
}

/**
 * Find PDFs on this machine that look like `result`.
 *
 * **Read-only.** Nothing is copied, moved, opened for writing or executed.
 *
 * Every path in `matches` has been checked to lie inside one of
 * `rootsSearched` — the promise `PdfMatch.path` makes to its callers — and a
 * candidate that failed the check is named in `notes` rather than dropped
 * silently.
 *
 * An empty `matches` is a real answer, not a swallowed failure — which is why
 * it always arrives with `rootsSearched`, `rootsMissing`, `truncated` and
 * `notes`: "no match in 3 roots (~/Papers does not exist), Spotlight off" is
 * a very different fact from "no match anywhere", and the caller must be able
 * to say which one happened before it falls back to `metadata-only`.
 */
export async function findLocalPdf(
  result: LitResult,
  config: LibraryConfig,
  opts: FindLocalPdfOptions = {}
): Promise<FindLocalPdfResult> {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const expanded = await expandRoots(config, env)
  const notes = [...expanded.notes]

  if (expanded.roots.length === 0) {
    notes.push(
      config.roots.length === 0
        ? 'no library roots are configured — add one in Settings → Reference library'
        : 'none of the configured library roots exists on this machine; nothing was searched'
    )
    return {
      matches: [],
      rootsSearched: [],
      rootsMissing: expanded.missing,
      scanned: 0,
      truncated: false,
      notes
    }
  }

  /** Every path worth scoring, deduped: Spotlight and the walk overlap heavily. */
  const candidatePaths = new Set<string>()
  /**
   * Paths Spotlight's full-text index matched, and on WHICH query. The DOI
   * answer outranks the title answer, so a file that came back from both is
   * remembered as the stronger of the two.
   */
  const contentHits = new Map<string, SpotlightContentHit>()
  /**
   * Resolved candidate → the path Spotlight actually printed, when the two
   * differ. Only a refusal note reads it: "outside every root: /Users/me/x.pdf"
   * is baffling when no such file is in a root, so the note also names the
   * `..`-spelling or the symlink that led there — which is the thing the user
   * can go and look at.
   */
  const reachedVia = new Map<string, string>()

  // 1. Spotlight.
  if (!config.useSpotlight) {
    notes.push('Spotlight is switched off in library.json; only the bounded walk ran')
  } else if (platform !== 'darwin') {
    notes.push(`Spotlight is macOS-only (this machine runs ${platform}); only the bounded walk ran`)
  } else {
    const run = opts.spotlight ?? runMdfind
    const timeoutMs = opts.spotlightTimeoutMs ?? SPOTLIGHT_TIMEOUT_MS
    const queries = spotlightQueries(result)
    if (queries.length === 0) {
      notes.push('Spotlight had nothing to search for: this record has no DOI, title or author/year')
    }
    let unavailable = false
    for (const root of expanded.roots) {
      if (unavailable) break
      for (const spotlightQuery of queries) {
        const outcome = await run(['-0', '-onlyin', root, spotlightQuery.query], timeoutMs)
        if (!outcome.available) {
          unavailable = true
          notes.push(
            `${outcome.error ?? 'Spotlight is unavailable'}; only the bounded walk ran`
          )
          break
        }
        if (outcome.error !== null) {
          notes.push(`Spotlight query failed under ${quoteExternalPath(root)}: ${outcome.error}`)
          continue
        }
        const hits = outcome.paths.filter(isPdfName)
        if (hits.length > SPOTLIGHT_MAX_RESULTS) {
          notes.push(
            `Spotlight returned ${hits.length} PDFs under ${quoteExternalPath(root)}; kept the first ${SPOTLIGHT_MAX_RESULTS}`
          )
        }
        for (const hit of hits.slice(0, SPOTLIGHT_MAX_RESULTS)) {
          // Normalized the moment it arrives: the boundary check further down
          // is a prefix comparison, and both `<root>/../../etc/x.pdf` and a
          // symlink inside the root would pass one on their printed spelling.
          const path = await normalizeCandidate(hit)
          if (path !== hit) reachedVia.set(path, hit)
          candidatePaths.add(path)
          if (spotlightQuery.hit === null) continue
          if (spotlightQuery.hit === 'doi' || !contentHits.has(path)) {
            contentHits.set(path, spotlightQuery.hit)
          }
        }
      }
    }
  }

  // 2. Bounded walk.
  const state: WalkState = { paths: [], scanned: 0, truncated: false, notes: [] }
  for (const root of expanded.roots) {
    if (state.truncated) break
    await walkRoot(root, config, state)
  }
  notes.push(...state.notes)
  for (const path of state.paths) candidatePaths.add(path)
  if (state.truncated) {
    notes.push(
      `stopped after ${state.scanned} files (maxFilesScanned); the search is partial — raise the limit or narrow the roots`
    )
  }

  // 3. The read boundary, enforced once for every candidate however it was
  //    found. The walk cannot leave a root, but Spotlight's answer is somebody
  //    else's: `-onlyin` is a request, and `PdfMatch.path` promises callers
  //    (`importPdfIntoProject` among them) that the path is inside a root. A
  //    stray hit is dropped BEFORE it is opened, and never in silence.
  const inRoots: string[] = []
  for (const path of [...candidatePaths].sort()) {
    if (insideRoots(path, expanded.roots)) {
      inRoots.push(path)
      continue
    }
    const via = reachedVia.get(path)
    notes.push(
      `ignored a candidate outside every configured library root — it was never opened: ${quoteExternalPath(path)}` +
        (via === undefined ? '' : ` (reached through ${quoteExternalPath(via)})`)
    )
  }

  // 4. Two passes: name every candidate cheaply, then read the leading bytes of
  //    the few that looked plausible so a match can reach `high` at all.
  const candidates: PdfCandidate[] = inRoots.map((path) => ({
    path,
    bytesSample: null,
    spotlightContentHit: contentHits.get(path) ?? null
  }))

  const firstPass = rankPdfCandidates(result, candidates)
  const readLimit = Math.max(0, opts.byteReadLimit ?? BYTE_READ_CANDIDATES)

  /**
   * Who gets read: the filename-ranked candidates first, then — while budget
   * is left — the ones that scored NOTHING on their name.
   *
   * That second half is not a nicety. Zotero, one of the four default roots,
   * files everything as `storage/<8 chars>/Full Text PDF.pdf`, a name that
   * matches no filename rule at all, so those candidates never appear in
   * `firstPass` and, read-the-top-N-of-firstPass, their bytes were never
   * opened — making `doi-in-bytes`, this module's strongest evidence,
   * unreachable for exactly the layout it most needs to cover. Sorted order
   * keeps which files get read reproducible.
   */
  const readOrder: string[] = []
  const queued = new Set<string>()
  for (const ranked of firstPass) {
    if (readOrder.length >= readLimit) break
    readOrder.push(ranked.path)
    queued.add(ranked.path)
  }
  for (const candidate of candidates) {
    if (readOrder.length >= readLimit) break
    if (queued.has(candidate.path)) continue
    readOrder.push(candidate.path)
    queued.add(candidate.path)
  }

  const samples = new Map<string, Uint8Array>()
  /** Candidates a stat unmasked as a directory/FIFO/device, already reported. */
  const notRegular = new Set<string>()
  for (const path of readOrder) {
    let kind
    try {
      kind = await stat(path)
    } catch {
      // Unstattable is unopenable: let the read below fail and name the file in
      // the wording every other unreadable candidate already gets, rather than
      // inventing a second note for the same fact.
      kind = null
    }
    if (kind !== null && !kind.isFile()) {
      notRegular.add(path)
      notes.push(notRegularNote(path))
      continue
    }
    try {
      samples.set(path, await readHead(path, PDF_SAMPLE_BYTES))
    } catch (error) {
      notes.push(
        `could not read the first bytes of ${quoteExternalPath(path)} (${describeExternalError(error)}); judged by its name alone`
      )
    }
  }
  const unopened = candidates.length - readOrder.length
  if (unopened > 0) {
    // An empty `matches` must never be indistinguishable from "nothing on this
    // machine" when the budget is what stopped the search.
    notes.push(
      `${unopened} of ${candidates.length} candidate PDFs were never opened (the byte-read budget is ${readLimit}); they were judged by name alone`
    )
  }
  const ranked =
    samples.size === 0
      ? firstPass
      : rankPdfCandidates(
          result,
          candidates.map((candidate) => ({
            ...candidate,
            bytesSample: samples.get(candidate.path) ?? null
          }))
        )

  // 5. Size is the one field @suna/bib cannot supply, since only the host stats.
  const matches: PdfMatch[] = []
  for (const entry of ranked) {
    // Already stat'ed, found not to be a regular file, and reported above.
    if (notRegular.has(entry.path)) continue
    let info
    try {
      info = await stat(entry.path)
    } catch (error) {
      notes.push(
        `${quoteExternalPath(entry.path)} matched but vanished before it could be sized (${describeExternalError(error)})`
      )
      continue
    }
    if (!info.isFile()) {
      // Past the byte-read budget, so this is the first stat of it: a directory
      // or a FIFO must not become a `PdfMatch` on the strength of its name.
      notes.push(notRegularNote(entry.path))
      continue
    }
    matches.push({
      path: entry.path,
      sizeBytes: info.size,
      confidence: entry.confidence,
      evidence: entry.evidence
    })
  }

  return {
    matches,
    rootsSearched: expanded.roots,
    rootsMissing: expanded.missing,
    scanned: state.scanned,
    truncated: state.truncated,
    notes
  }
}

/* --------------------------------------------------------- accepting a match -- */

/**
 * May this local match be copied into the project WITHOUT anyone being asked?
 *
 * `high` may: pdf-match.ts only reaches it on byte-level or identifier-level
 * evidence — the DOI in the file's own bytes, an arXiv id, a Spotlight
 * content hit.
 *
 * `medium` may only with corroboration, meaning at least two distinct
 * evidence ids. A lone `filename-author-year` is a `medium` all by itself, and
 * pdf-match.ts says plainly why that is not enough: "Smith 2020" names every
 * paper Smith wrote in 2020, so `~/Downloads/Gunn 1972.pdf` holding a
 * different Gunn 1972 paper would be filed under this key and discovered at
 * submission. Two independent facts agreeing is a different claim from one
 * ambiguous one.
 *
 * This is the same property the feature already has for a `low`-confidence
 * study resolution: it does not guess on the user's behalf. A match that fails
 * this test is reported as a candidate, with its path and its evidence, and is
 * copied only when someone accepts it deliberately.
 *
 * It lives HERE, beside the scan that produces the matches, rather than in
 * either host, because both hosts gate on it: the MCP `fetch_pdf` verb and the
 * desktop References view's "Find PDF" button. It was private to
 * `mcp/study.ts` once, and the desktop ladder gated on `confidence !== 'low'`
 * instead — so the button silently copied in the lone `filename-author-year`
 * match the MCP verb deliberately refuses. One rule, one home.
 */
export function isAutoCopyable(match: PdfMatch): boolean {
  if (match.confidence === 'high') return true
  return match.confidence === 'medium' && new Set(match.evidence).size >= 2
}

/* ------------------------------------------------------- writing into the project -- */

export interface PdfSaveOutcome {
  /** Absolute path of the PDF inside the project, or null when nothing was saved. */
  path: string | null
  /** The same file as a project-relative POSIX path — what the BibTeX `file` field wants. */
  relativePath: string | null
  /** Which of ARCHITECTURE §9's outcomes happened, or null when none did. */
  acquisition: PdfAcquisition | null
  /** Human-readable failure, or null. Never thrown. */
  error: string | null
}

interface Destination {
  /** The resolved project root the two paths below are confined to. */
  root: string
  absolute: string
  relative: string
}

/**
 * `references/<citekey>.pdf`, confined to the project.
 *
 * Two gates, deliberately: a cite key may not contain a path separator (a key
 * is a *name*, and `sub/key` would silently scatter PDFs into subdirectories
 * `resolvePdfPath` does not look in), and `resolveInside` is the backstop that
 * makes escaping the root impossible whatever gets past the first check. It
 * throws by design; here that becomes a returned string, per this package's
 * doctrine that a caller is told what went wrong rather than handed an
 * exception.
 */
function destinationFor(
  projectRoot: string,
  citekey: string
): { destination: Destination | null; error: string | null } {
  const key = citekey.trim()
  if (key === '') {
    return { destination: null, error: 'refusing to save a PDF under a blank cite key' }
  }
  if (/[\\/\u0000]/.test(key)) {
    return {
      destination: null,
      error: `refusing to save a PDF for cite key ${JSON.stringify(citekey)}: a cite key may not contain a path separator`
    }
  }
  try {
    // resolveInside compares against the string it is given, so the root is
    // normalized first: a trailing slash or a relative root would defeat it.
    const root = resolve(projectRoot)
    const absolute = resolveInside(root, REFERENCES_DIR, `${key}.pdf`)
    return {
      destination: { root, absolute, relative: `${REFERENCES_DIR}/${key}.pdf` },
      error: null
    }
  } catch (error) {
    return {
      destination: null,
      error: `refusing to save a PDF for cite key ${JSON.stringify(citekey)}: ${describeExternalError(error)}`
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Create `references/` and then prove it is really inside the project.
 *
 * `resolveInside` is a string comparison — it normalizes `..` and rejects an
 * absolute segment, and that is all it can do, because it never touches the
 * disk. A symlink defeats it completely: with `references` linked to somewhere
 * else, `<root>/references/<key>.pdf` passes the lexical test, `mkdir -p`
 * follows the link, and `copyFile`/`link` write the file outside the project
 * while every report still says `references/<key>.pdf`. These two functions
 * are the first in the codebase to write bytes that came off the network, so
 * the confinement has to hold against the filesystem and not just against the
 * string.
 *
 * Hence: resolve BOTH ends with `realpath` after the directory exists, and
 * re-assert the prefix. Both ends, because the project root is itself commonly
 * reached through a link (macOS's `/tmp`, `/var`, a home directory on another
 * volume) and comparing a resolved child against an unresolved root would
 * reject perfectly ordinary projects.
 */
async function prepareReferencesDir(destination: Destination): Promise<string | null> {
  const directory = dirname(destination.absolute)
  try {
    await mkdir(directory, { recursive: true })
  } catch (error) {
    return `could not create ${REFERENCES_DIR}/ in the project (${describeExternalError(error)})`
  }

  let realRoot: string
  let realDirectory: string
  try {
    realRoot = await realpath(destination.root)
    realDirectory = await realpath(directory)
  } catch (error) {
    return `could not verify that ${REFERENCES_DIR}/ is inside the project (${describeExternalError(error)})`
  }
  if (realDirectory !== realRoot && !realDirectory.startsWith(realRoot + sep)) {
    // `realDirectory` is the target of a symlink somebody else made, so its
    // bytes are their choice, not the project's — and this refusal travels to
    // a model (study.ts's `local copy failed: …`) and to the user through the
    // desktop host, whose twin of this check quotes it already.
    return `refusing to write ${destination.relative}: ${REFERENCES_DIR}/ resolves to ${quoteExternalPath(realDirectory)}, which is outside the project root ${quoteExternalPath(realRoot)}`
  }
  return null
}

/**
 * Copy a PDF found on this machine into `references/<citekey>.pdf`.
 *
 * A **copy**: the file in the user's library keeps its name, its place and its
 * Zotero/Finder metadata, because a reference manager that moves your files is
 * a reference manager you stop trusting. And never an overwrite — an existing
 * destination comes back as `already-present` with its path, which is
 * outcome 1 of the plan's four, not an error.
 */
export async function importPdfIntoProject(
  sourcePath: string,
  projectRoot: string,
  citekey: string
): Promise<PdfSaveOutcome> {
  const { destination, error } = destinationFor(projectRoot, citekey)
  if (destination === null) {
    return { path: null, relativePath: null, acquisition: null, error }
  }

  const dirError = await prepareReferencesDir(destination)
  if (dirError !== null) {
    return { path: null, relativePath: null, acquisition: null, error: dirError }
  }

  try {
    // COPYFILE_EXCL makes "do not overwrite" a kernel guarantee rather than a
    // check-then-act race against the app's own rescan.
    await copyFile(sourcePath, destination.absolute, fsConstants.COPYFILE_EXCL)
  } catch (copyError) {
    if (errorCode(copyError) === 'EEXIST') {
      return {
        path: destination.absolute,
        relativePath: destination.relative,
        acquisition: 'already-present',
        error: null
      }
    }
    return {
      path: null,
      relativePath: null,
      acquisition: null,
      error: `could not copy ${quoteExternalPath(sourcePath)} to ${destination.relative} (${describeExternalError(copyError)})`
    }
  }

  return {
    path: destination.absolute,
    relativePath: destination.relative,
    acquisition: 'copied-local',
    error: null
  }
}

/**
 * Save downloaded bytes to `references/<citekey>.pdf`, same confinement and
 * same no-overwrite rule as the local-copy path.
 *
 * The bytes are re-checked for the `%PDF-` magic even though `downloadPdf`
 * already verified them: this function is the last thing between the network
 * and the user's project, and a login page written into `references/` would be
 * discovered weeks later, at submission.
 *
 * Written to a sibling temp file and then hard-linked into place, so a crash
 * mid-write cannot leave a truncated PDF that every later run mistakes for
 * `already-present`. `link` is the atomic exclusive-create; `rename` is the
 * fallback for filesystems that have no hard links.
 */
export async function savePdfBytes(
  bytes: Uint8Array,
  projectRoot: string,
  citekey: string
): Promise<PdfSaveOutcome> {
  const { destination, error } = destinationFor(projectRoot, citekey)
  if (destination === null) {
    return { path: null, relativePath: null, acquisition: null, error }
  }
  if (!isPdfBytes(bytes)) {
    return {
      path: null,
      relativePath: null,
      acquisition: null,
      error: `refusing to save ${bytes.length} bytes as ${destination.relative}: they do not begin with the %PDF- magic`
    }
  }

  const dirError = await prepareReferencesDir(destination)
  if (dirError !== null) {
    return { path: null, relativePath: null, acquisition: null, error: dirError }
  }

  const temp = `${destination.absolute}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, bytes)
  } catch (writeError) {
    await unlink(temp).catch(() => undefined)
    return {
      path: null,
      relativePath: null,
      acquisition: null,
      error: `could not write ${destination.relative} (${describeExternalError(writeError)})`
    }
  }

  let placed: 'created' | 'exists' | null = null
  let failure: string | null = null
  try {
    await link(temp, destination.absolute)
    placed = 'created'
  } catch (linkError) {
    if (errorCode(linkError) === 'EEXIST') {
      placed = 'exists'
    } else if (await pathExists(destination.absolute)) {
      placed = 'exists'
    } else {
      // exFAT/FAT32 on an external drive answers EPERM/ENOSYS to link(). The
      // rename fallback is weaker — its no-overwrite guard is the check above,
      // not the kernel — but refusing to save at all on that drive is worse.
      try {
        await rename(temp, destination.absolute)
        placed = 'created'
      } catch (renameError) {
        failure = `could not save ${destination.relative} (${describeExternalError(linkError)}; then ${describeExternalError(renameError)})`
      }
    }
  }
  await unlink(temp).catch(() => undefined)

  if (failure !== null || placed === null) {
    return {
      path: null,
      relativePath: null,
      acquisition: null,
      error: failure ?? `could not save ${destination.relative}`
    }
  }

  return {
    path: destination.absolute,
    relativePath: destination.relative,
    acquisition: placed === 'exists' ? 'already-present' : 'downloaded',
    error: null
  }
}
