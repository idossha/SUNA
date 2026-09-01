import { app, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { EVENT_CHANNELS } from '@suna/core'
import { assertInsideAllowedRoot } from './roots'

/**
 * Jupyter kernels, one per open notebook, each fronted by the Python bridge
 * in `python/suna_kernel/bridge.py` (read its docstring for WHY the protocol
 * translation lives in Python rather than here).
 *
 * This module owns only the process and the pipe: it starts the bridge under
 * the project's selected interpreter, frames JSON lines both ways, and
 * forwards every event to the renderer untouched. It never interprets an
 * output — the renderer stores what the kernel said, verbatim, because that
 * same object is what ends up in the .ipynb.
 */

interface Session {
  child: ChildProcessWithoutNullStreams
  webContents: WebContents
  /** Partial line left over between stdout chunks. */
  buffer: string
}

const sessions = new Map<string, Session>()
let seq = 0

/**
 * The bridge script. Packaged, it ships beside the app's other resources;
 * in dev it is read straight out of the repo, the same split
 * `appMcpInvocation()` uses for the MCP server.
 */
export function bridgeScriptPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'python', 'suna_kernel', 'bridge.py')
  return resolve(app.getAppPath(), '..', '..', 'python', 'suna_kernel', 'bridge.py')
}

/**
 * Which python runs the bridge. An env's own interpreter, when one is
 * selected — that is the whole point of the picker, and it is also where
 * `ipykernel` will have been installed. With no env selected, `python3`:
 * bare `python` is not on PATH on a stock macOS or Debian.
 */
export function pythonFor(envPath: string | null): string {
  if (envPath === null) return 'python3'
  const binary = join(envPath, 'bin', 'python')
  return existsSync(binary) ? binary : 'python3'
}

function send(session: Session, id: string, event: unknown): void {
  if (!session.webContents.isDestroyed()) {
    session.webContents.send(EVENT_CHANNELS.kernelEvent(id), event)
  }
}

/**
 * Split a stdout chunk into whole JSON lines, keeping any partial tail for
 * the next chunk. A single base64 figure is megabytes and arrives in many
 * pieces, so this framing is not optional.
 */
export function takeLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const combined = buffer + chunk
  const parts = combined.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.filter((line) => line.trim() !== ''), rest }
}

export function startKernel(options: {
  cwd: string
  envPath: string | null
  kernelName: string
  webContents: WebContents
}): string {
  let cwd: string
  try {
    cwd = assertInsideAllowedRoot(options.cwd)
  } catch {
    cwd = homedir()
  }

  const child = spawn(
    pythonFor(options.envPath),
    [bridgeScriptPath(), options.kernelName, cwd],
    {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    }
  ) as ChildProcessWithoutNullStreams

  seq += 1
  const id = `kernel-${seq}`
  const session: Session = { child, webContents: options.webContents, buffer: '' }
  sessions.set(id, session)

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    const { lines, rest } = takeLines(session.buffer, chunk)
    session.buffer = rest
    for (const line of lines) {
      try {
        send(session, id, JSON.parse(line))
      } catch {
        // Not protocol — a library that printed to stdout despite the
        // bridge's contract. Logged, not forwarded, so one stray print
        // cannot break the stream.
        console.warn('[kernel] non-JSON on stdout:', line.slice(0, 200))
      }
    }
  })

  // The bridge's own diagnostics, plus anything the kernel launcher writes.
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => console.warn('[kernel]', chunk.trimEnd()))

  child.on('error', (error) => {
    send(session, id, {
      type: 'fatal',
      code: 'spawn-failed',
      message: `Could not start ${pythonFor(options.envPath)}: ${error.message}`
    })
  })

  child.on('exit', (code) => {
    sessions.delete(id)
    send(session, id, { type: 'exit', code })
  })

  return id
}

function write(id: string, request: unknown): void {
  const session = sessions.get(id)
  if (!session || session.child.stdin.destroyed) return
  session.child.stdin.write(`${JSON.stringify(request)}\n`)
}

export function executeInKernel(id: string, reqId: string, code: string): void {
  write(id, { id: reqId, op: 'execute', code })
}

export function interruptKernel(id: string): void {
  write(id, { op: 'interrupt' })
}

export function restartKernel(id: string): void {
  write(id, { op: 'restart' })
}

export function shutdownKernel(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  write(id, { op: 'shutdown' })
  // The bridge shuts its kernel down politely on that request; this is the
  // backstop for a bridge that has stopped reading its own stdin.
  const child = session.child
  setTimeout(() => {
    if (!child.killed) child.kill()
  }, 3000).unref()
}

/** Kill every kernel — called when the window closes so none leak. */
export function shutdownAllKernels(): void {
  for (const id of [...sessions.keys()]) shutdownKernel(id)
}
