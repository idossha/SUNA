import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

/**
 * Watch the open project's `.git` directory so Source Control reflects the
 * repository the moment it moves.
 *
 * The tree watch (projectTreeWatch.ts) deliberately ignores `.git`, because
 * the explorer does not show it and it churns during every git operation. But
 * that churn is exactly what Source Control cares about: `git add` in the
 * built-in terminal, a commit from an agent, a branch switch, a rebase — none
 * of them touch the working tree in a way the tree watch reports, and all of
 * them rewrite files here. Watching both, with the worktree side already
 * covered, is what makes the view live rather than "live on save".
 *
 * Only the entries that change what the view shows are reacted to: the index,
 * HEAD and its refs, and the in-progress-operation markers. `.git/objects`
 * (written constantly, meaning nothing on its own) and the lock files git
 * creates and removes around every write are ignored, or a single commit would
 * fan out into a dozen re-reads.
 */

/** Coalescing window: one commit rewrites index, HEAD, refs and logs in a burst. */
export const GIT_DEBOUNCE_MS = 120

const RELEVANT_PREFIXES = [
  'index',
  'HEAD',
  'ORIG_HEAD',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'refs',
  'packed-refs',
  'rebase-merge',
  'rebase-apply',
  // `git remote add` and `git branch -u` write here and touch nothing else.
  // Without it, adding a remote in the built-in terminal leaves the panel
  // showing "no remote" — and Fetch/Pull/Push greyed out — indefinitely.
  'config'
]

/**
 * True when a `.git` event is worth a re-read. A null filename (reported on
 * some platforms) counts — "something in .git moved" is rare enough that an
 * extra status read costs nothing.
 */
export function isRelevantGitEvent(filename: string | null): boolean {
  if (filename === null) return true
  const normalized = filename.replace(/\\/g, '/')
  // Lock files exist only for the microseconds of a write, and their creation
  // and deletion would double every burst.
  if (normalized.endsWith('.lock')) return false
  return RELEVANT_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  )
}

interface ActiveWatch {
  dir: string
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

let active: ActiveWatch | null = null

/** Injectable for tests; defaults to node's fs.watch. */
export type GitWatchFactory = (
  gitDir: string,
  recursive: boolean,
  listener: (event: string, filename: string | null) => void
) => FSWatcher

const defaultGitWatchFactory: GitWatchFactory = (gitDir, recursive, listener) =>
  watch(gitDir, { persistent: false, recursive }, (event, filename) =>
    listener(event, typeof filename === 'string' ? filename : null)
  )

export function stopWatchingGit(): void {
  if (active === null) return
  if (active.timer !== null) clearTimeout(active.timer)
  active.watcher.close()
  active = null
}

/**
 * Start (or move) the `.git` watch. `notify` is called with the PROJECT dir,
 * debounced. Returns false when there is nothing to watch — a project that is
 * not a repository yet, or a platform that refuses the watch. Best-effort by
 * design: the view still refreshes on its own actions and on window focus.
 */
export function watchGitDir(
  dir: string | null,
  notify: (dir: string) => void,
  watchFactory: GitWatchFactory = defaultGitWatchFactory
): boolean {
  if (active !== null && active.dir === dir) return true
  stopWatchingGit()
  if (dir === null) return false

  const onChange = (_event: string, filename: string | null): void => {
    if (active === null || active.dir !== dir) return
    if (!isRelevantGitEvent(filename)) return
    if (active.timer !== null) clearTimeout(active.timer)
    active.timer = setTimeout(() => {
      if (active !== null) active.timer = null
      notify(dir)
    }, GIT_DEBOUNCE_MS)
  }

  const gitDir = join(dir, '.git')
  for (const recursive of [true, false]) {
    try {
      const watcher = watchFactory(gitDir, recursive, onChange)
      watcher.on('error', () => stopWatchingGit())
      active = { dir, watcher, timer: null }
      return true
    } catch {
      // recursive refused, or no .git yet (the project is not a repo): fall
      // through to the flat attempt, then give up quietly.
    }
  }
  return false
}

/** The project dir whose `.git` is being watched, or null. Exported for tests. */
export function watchedGitDir(): string | null {
  return active?.dir ?? null
}
