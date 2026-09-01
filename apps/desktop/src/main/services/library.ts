/**
 * The reference library — re-exported from `@suna/agent`, the shared module
 * both this main process and the standalone MCP server
 * (packages/agent/src/mcp/study.ts) import, so the two hosts read the same
 * `~/SunaConfig/library.json`, walk the same folders, rank the same files by
 * the same evidence rules and copy them into the project under the same
 * no-overwrite rule (see packages/agent/src/library/ for the implementation
 * and its tests).
 *
 * Same one-implementation-two-hosts split `./lit.ts` uses for the literature
 * providers, and for the same reason: a second copy of this logic living in
 * the app would drift the moment either host learned something the other did
 * not — and here the two hosts must agree about which directories may be read
 * at all, which is not a thing to let drift.
 */
export {
  expandRoots,
  findLocalPdf,
  importPdfIntoProject,
  libraryConfigPath,
  loadLibraryConfig,
  saveLibraryConfig,
  savePdfBytes
} from '@suna/agent'
export type {
  ExpandedRoots,
  FindLocalPdfOptions,
  FindLocalPdfResult,
  LibraryConfigOutcome,
  LibraryConfigSource,
  PdfSaveOutcome
} from '@suna/agent'

/**
 * The Electron-only glue on top of it: resolving the open project, walking
 * ARCHITECTURE §9's acquisition ladder for one reference, and enforcing the
 * boundary this feature is built around.
 *
 * **Reads leave the project; writes never do.** `findLibraryPdf` searches
 * `~/Downloads`, `~/Zotero/storage` and whatever else library.json names —
 * directories the app has never "opened" and never will. That is the whole
 * point of a library scan, and it is why the scan roots deliberately do NOT
 * go through `assertInsideAllowedRoot`: running them through it would confine
 * the search to the project and leave the feature searching the one place the
 * PDF is already known not to be. Do not "fix" that.
 *
 * What IS confined is every write, and the project the request is about:
 * `references/<citekey>.pdf` is asserted to sit inside a root the user
 * actually opened before a single byte is written. `scan.ts` repeats the
 * confinement check with `resolveInside` as its own backstop — it has to,
 * since the MCP server has no allow-list — but only this host can ask the
 * stricter question "is this an open project?", so that check lives here.
 */
import { realpath } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type {
  DownloadPolicy,
  LibraryAcquireOutcome,
  LibraryConfig,
  LibraryConfigState,
  LibraryScanOutcome,
  LitResult
} from '@suna/core'
import {
  describePdfFailure,
  downloadPdf,
  type PdfDownloadOutcome,
  type PdfFetchOptions
} from '@suna/bib'
import {
  describeExternalError,
  expandRoots,
  findLocalPdf,
  importPdfIntoProject,
  isAutoCopyable,
  loadLibraryConfig,
  quoteExternalPath,
  saveLibraryConfig,
  savePdfBytes,
  type FindLocalPdfResult
} from '@suna/agent'
import { assertInsideAllowedRoot } from './roots'

/** Where reference PDFs live, matching @suna/bib's `resolvePdfPath` citekey rule. */
const REFERENCES_DIR = 'references'

/**
 * Injection seam for the tests, in the shape `mcp/study.ts` already uses: the
 * defaults ARE the real implementations, so production never sees a stub, and
 * the suite can reach the `downloaded` rung without a network. `env` drives
 * `$SUNA_CONFIG_DIR`, so a test can point library.json at a temp dir.
 */
export interface LibraryDeps {
  download?: (result: LitResult, options: PdfFetchOptions) => Promise<PdfDownloadOutcome>
  env?: NodeJS.ProcessEnv
}

/* --------------------------------------------------------------- settings -- */

/**
 * library.json plus what its roots resolve to on this machine — one round trip
 * for the Settings pane, which has to show both: the portable strings the user
 * edits, and which of them will actually be searched.
 */
export async function readLibraryConfig(deps: LibraryDeps = {}): Promise<LibraryConfigState> {
  const outcome = await loadLibraryConfig(deps.env)
  return { ...outcome, expanded: await expandRoots(outcome.config, deps.env) }
}

