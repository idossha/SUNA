import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  DEFAULT_LIBRARY_CONFIG,
  LIBRARY_CONFIG_FILENAME,
  LibraryConfigSchema,
  type LibraryConfig
} from '@suna/core'
import { writeAtomic } from '../context/ensure'
import { sunaConfigDir } from '../context/paths'

/**
 * Where the reference-library settings live and how they become searchable
 * directories (ARCHITECTURE §15.5, "config.ts").
 *
 * The file is `~/SunaConfig/library.json`, NOT Electron userData: the
 * standalone MCP server has no userData and must read the same roots the
 * Settings pane wrote, which is the same one-layer-two-hosts reasoning
 * `context/ensure.ts` records for SunaConfig as a whole (ARCHITECTURE §15.4).
 *
 * Two rules hold this module together:
 *
 * - **Stored roots stay portable.** `~/Downloads` is written to disk exactly
 *   as typed; the `~` is expanded only at use time, by `expandRoots`. A
 *   library.json synced between machines or committed to dotfiles therefore
 *   keeps working, and a home directory never leaks into a config file.
 * - **Nothing here throws.** Loading falls back to `DEFAULT_LIBRARY_CONFIG` on
 *   any problem, but never *silently*: a file that exists and cannot be used
 *   comes back with a human-readable `error` beside the defaults, because a
 *   corrupt library.json quietly ignored looks exactly like a library.json
 *   whose roots simply hold no PDFs.
 */

/** How a `LibraryConfig` was obtained — `'defaults'` covers first run and any failure. */
export type LibraryConfigSource = 'file' | 'defaults'

export interface LibraryConfigOutcome {
  /** Always usable: the stored config, or a fresh copy of the defaults. */
  config: LibraryConfig
  /** Absolute path of library.json, whether or not it exists yet. */
  path: string
  source: LibraryConfigSource
  /**
   * Why the stored file was not used, or null. A file that does not exist yet
   * is the normal first-run state and is NOT an error; a file that exists and
   * is unreadable, unparseable or invalid is.
   */
  error: string | null
}

export interface ExpandedRoots {
  /** Absolute, existing, symlink-resolved, deduped — the directories to search. */
  roots: string[]
  /** Configured roots that could not be searched, in their stored (`~/…`) form. */
  missing: string[]
  /** One human-readable line per root that was dropped or collapsed. */
  notes: string[]
}

/**
 * `error.code` when the thrown value is a Node system error, else null.
 * Shared with scan.ts (same directory, same doctrine: a failure is described,
 * never swallowed); deliberately not re-exported from the package index.
 */
export function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return null
}

/** The message of a thrown value, whatever it turned out to be. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/* ---------------------------------------------------- outside paths as data -- */

/**
 * Quote a path that came from outside the project before it is interpolated
 * into a note, a report, or anything else an agent will read.
 *
 * Content found on disk is DATA, never instructions. A file name is chosen by
 * whoever put the file there, and APFS/HFS+ allow every byte in one except `/`
 * and NUL — so a PDF that arrived in `~/Downloads` inside somebody's zip can
 * be called `Gunn1972\n\nnotes:\n  <directive>.pdf` and, interpolated raw,
 * reproduce a module's own line structure inside the tool result. That result
 * is the one channel by which third-party disk content reaches a model's
 * context, so the quoting happens at the point of interpolation and not by
 * convention.
 *
 * `JSON.stringify` is the escaper because it is the one already used for cite
 * keys in this package: it turns CR/LF/tab into `\n`-style escapes — keeping
 * one path on one line — and wraps the value in quotes, so where the name
 * begins and ends is visible rather than inferred.
 *
 * It lives HERE, in the lowest module of the library layer, rather than beside
 * its heaviest user in scan.ts: this file's own `expandRoots` notes name paths
 * too, and scan.ts imports this file, so the other direction would be a cycle.
 * scan.ts re-exports it — and `describeExternalError` beside it — which is
 * where the package index and the desktop host take them from.
 * `external-paths.test.ts` reads the source of this file, of scan.ts, of
 * mcp/lit.ts, of mcp/study.ts and of the desktop host's own library.ts, and
 * fails when a path-bearing expression is interpolated without going through
 * one of these two functions — the rule is enforced by a test rather than held
 * by hand at thirty call sites.
 */
