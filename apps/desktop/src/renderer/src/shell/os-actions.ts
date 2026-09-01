/**
 * "Reveal in Finder" / "Open with Default App" for the explorer
 * (ARCHITECTURE §5.3). The menu items and the ⌥⌘R / ⌥⌘O row bindings live in
 * ExplorerView; what lives here is everything that is not a React tree — the
 * platform wording and the two IPC calls — so the view stays a view and the
 * wording stays testable in node.
 *
 * Nothing here decides whether an action is SAFE. Root confinement and the
 * refusal to launch anything executable are enforced in main, where a renderer
 * bug cannot skip them. This side's job is to name the file that was refused:
 * a bare "refusing to open an executable file" in the status bar leaves the
 * user guessing which row it meant.
 */
import { useUiStore } from '../state/ui'

export type OsAction = 'reveal' | 'open'

export interface OsActionLabels {
  reveal: string
  open: string
}

/**
 * Menu wording for `platform` — a `process.platform` value, i.e.
 * `window.suna.platform`. SUNA supports macOS and Linux; anything that is not
 * macOS gets the neutral phrasing rather than a guess between Nautilus,
 * Dolphin and Thunar. "Open with Default App" is platform-neutral already: it
 * names what the OS does, not which OS is doing it.
 */
export function osActionLabels(platform: string): OsActionLabels {
  const reveal = platform === 'darwin' ? 'Reveal in Finder' : 'Show in File Manager'
  return { reveal, open: 'Open with Default App' }
}

/**
 * The chords the tree binds on the focused row, as palette/shortcuts.ts specs
 * (`formatShortcut` renders them ⌘⌥R / ⌘⌥O). Kept beside the labels so the
 * menu's accelerator text and the key handler can never drift apart.
 */
export const OS_ACTION_SHORTCUTS: Readonly<Record<OsAction, string>> = {
  reveal: 'Mod-Alt-KeyR',
  open: 'Mod-Alt-KeyO'
}

/**
 * Last path segment. These paths come from the main process on the machine
 * SUNA is running on — macOS or Linux — so '/' is the only separator, and a
 * backslash is an ordinary (if unusual) character in a file name rather than
 * something to split on.
 */
function baseName(path: string): string {
  const segments = path.split('/').filter((segment) => segment !== '')
  return segments[segments.length - 1] ?? path
}

const VERBS: Readonly<Record<OsAction, string>> = { reveal: 'reveal', open: 'open' }

/** Status note for a refused or failed action, always naming the file. */
export function osActionFailureNote(action: OsAction, path: string, reason: string): string {
  return `Could not ${VERBS[action]} ${baseName(path)}: ${reason}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs one OS action and reports its refusal, if any. Returns whether the OS
 * took it — a rejected invoke (main's `assertInsideAllowedRoot` throws) is the
 * same kind of "no" as a non-null `error`, and gets the same named note.
 */
async function handOff(
  action: OsAction,
  path: string,
  call: () => Promise<{ error: string | null }>
): Promise<boolean> {
  try {
    const { error } = await call()
    if (error === null) return true
    useUiStore.getState().setStatusNote(osActionFailureNote(action, path, error))
    return false
  } catch (error) {
    useUiStore.getState().setStatusNote(osActionFailureNote(action, path, messageOf(error)))
    return false
  }
}

/** Show the file in Finder / Explorer / the platform's file manager. */
export function revealInOs(path: string): Promise<boolean> {
  return handOff('reveal', path, () => window.suna.invoke('shell:reveal', { path }))
}

/** Hand the file to the OS's default application for it. */
export function openWithOs(path: string): Promise<boolean> {
  return handOff('open', path, () => window.suna.invoke('shell:open-path', { path }))
}