/**
 * Merge a patch into library.json and answer with the file as it now stands.
 * `saveLibraryConfig` refuses an invalid patch without writing anything, so a
 * refusal comes back here as the UNCHANGED config plus a sentence — the pane
 * can show the user's own value again rather than silently reverting it.
 */
export async function writeLibraryConfig(
  patch: Partial<LibraryConfig>,
  deps: LibraryDeps = {}
): Promise<LibraryConfigState> {
  const outcome = await saveLibraryConfig(patch, deps.env)
  return { ...outcome, expanded: await expandRoots(outcome.config, deps.env) }
}

/* ------------------------------------------------------------ the project -- */

interface Destination {
  /** The open project, resolved. */
  root: string
  /** Absolute `<root>/references/<citekey>.pdf`. */
  absolute: string
  /** The same file project-relative — what a BibTeX `file` field wants. */
  relative: string
}

/**
 * The write boundary, asked before anything is written.
 *
 * Two gates, deliberately. A cite key must be a NAME: `sub/key` would resolve
 * inside the project perfectly well and still scatter PDFs into directories
 * `resolvePdfPath` never looks in. And the destination must sit inside a root
 * the user opened as a project — `assertInsideAllowedRoot` throws by design,
 * which becomes a returned sentence here, per the doctrine that a caller is
 * told what went wrong rather than handed an exception.
 */
function writeDestination(
  projectRoot: string,
  citekey: string
): { destination: Destination | null; error: string | null } {
  const key = citekey.trim()
  if (key === '' || /[\\/\u0000]/.test(key)) {
    return {
      destination: null,
      error: `refusing to file a PDF under cite key ${JSON.stringify(citekey)}: a cite key is a name, not a path`
    }
  }
  try {
    const root = assertInsideAllowedRoot(projectRoot)
    // The backstop: with the separator gate above this cannot fail, which is
    // exactly what a backstop is for.
    const absolute = assertInsideAllowedRoot(join(root, REFERENCES_DIR, `${key}.pdf`))
    return { destination: { root, absolute, relative: `${REFERENCES_DIR}/${key}.pdf` }, error: null }
  } catch (error) {
    // `describeExternalError`, not a local `describeError`: what
    // `assertInsideAllowedRoot` throws is `path is outside any open project:
    // <path>`, and that path came from the renderer. Raw, a newline in it
    // writes a second line into a message the user reads and a model may be
    // shown — the same door the quoted paths elsewhere in this file close.
    return { destination: null, error: describeExternalError(error) }
  }
}

/** Is `path`, already realpath-resolved, inside the realpath-resolved `root`? */
function insideRoot(realRoot: string, path: string): boolean {
  return path === realRoot || path.startsWith(realRoot + sep)
}

/**
 * Rung 1's "does the project already have it?" — asked the way the WRITE path
 * answers it, on the disk rather than on the string.
 *
 * `access` follows symlinks, so a lexical `exists(<root>/references/<key>.pdf)`
 * says yes for a `references/` linked out of the project and the user is told
 * `references/<key>.pdf was already in the project` about a file that is
 * nowhere near it — and the ladder stops, so nothing is searched or fetched
 * either. The writes were never at risk (`savePdfBytes` and
 * `importPdfIntoProject` realpath both ends in scan.ts's
 * `prepareReferencesDir` and refuse), which is exactly why this had to be
 * fixed as what it is: a report that lies about where a file lives.
 *
 * The link can be at EITHER level, so both are resolved. A `references/`
 * pointing out of the project is the directory case; `references/<key>.pdf`
 * being itself a link to `~/Downloads/whatever.pdf` is the file case, and it
 * used to slip through the directory check untouched — same lie, one level
 * down, and the more likely one, since a symlinked single file is exactly what
 * a user reaches for when they want to "attach" a PDF without copying it.
 *
 * A resolved path that leads out comes back as `escaped` rather than
 * `present`, so the caller can say so in `notes` — naming which of the two
 * links it followed — instead of stopping the ladder on it.
 */
interface Escape {
  /** What was linked away: `references/` itself, or the PDF inside it. */
  level: 'directory' | 'file'
  /** Where it really leads, resolved. */
  target: string
}