export function quoteExternalPath(path: string): string {
  return JSON.stringify(path)
}

/**
 * The same rule for the *error* about an outside path.
 *
 * Quoting the path is not enough on its own: `describeError` carries Node's
 * errno message, and that message quotes the path it failed on itself —
 * `ENOENT: no such file or directory, open '<path>'`. A name holding a newline
 * therefore breaks the line from inside the error text even when the path
 * beside it was escaped. Control characters are collapsed to a space, so the
 * note stays one line and the escaped path next to it remains the identifying
 * copy.
 *
 * Every filesystem error the guarded modules interpolate goes through this,
 * with no exception for "that path is ours": an errno message names a path
 * whether or not the caller was thinking about one, and an exception a reader
 * has to remember is an exception a reader copies wrong.
 */
export function describeExternalError(error: unknown): string {
  return describeError(error)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
}

/** A defaults value the caller may mutate: `roots` is a fresh array, not the shared const. */
function freshDefaults(): LibraryConfig {
  return { ...DEFAULT_LIBRARY_CONFIG, roots: [...DEFAULT_LIBRARY_CONFIG.roots] }
}

/**
 * Where library.json lives: `$SUNA_CONFIG_DIR` if the environment sets one,
 * else `~/SunaConfig`.
 *
 * It reads like "our own path", and every sentence below that names it still
 * quotes it. `$SUNA_CONFIG_DIR` is an environment variable and a home
 * directory is a directory name — both can hold any byte a filesystem allows,
 * including a newline, and both end up in an `error` sentence that `study.ts`
 * and the desktop host copy into notes a model reads. The exemption this used
 * to carry in `external-paths.test.ts` ("this process's own config location")
 * was true and still the wrong shape: it is exactly the "that path is ours"
 * exception `describeExternalError` above refuses for errno messages, and
 * ARCHITECTURE §3.1 D12 makes the same call for the library roots, which are quoted even
 * though the user typed them, so that the rule has no exception a later reader
 * has to remember. One call is cheaper than an exception.
 */
export function libraryConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(sunaConfigDir(env), LIBRARY_CONFIG_FILENAME)
}

/**
 * Read library.json. Never throws — every failure comes back as defaults plus
 * an `error` sentence naming the file, so the Settings pane and the MCP verbs
 * can both say "we are searching the default four folders because
 * ~/SunaConfig/library.json is not valid JSON" instead of behaving oddly for
 * no visible reason.
 */
export async function loadLibraryConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<LibraryConfigOutcome> {
  const path = libraryConfigPath(env)

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { config: freshDefaults(), path, source: 'defaults', error: null }
    }
    return {
      config: freshDefaults(),
      path,
      source: 'defaults',
      error: `could not read ${quoteExternalPath(path)} (${describeExternalError(error)}) — using the default library settings`
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      config: freshDefaults(),
      path,
      source: 'defaults',
      error: `${quoteExternalPath(path)} is not valid JSON (${describeExternalError(error)}) — using the default library settings; fix or delete the file`
    }
  }

  const validated = LibraryConfigSchema.safeParse(parsed)
  if (!validated.success) {
    const issues = validated.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    return {
      config: freshDefaults(),
      path,
      source: 'defaults',
      error: `${quoteExternalPath(path)} is not a valid library config (${issues}) — using the default library settings`
    }
  }

  return { config: validated.data, path, source: 'file', error: null }
}

/**
 * Merge `patch` over what is stored and write the result atomically
 * (tmp + rename, the same discipline `context/ensure.ts` uses for every other
 * writer here — a crash mid-write must not leave a truncated settings file).
 *
 * A patch that would produce an invalid config writes NOTHING and says so:
 * silently clamping a bad `maxDepth` would hide a Settings-pane bug, and
 * silently writing it would make the next load fall back to defaults with the
 * user's other choices lost.
 */
