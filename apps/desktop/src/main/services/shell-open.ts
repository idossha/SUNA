import { shell } from 'electron'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { assertInsideAllowedRoot } from './roots'

/**
 * Extensions the OS LAUNCHES rather than opens in a viewer. `.app` and
 * `.workflow` are bundles (directories on disk), which is why the extension
 * test has to run before the "directories are fine" rule below.
 */
const LAUNCHABLE_EXTENSIONS = new Set([
  '.app',
  '.command',
  '.pkg',
  '.dmg',
  '.scpt',
  '.workflow',
  '.term'
])

/** S_IXUSR. Only the owner bit counts — a data file that happens to be g+x is not a program. */
const USER_EXECUTE = 0o100

/**
 * Would opening this entry with the OS run code? Pure so the refusal table is
 * testable without asking the OS to open anything.
 *
 * The reason is concrete rather than theoretical: since feature-plan-8 an agent
 * can write files into the project, and "Open with Default App" must never
 * become "run whatever the agent just wrote".
 */
export function isRefusedForOpen(entry: {
  path: string
  isDirectory: boolean
  mode: number
}): boolean {
  if (LAUNCHABLE_EXTENSIONS.has(extname(entry.path).toLowerCase())) return true
  // A plain directory is allowed on purpose — that opens a Finder window, which
  // is exactly what the user asked for. Directories also carry the execute bit
  // in the normal 0o755 case, so this must return before the mode test.
  if (entry.isDirectory) return false
  return (entry.mode & USER_EXECUTE) !== 0
}

/**
 * Show the entry in the OS file manager (Finder on macOS). Root-confined like
 * every other path the renderer names. Reveal cannot run anything, so there is
 * no executable check here — only the confinement.
 */
export async function revealPath(path: string): Promise<{ error: string | null }> {
  const abs = assertInsideAllowedRoot(path)
  // showItemInFolder is fire-and-forget with no return value: a vanished path
  // would silently do nothing, so say so instead.
  const info = await stat(abs).catch(() => null)
  if (info === null) return { error: `no longer on disk: ${basename(abs)}` }
  shell.showItemInFolder(abs)
  return { error: null }
}

/**
 * Hand the entry to the OS's default application. Root-confined, and refuses
 * anything executable per isRefusedForOpen. The refusal names the file so the
 * renderer can put it straight in a status note.
 */
export async function openPathWithOs(path: string): Promise<{ error: string | null }> {
  const abs = assertInsideAllowedRoot(path)
  const info = await stat(abs).catch(() => null)
  if (info === null) return { error: `no longer on disk: ${basename(abs)}` }
  if (isRefusedForOpen({ path: abs, isDirectory: info.isDirectory(), mode: info.mode })) {
    return { error: `refusing to open an executable with the OS: ${basename(abs)}` }
  }
  // Electron resolves openPath with '' on success and a message on failure.
  const failure = await shell.openPath(abs)
  return { error: failure === '' ? null : failure }
}