async function alreadyInProject(
  destination: Destination
): Promise<{ present: boolean; escaped: Escape | null }> {
  const directory = dirname(destination.absolute)
  let realRoot: string
  let realDirectory: string
  try {
    realRoot = await realpath(destination.root)
    realDirectory = await realpath(directory)
  } catch {
    // No references/ yet (or it cannot be resolved): nothing is present, and
    // the write path will produce the real message if it comes to that.
    return { present: false, escaped: null }
  }
  if (!insideRoot(realRoot, realDirectory)) {
    return { present: false, escaped: { level: 'directory', target: realDirectory } }
  }

  let realFile: string
  try {
    realFile = await realpath(destination.absolute)
  } catch {
    // Nothing there — or a dangling link, which is not a PDF this project has.
    return { present: false, escaped: null }
  }
  if (!insideRoot(realRoot, realFile)) {
    return { present: false, escaped: { level: 'file', target: realFile } }
  }
  return { present: true, escaped: null }
}

/* ------------------------------------------------------------ the search -- */

export interface LibraryScanRequest {
  result: LitResult
  /** The open project the search is for. It identifies the caller, not the search area. */
  projectRoot: string
}

/**
 * Search this machine for a PDF of `result`. **Read-only**: nothing is copied,
 * moved, opened for writing or executed.
 *
 * The only thing confined here is `projectRoot` — the app answers about
 * projects it has open, not about arbitrary directories a renderer names. The
 * roots that are actually walked come from library.json and are the user's
 * own folders, which is the point.
 */
export async function findLibraryPdf(
  req: LibraryScanRequest,
  deps: LibraryDeps = {}
): Promise<LibraryScanOutcome> {
  try {
    assertInsideAllowedRoot(req.projectRoot)
  } catch (error) {
    return {
      matches: [],
      rootsSearched: [],
      rootsMissing: [],
      scanned: 0,
      truncated: false,
      notes: [],
      error: describeExternalError(error)
    }
  }

  const config = await loadLibraryConfig(deps.env)
  const found = await findLocalPdf(req.result, config.config, { env: deps.env })
  const notes =
    config.error === null
      ? found.notes
      : [`library.json: ${config.error} — the defaults were used`, ...found.notes]
  return { ...found, notes, error: null }
}

/* ------------------------------------------------------------ the ladder -- */

export interface LibraryAcquireRequest {
  result: LitResult
  /** The bibliography key the PDF is filed under: `references/<citekey>.pdf`. */
  citekey: string
  projectRoot: string
  /** Null means "whatever library.json says"; a value overrides it for this call only. */
  policy: DownloadPolicy | null
  /**
   * Unpaywall's keyless API requires a contact address and Crossref's polite
   * pool likes one. ipc.ts reads it from Settings — explicitly null when the
   * user has not set one, which `pdfUrlPlan` reads as "skip that rung and say
   * so" rather than inventing an address.
   */
  mailto: string | null
  /**
   * A candidate the USER picked out of `matches`, copied because it was asked
   * for rather than because the evidence was enough — the counterpart of the
   * MCP verb's `fetch_pdf {"accept": "<path>"}`.
   *
   * The ladder refuses to guess (`isAutoCopyable`), which without this would
   * mean a weak-but-correct match can only be reported and never used: the
   * user sees "~/Zotero/storage/A1/Gunn 1972.pdf, medium" and has no way to
   * say "yes, that one". Null is the ordinary call, where only the evidence
   * decides.
   *
   * It is NOT a way to copy an arbitrary file: only a path this scan itself
   * reported is accepted, exactly as in `mcp/study.ts`, so the accept cannot
   * widen the read boundary the scan just enforced.
   */
  acceptPath: string | null
  /**
   * The caller's cancel, forwarded to `downloadPdf` — the one rung that can
   * run for the full 60 s budget. Absent means "no cancel", which is what the
   * ladder had before and is still bounded.
   */
  signal?: AbortSignal | null
}

/**
 * One line saying how wide the machine search actually was.
 *
 * The roots are absolute paths from outside the project, so they are quoted
 * individually before being joined — the same treatment `scan.ts` gives them
 * at its own sites. They come from the user's own library.json rather than
 * from a third party, but they still cross into a note the user reads and a
 * model may be shown, and quoting keeps each one on one line and shows where
 * it begins and ends.
 */
