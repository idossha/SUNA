import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

/**
 * Watch the open project's `suna.json` for changes made outside the app —
 * ARCHITECTURE §6.1 ("watch suna.json for external edits (the user typing in
 * it, or an agent) and re-resolve live").
 *
 * Watches the *directory*, not the file. Every writer in this codebase —
 * `project:update-settings`, `manuscript:update`, the settings writer — writes
 * atomically (temp file + rename), which replaces the inode; a watcher bound
 * to the file itself would follow the old inode and go silent after the first
 * write. A non-recursive directory watch filtered to `suna.json` survives that,
 * and also catches a file created after the watch started.
 *
 * Exactly one project is watched at a time: `watchProjectManifest` replaces
 * whatever was watched before, and `dir === null` stops watching.
 */

/** Coalescing window: an atomic write shows up as several events in a few ms. */
export const MANIFEST_DEBOUNCE_MS = 120

interface ActiveWatch {
  dir: string
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

let active: ActiveWatch | null = null

/** Injectable for tests; defaults to node's fs.watch. */
export type WatchFactory = (
  dir: string,
  listener: (event: string, filename: string | null) => void
) => FSWatcher

const defaultWatchFactory: WatchFactory = (dir, listener) =>
  watch(dir, { persistent: false }, (event, filename) =>
    listener(event, typeof filename === 'string' ? filename : null)
  )

/**
 * True when a change event names the manifest. `fs.watch` reports the basename
 * on macOS/Linux and may report null on some platforms — a null filename is
 * treated as "something in the project root moved", which is rare enough that
 * an extra re-read costs nothing (the renderer only re-reads and re-resolves).
 */
export function isManifestEvent(manifestPath: string, filename: string | null): boolean {
  if (filename === null) return true
  return basename(filename) === basename(manifestPath)
}

export function stopWatchingProjectManifest(): void {
  if (active === null) return
  if (active.timer !== null) clearTimeout(active.timer)
  active.watcher.close()
  active = null
}

/**
 * Start (or move) the manifest watch. `notify` is called with the project dir,
 * debounced, whenever `suna.json` inside it changes. Returns false when the
 * directory could not be watched (it vanished, or the platform refused) —
 * best-effort by design: a project must still open without a watcher.
 */
export function watchProjectManifest(
  dir: string | null,
  notify: (dir: string) => void,
  watchFactory: WatchFactory = defaultWatchFactory
): boolean {
  if (active !== null && active.dir === dir) return true
  stopWatchingProjectManifest()
  if (dir === null) return false

  const manifestPath = `${dir}/suna.json`
  try {
    const watcher = watchFactory(dirname(manifestPath), (_event, filename) => {
      if (active === null || active.dir !== dir) return
      if (!isManifestEvent(manifestPath, filename)) return
      if (active.timer !== null) clearTimeout(active.timer)
      active.timer = setTimeout(() => {
        if (active !== null) active.timer = null
        notify(dir)
      }, MANIFEST_DEBOUNCE_MS)
    })
    watcher.on('error', () => stopWatchingProjectManifest())
    active = { dir, watcher, timer: null }
    return true
  } catch {
    return false
  }
}

/** The directory currently being watched, or null. Exported for tests. */
export function watchedProjectDir(): string | null {
  return active?.dir ?? null
}
