import type { WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EVENT_CHANNELS } from '@suna/core'
import { assertInsideAllowedRoot } from './roots'

/**
 * Pty sessions keyed by id. Output is pushed to the renderer over
 * EVENT_CHANNELS.termData/termExit; the renderer owns presentation (xterm).
 */
interface Session {
  pty: IPty
  webContents: WebContents
}

const sessions = new Map<string, Session>()
let seq = 0

function loginShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env['COMSPEC'] ?? 'powershell.exe', args: [] }
  }
  const shell = process.env['SHELL'] ?? '/bin/zsh'
  // login shell so the user's profile (PATH, conda hooks) is sourced
  return { file: shell, args: ['-l'] }
}

/**
 * Environment for the pty. A selected python env is activated the way its
 * tool would: bin/ first on PATH, plus the marker variable the shell prompt
 * and tooling look for.
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

  if (envPath !== null) {
    const bin = process.platform === 'win32' ? join(envPath, 'Scripts') : join(envPath, 'bin')
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
  sessions.set(id, { pty, webContents })

  pty.onData((data) => {
    if (!webContents.isDestroyed()) {
      webContents.send(EVENT_CHANNELS.termData(id), data)
    }
  })
  pty.onExit(({ exitCode }) => {
    sessions.delete(id)
    if (!webContents.isDestroyed()) {
      webContents.send(EVENT_CHANNELS.termExit(id), { exitCode })
    }
  })

  return id
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