function scanSummary(found: FindLocalPdfResult): string {
  const roots =
    found.rootsSearched.length === 0
      ? 'no searchable roots'
      : `${found.rootsSearched.length} root${found.rootsSearched.length === 1 ? '' : 's'} (${found.rootsSearched.map((root) => quoteExternalPath(root)).join(', ')})`
  const truncated = found.truncated ? ', walk truncated by maxFilesScanned' : ''
  return `local scan: ${found.matches.length} match${found.matches.length === 1 ? '' : 'es'} across ${roots}, ${found.scanned} file${found.scanned === 1 ? '' : 's'} examined${truncated}`
}

/**
 * Walk ARCHITECTURE §9's ladder for one reference, in its strict preference
 * order: `already-present` → `copied-local` → `downloaded` → `metadata-only`.
 *
 * Every rung that does not produce a PDF leaves a line in `notes`, so
 * `metadata-only` always arrives with its reasons — "3 roots searched, nothing
 * matched; the publisher answered 403" is something the user can act on, an
 * unexplained "no PDF" is not.
 *
 * Which local match may be copied unasked is `isAutoCopyable`'s decision, and
 * it is imported from @suna/agent rather than restated here — the same rule
 * the MCP `fetch_pdf` verb gates on. This host once asked the looser question
 * `confidence !== 'low'`, which auto-copied a lone `filename-author-year`
 * match: "Gunn 1972" names every paper Gunn wrote in 1972, so the button filed
 * whichever one happened to be in `~/Downloads` and the mistake surfaced at
 * submission. A match that fails the gate rides back in `matches` with its
 * evidence for the References view to offer, and `req.acceptPath` is how the
 * user's "yes, that one" comes back.
 */