export async function saveLibraryConfig(
  patch: Partial<LibraryConfig>,
  env: NodeJS.ProcessEnv = process.env
): Promise<LibraryConfigOutcome> {
  const current = await loadLibraryConfig(env)
  const path = current.path
  const merged = { ...current.config, ...patch, schemaVersion: 1 as const }

  const validated = LibraryConfigSchema.safeParse(merged)
  if (!validated.success) {
    const issues = validated.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    return {
      config: current.config,
      path,
      source: current.source,
      error: `refusing to write ${quoteExternalPath(path)}: the requested settings are invalid (${issues}) — nothing was changed`
    }
  }

  try {
    await writeAtomic(path, JSON.stringify(validated.data, null, 2) + '\n')
  } catch (error) {
    return {
      config: current.config,
      path,
      source: current.source,
      error: `could not write ${quoteExternalPath(path)} (${describeExternalError(error)}) — nothing was changed`
    }
  }

  return { config: validated.data, path, source: 'file', error: null }
}

/**
 * The home directory a `~` expands to. `$HOME` (or `%USERPROFILE%`) wins over
 * `os.homedir()` for the same reason `sunaConfigDir` honours
 * `$SUNA_CONFIG_DIR`: a test, a sandbox or a user who relocated home must be
 * able to say so without the process having to lie about its identity.
 */
function homeFor(env: NodeJS.ProcessEnv): string {
  const home = env['HOME'] ?? env['USERPROFILE']
  return typeof home === 'string' && home.trim() !== '' ? home : homedir()
}

/**
 * Expand a leading `~`. Only the current user's home is expanded — `~alice`
 * is left alone rather than guessed at, since resolving another user's home
 * means reading the password database for a path we have no business reading.
 */
function expandHome(path: string, env: NodeJS.ProcessEnv): string {
  if (path === '~') return homeFor(env)
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homeFor(env), path.slice(2))
  return path
}

/**
 * Turn the stored roots into directories that can actually be walked.
 *
 * A configured root that is gone — an unplugged drive, a Zotero folder the
 * user never created — is **dropped and reported**, never an error: three
 * good roots and one missing one is a perfectly usable search, and the note
 * is what lets the caller say "searched 3 of 4 roots; ~/Papers does not
 * exist" instead of quietly searching less than the user thinks.
 *
 * Roots are symlink-resolved before deduping so `~/Zotero` and
 * `~/Dropbox/Zotero` pointing at one directory are walked once, not twice.
 *
 * Every path in a note is quoted, and the reason is the destination rather
 * than the source: these notes are re-emitted verbatim to a model (study.ts's
 * `scan: …` lines) and to the user through the desktop host, so they are the
 * same channel scan.ts's notes are, and being in a different file changes
 * nothing about who reads them. The configured root is the user's own text,
 * but `real` is a realpath result — its bytes belong to whoever made the link
 * — and `why` is an errno message that names the path it failed on.
 */
export async function expandRoots(
  config: LibraryConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<ExpandedRoots> {
  const roots: string[] = []
  const missing: string[] = []
  const notes: string[] = []
  /** realpath → the configured root that claimed it first, for the collapse note. */
  const seen = new Map<string, string>()

  for (const configured of config.roots) {
    const trimmed = configured.trim()
    if (trimmed === '') {
      notes.push('a blank library root was ignored')
      continue
    }

    const absolute = resolve(expandHome(trimmed, env))

    let info
    try {
      info = await stat(absolute)
    } catch (error) {
      missing.push(configured)
      const why =
        errorCode(error) === 'ENOENT' ? 'no such directory' : describeExternalError(error)
      notes.push(
        `library root ${quoteExternalPath(configured)} → ${quoteExternalPath(absolute)} skipped: ${why}`
      )
      continue
    }
    if (!info.isDirectory()) {
      missing.push(configured)
      notes.push(
        `library root ${quoteExternalPath(configured)} → ${quoteExternalPath(absolute)} skipped: not a directory`
      )
      continue
    }

    // realpath cannot fail here (stat just succeeded), but a race between the
    // two calls is possible and must not take the whole scan down with it.
    let real: string
    try {
      real = await realpath(absolute)
    } catch {
      real = absolute
    }

    const claimant = seen.get(real)
    if (claimant !== undefined) {
      if (claimant !== configured) {
        notes.push(
          `library root ${quoteExternalPath(configured)} is the same directory as ${quoteExternalPath(claimant)} (${quoteExternalPath(real)}); searched once`
        )
      }
      continue
    }
    seen.set(real, configured)
    roots.push(real)
  }

  return { roots, missing, notes }
}
