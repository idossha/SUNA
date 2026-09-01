import type { WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EVENT_CHANNELS } from '@suna/core'
import { assertInsideAllowedRoot } from './roots'
import { sunaMplProjectPath } from './suna-mpl'

/**
 * Pty sessions keyed by id. Output is pushed to the renderer over
 * EVENT_CHANNELS.termData/termExit; the renderer owns presentation (xterm).
 */
interface Session {
  pty: IPty
  webContents: WebContents
  /**
   * Recent output, so a renderer that reloaded can be handed back a terminal
   * that still reads like the one it lost. The pty is the only place this
   * text ever existed — xterm's scrollback dies with the renderer — so
   * without it, re-adopting a live session would show a blank window with a
   * running agent in it, which looks broken even though it is not.
   */
  replay: string
}

/** ~200 KB of tail: several screens of a `claude` session, bounded. */
const REPLAY_LIMIT = 200_000

const sessions = new Map<string, Session>()
let seq = 0

function loginShell(): { file: string; args: string[] } {
  const shell = process.env['SHELL'] ?? '/bin/zsh'
  // login shell so the user's profile (PATH, conda hooks) is sourced
  return { file: shell, args: ['-l'] }
}

/**
 * Environment for the pty. A selected python env is activated the way its
 * tool would: bin/ first on PATH, plus the marker variable the shell prompt
 * and tooling look for.
 *
 * `SUNA_MPL` is exported here for one reason: `suna_mpl` is not on PyPI, so
 * a figure script that imports it can only run through the copy SUNA ships,
 * and that copy is in a different place in a checkout than in a packaged app
 * (§16.1, §20.6). Scripts therefore write
 * `uv run --no-project --with "${SUNA_MPL:-../../python/suna_mpl}"`, which
 * resolves in this terminal in either layout and still falls back to the
 * repo-relative path in a checkout shell that SUNA never launched.
 */
function ptyEnv(envPath: string | null): Record<string, string> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') base[key] = value
  }
  // Electron injects these; they confuse child node/python tooling.
  delete base['ELECTRON_RUN_AS_NODE']
  delete base['ELECTRON_RENDERER_URL']
  base['TERM'] = 'xterm-256color'

  const sunaMpl = sunaMplProjectPath()
  if (sunaMpl !== null) base['SUNA_MPL'] = sunaMpl

  if (envPath !== null) {
    const bin = join(envPath, 'bin')
    base['PATH'] = `${bin}:${base['PATH'] ?? ''}`
    // conda envs carry a conda-meta directory; venv/uv envs carry pyvenv.cfg
    base['VIRTUAL_ENV'] = envPath
    base['CONDA_PREFIX'] = envPath
  }
  return base
}

export function createTerminal(options: {
  cwd: string
  cols: number
  rows: number
  envPath: string | null
  webContents: WebContents
}): string {
  // the cwd must be inside an opened project (or the user's home as fallback)
  let cwd: string
  try {
    cwd = assertInsideAllowedRoot(options.cwd)
  } catch {
    cwd = homedir()
  }

  const { file, args } = loginShell()
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd,
    env: ptyEnv(options.envPath)
  })

  seq += 1
  const id = `term-${seq}`
  const { webContents } = options
  const session: Session = { pty, webContents, replay: '' }
  sessions.set(id, session)

  // Both handlers read session.webContents rather than closing over the
  // original: an adopted session is bound to a NEW renderer, and output has
  // to follow it there.
  pty.onData((data) => {
    session.replay = (session.replay + data).slice(-REPLAY_LIMIT)
    if (!session.webContents.isDestroyed()) {
      session.webContents.send(EVENT_CHANNELS.termData(id), data)
    }
  })
  pty.onExit(({ exitCode }) => {
    sessions.delete(id)
    if (!session.webContents.isDestroyed()) {
      session.webContents.send(EVENT_CHANNELS.termExit(id), { exitCode })
    }
  })

  return id
}

/** Live pty ids, for a renderer asking which of its sessions survived it. */
export function listTerminals(): string[] {
  return [...sessions.keys()]
}

/**
 * Re-point a live pty at a new renderer and hand back its recent output.
 *
 * A renderer reload (⌘R, or a dev hot reload) destroys every store the UI
 * kept but not the ptys, which live here — so without this the floating
 * agent terminal became an invisible process nobody could reach. Returns
 * null when the id names nothing: the caller then knows to forget it rather
 * than wait for a window that will never appear.
 */
export function adoptTerminal(id: string, webContents: WebContents): { replay: string } | null {
  const session = sessions.get(id)
  if (!session) return null
  session.webContents = webContents
  return { replay: session.replay }
}

export function writeTerminal(id: string, data: string): void {
  sessions.get(id)?.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  try {
    sessions.get(id)?.pty.resize(cols, rows)
  } catch {
    // the pty may have exited between the resize event and this call
  }
}

export function killTerminal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  try {
    session.pty.kill()
  } catch {
    // already gone
  }
}

/** Kill every pty — called when the window closes so no shells leak. */
export function killAllTerminals(): void {
  for (const id of [...sessions.keys()]) killTerminal(id)
}