export async function acquireLibraryPdf(
  req: LibraryAcquireRequest,
  deps: LibraryDeps = {}
): Promise<LibraryAcquireOutcome> {
  const { destination, error } = writeDestination(req.projectRoot, req.citekey)
  if (destination === null) {
    return {
      acquisition: null,
      path: null,
      relativePath: null,
      source: null,
      matches: [],
      notes: [],
      error
    }
  }

  // Rung 1. The conventional path IS the question here: this channel names the
  // reference by cite key, so unlike the MCP verb — which has the parsed entry
  // and honours its `file` field too — there is nothing else to consult.
  const here = await alreadyInProject(destination)
  if (here.present) {
    return {
      acquisition: 'already-present',
      path: destination.absolute,
      relativePath: destination.relative,
      source: null,
      matches: [],
      notes: [`${destination.relative} was already in the project; nothing was searched or fetched`],
      error: null
    }
  }

  const notes: string[] = []
  if (here.escaped !== null) {
    const what = here.escaped.level === 'directory' ? `${REFERENCES_DIR}/` : destination.relative
    notes.push(
      `${what} resolves to ${quoteExternalPath(here.escaped.target)}, which is outside the project — whatever is filed there is not this project's, and nothing will be written through the link`
    )
  }
  const config = await loadLibraryConfig(deps.env)
  if (config.error !== null) notes.push(`library.json: ${config.error} — the defaults were used`)
  const policy = req.policy ?? config.config.download

  // Rung 2. This machine.
  const found = await findLocalPdf(req.result, config.config, { env: deps.env })
  notes.push(scanSummary(found))
  for (const note of found.notes) notes.push(`scan: ${note}`)

  // An accepted path is only ever one the scan itself reported. Trusting an
  // arbitrary string here would turn "copy the candidate I was shown" into
  // "copy any file on this machine", widening the read boundary the scan just
  // enforced — and this string arrives from the renderer.
  const acceptPath = req.acceptPath
  const accepted =
    acceptPath === null ? undefined : found.matches.find((match) => match.path === acceptPath)
  if (acceptPath !== null && accepted === undefined) {
    notes.push(
      `accept: ${quoteExternalPath(acceptPath)} is not one of the ${found.matches.length} path${found.matches.length === 1 ? '' : 's'} this scan found, so nothing was copied — only a file the scan itself reported can be accepted`
    )
  }

  const best = accepted ?? found.matches.find(isAutoCopyable)
  if (best !== undefined) {
    const saved = await importPdfIntoProject(best.path, destination.root, req.citekey)
    if (saved.error !== null) {
      notes.push(`local copy failed: ${saved.error}`)
    } else if (saved.acquisition !== null && saved.path !== null && saved.relativePath !== null) {
      notes.push(
        accepted === undefined
          ? `evidence: ${best.evidence.join(', ')} (${best.confidence})`
          : `accepted by name: ${quoteExternalPath(best.path)} — evidence: ${best.evidence.join(', ')} (${best.confidence}), copied because it was asked for, not because the evidence was enough`
      )
      return {
        acquisition: saved.acquisition,
        path: saved.path,
        relativePath: saved.relativePath,
        // 'already-present' here means the file appeared while we were
        // scanning; nothing was copied, so nothing came from anywhere.
        source: saved.acquisition === 'copied-local' ? best.path : null,
        matches: found.matches,
        notes,
        error: null
      }
    }
  } else if (found.matches.length > 0) {
    // Named, with its confidence and its evidence, so the view can offer it
    // back through `acceptPath` — this is a candidate the ladder REFUSED to
    // guess at, not a file it failed to notice. The path is quoted for the
    // same reason `formatMatch` quotes one: it was chosen by whoever saved the
    // file, so it is data, and a name carrying a newline would otherwise write
    // a second line into this report.
    const candidate = found.matches[0]
    notes.push(
      `${found.matches.length} local match${found.matches.length === 1 ? '' : 'es'} were too weak to copy without guessing${candidate === undefined ? '' : ` (best: ${candidate.confidence} — ${quoteExternalPath(candidate.path)}, evidence: ${candidate.evidence.join(', ')})`}`
    )
  }

  // Rung 3. The network, within the configured policy and never past it.
  if (policy === 'off') {
    notes.push("download: the library download policy is 'off', so nothing was fetched")
  } else {
    const download = deps.download ?? downloadPdf
    const outcome = await download(req.result, {
      policy,
      mailto: req.mailto,
      signal: req.signal ?? null
    })
    if (outcome.bytes === null) {
      notes.push(`download: ${describePdfFailure(outcome)}`)
      if (outcome.error !== null) notes.push(`download detail: ${outcome.error}`)
    } else {
      const saved = await savePdfBytes(outcome.bytes, destination.root, req.citekey)
      if (saved.error !== null) {
        // The URL is quoted for the reason a file name is: `sourceUrl` is the
        // provider's own JSON string (Unpaywall's `url_for_pdf`), never
        // through `new URL()`, so a CR or LF in it survives to here and would
        // write a second line into this report. A URL is the same trust class
        // as a name found on disk — ARCHITECTURE §21 and ARCHITECTURE §9 both
        // say so, and `mcp/study.ts` quotes its OA link on the same grounds.
        notes.push(
          `download: fetched ${outcome.bytes.length} bytes from ${outcome.sourceUrl === null ? 'an unnamed URL' : quoteExternalPath(outcome.sourceUrl)} but could not save them — ${saved.error}`
        )
      } else if (saved.acquisition !== null && saved.path !== null && saved.relativePath !== null) {
        if (saved.acquisition === 'already-present') {
          // The bytes were fetched over the network and then thrown away
          // because the destination appeared while the ladder was on it. Rung 1
          // has already told the user the project did NOT have this PDF, so a
          // bare `already-present` here contradicts the report's own earlier
          // line and hides a download that really happened.
          notes.push(
            `download: fetched ${outcome.bytes.length} bytes from ${outcome.sourceUrl === null ? 'an unnamed URL' : quoteExternalPath(outcome.sourceUrl)}, but ${saved.relativePath} already existed by the time they arrived and is never overwritten — the downloaded bytes were discarded`
          )
        }
        return {
          acquisition: saved.acquisition,
          path: saved.path,
          relativePath: saved.relativePath,
          source: outcome.sourceUrl,
          matches: found.matches,
          notes,
          error: null
        }
      }
    }
  }

  // Rung 4. The reference still stands — on its metadata alone, and the notes
  // above say exactly why that is the best that could be done.
  notes.push('no PDF was found in the project, on this machine, or online')
  return {
    acquisition: 'metadata-only',
    path: null,
    relativePath: null,
    source: null,
    matches: found.matches,
    notes,
    error: null
  }
}
