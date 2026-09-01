import { watch, type FSWatcher } from 'node:fs'

/**
 * Watch the open project's whole directory tree and tell the renderer when
 * anything in it moves, so the explorer reflects reality without the user
 * having to know that a refresh exists.
 *
 * This exists because `refreshTree()` used to be called by hand at the few
 * places the RENDERER happened to write a file (create, rename, delete). Every
 * other way a project changes — a DOCX/PDF export written by the main process,
 * an agent editing through MCP, a `git checkout` in the built-in terminal,
 * Finder — left the tree silently stale. A watch on the directory is the only
 * thing that covers all of them at once.
 *
 * Recursive: `fs.watch(dir, { recursive: true })` is native on macOS and has
 * been supported on Linux since Node 20. If it is refused we fall back
 * to a NON-recursive watch of the project root, which still catches the common
 * case (a file appearing at the top level) rather than giving up entirely.
 *
 * Events are coalesced: a single save can emit several, and a `git checkout`
 * or an export emits a burst. The renderer's reaction is a full re-list, so
 * collapsing a burst into one notification is both cheaper and sufficient.
 */

/** Coalescing window. Long enough to swallow a burst, short enough to feel live. */
export const TREE_DEBOUNCE_MS = 150

/**
 * Path segments whose changes never matter to the explorer — it does not show
 * them (see IGNORED_NAMES in fs.ts), and `.git` in particular churns
 * constantly during any git operation, which would otherwise re-list the tree
 * dozens of times for a single commit.
 */
const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store'])

interface ActiveWatch {
  dir: string
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

let active: ActiveWatch | null = null

/** Injectable for tests; defaults to node's fs.watch. */
export type TreeWatchFactory = (
  dir: string,
  recursive: boolean,
  listener: (event: string, filename: string | null) => void
) => FSWatcher

const defaultTreeWatchFactory: TreeWatchFactory = (dir, recursive, listener) =>
  watch(dir, { persistent: false, recursive }, (event, filename) =>
    listener(event, typeof filename === 'string' ? filename : null)
  )

/**
 * True when a change event is worth a re-list. A null filename (which some
 * platforms report) counts: it means "something moved" and an extra re-list
 * costs one directory walk.
 */
export function isRelevantTreeEvent(filename: string | null): boolean {
  if (filename === null) return true
  return !filename.split('/').some((segment) => IGNORED_SEGMENTS.has(segment))
}

export function stopWatchingProjectTree(): void {
  if (active === null) return
  if (active.timer !== null) clearTimeout(active.timer)
  active.watcher.close()
  active = null
}

/**
 * Start (or move) the tree watch. `notify` is called with the project dir,
 * debounced, whenever anything inside it changes. Returns false when the
 * directory could not be watched at all — best-effort by design, exactly like
 * the manifest watch: a project must still open without a watcher, the
 * explorer just goes back to updating only on the app's own writes.
 */
export function watchProjectTree(
  dir: string | null,
  notify: (dir: string) => void,
  watchFactory: TreeWatchFactory = defaultTreeWatchFactory
): boolean {
  if (active !== null && active.dir === dir) return true
  stopWatchingProjectTree()
  if (dir === null) return false

  const onChange = (_event: string, filename: string | null): void => {
    if (active === null || active.dir !== dir) return
    if (!isRelevantTreeEvent(filename)) return
    if (active.timer !== null) clearTimeout(active.timer)
    active.timer = setTimeout(() => {
      if (active !== null) active.timer = null
      notify(dir)
    }, TREE_DEBOUNCE_MS)
  }

  for (const recursive of [true, false]) {
    try {
      const watcher = watchFactory(dir, recursive, onChange)
      watcher.on('error', () => stopWatchingProjectTree())
      active = { dir, watcher, timer: null }
      return true
    } catch {
      // recursive refused (older platform / unsupported fs): try flat next
    }
  }
  return false
}

/** The directory currently being watched, or null. Exported for tests. */
export function watchedTreeDir(): string | null {
  return active?.dir ?? null
}
