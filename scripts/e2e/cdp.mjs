#!/usr/bin/env node
/**
 * Shared CDP driver kit for SUNA's e2e scripts (smoke.mjs, drive.mjs).
 *
 * - launchApp({ root, port, hidden, userData, env, logFile }) frees the port
 *   (never a global pkill) and spawns `pnpm dev` for apps/desktop with
 *   SUNA_DEBUG_PORT — hidden by default (SUNA_HIDDEN=1: window never shown,
 *   dock hidden, background throttling off so CDP input and screenshots keep
 *   working). With a logFile the child's stdio appends there and the child is
 *   unref()ed, so the caller can exit and leave the app running.
 * - connect({ port }) polls the CDP endpoint for the page target, opens its
 *   websocket, enables focus emulation (document.hasFocus() stays true in the
 *   hidden window) and returns the client: send / evalJs / screenshot /
 *   click / rclick / mouse / key / insertText / pinViewport / close.
 *
 * Usage:  import { launchApp, connect, sleep } from './cdp.mjs'
 */
import { spawn, execSync } from 'node:child_process'
import { openSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Spawn the dev app on `port` in its own process group. Kills only whatever
 * already holds the port, so parallel suites and unrelated Electron apps
 * survive. Returns { child, devLog, stop }: devLog collects stdio when no
 * logFile is given; stop() SIGTERMs the child's process group.
 */
export async function launchApp({ root, port, hidden = true, userData, env = {}, logFile }) {
  try {
    execSync(`lsof -ti tcp:${port} | xargs kill -9`, { stdio: 'ignore', shell: '/bin/bash' })
  } catch { /* port was free */ }

  const spawnEnv = {
    ...process.env,
    SUNA_DEBUG_PORT: String(port),
    ...(hidden ? { SUNA_HIDDEN: '1' } : {}),
    ...(userData ? { SUNA_USER_DATA: userData } : {}),
    ...env
  }
  const devLog = []
  let child
  if (logFile) {
    // append stdio to the log file and detach: the parent may exit while
    // the app keeps running (drive.mjs --boot)
    const fd = openSync(logFile, 'a')
    child = spawn('pnpm', ['dev'], {
      cwd: join(root, 'apps', 'desktop'),
      env: spawnEnv,
      stdio: ['ignore', fd, fd],
      detached: true
    })
    child.unref()
  } else {
    child = spawn('pnpm', ['dev'], {
      cwd: join(root, 'apps', 'desktop'),
      env: spawnEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    })
    child.stdout.on('data', (d) => devLog.push(String(d)))
    child.stderr.on('data', (d) => devLog.push(String(d)))
  }
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch { /* already gone */ }
  }
  return { child, devLog, stop }
}

/**
 * The app's own window, told apart from the hidden BrowserWindows the app
 * uses as renderers — the export preview and the PDF export both load a
 * generated page out of the temp katex-assets directory, and either can be
 * listed BEFORE the real window. Attaching to one of those is how a driver
 * ends up reporting `window.__sunaDev is undefined` on a perfectly healthy
 * app. The renderer is the dev server or the packaged index.html; anything
 * under file:///…/suna-katex-assets/ is a print job, never the shell.
 */
function isAppWindow(t) {
  if (t.type !== 'page') return false
  return !t.url.includes('suna-katex-assets')
}

/**
 * Poll the CDP endpoint until a page target answers, open its websocket and
 * return the client. `diagnostics` is an optional () => string appended to
 * the timeout error (a dev-log tail, typically).
 */
export async function connect({ port, timeoutMs = 60000, diagnostics }) {
  let target = null
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !target) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find(isAppWindow) ?? null
    } catch { /* not up yet */ }
    if (!target) await sleep(500)
  }
  if (!target) {
    const extra = diagnostics ? `\n${diagnostics()}` : ''
    throw new Error(`no CDP page target on :${port} after ${Math.round(timeoutMs / 1000)}s${extra}`)
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let msgId = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    const p = msg.id && pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      clearTimeout(p.timer)
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result)
    }
  }
  // A dead socket must fail every call waiting on it. Without this, closing or
  // erroring the connection leaves each pending promise unsettled forever —
  // the same silent park a missing per-call deadline causes, arrived at from
  // the other direction.
  const failAllPending = (why) => {
    for (const [id, p] of pending) {
      pending.delete(id)
      clearTimeout(p.timer)
      p.rej(new Error(why))
    }
  }
  ws.onclose = () => failAllPending('CDP websocket closed while a call was in flight')
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('CDP websocket failed'))
  })
  // Replace the connect-time handler: after open, an error must reject the
  // calls in flight rather than the (already settled) connect promise.
  ws.onerror = () => failAllPending('CDP websocket errored while a call was in flight')

  /**
   * Every CDP call gets a deadline.
   *
   * Measured 2026-09-01: roughly one smoke run in six parked forever in
   * `crossref-resolution`. The app was healthy — a second CDP client attached
   * and evaluated normally — so it is this connection that stalls, and with no
   * timeout the reply simply never came and an 80-step suite sat producing no
   * output until a human noticed. A hang is the worst failure mode a suite can
   * have: it looks identical to slow progress, and CI would burn its whole
   * job budget before saying anything.
   *
   * The default is deliberately GENEROUS rather than tight. Some evaluations
   * legitimately take minutes — the agent-CLI steps run against a 180 s budget
   * and `awaitPromise: true` means the call is outstanding for all of it. The
   * point is to convert "never" into "eventually, with a message naming the
   * method", not to police latency. Override per call for anything known to be
   * slower, or globally with SUNA_CDP_TIMEOUT_MS.
   */
  const DEFAULT_TIMEOUT_MS = Number(process.env['SUNA_CDP_TIMEOUT_MS'] ?? 240_000)

  function send(method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((res, rej) => {
      const id = ++msgId
      const startedAt = Date.now()
      const timer = setTimeout(() => {
        pending.delete(id)
        rej(
          new Error(
            `CDP ${method} did not answer within ${Math.round(timeoutMs / 1000)}s ` +
              `(waited ${Math.round((Date.now() - startedAt) / 1000)}s). The connection is ` +
              `stalled, not the app — see docs/TESTING.md. Raise SUNA_CDP_TIMEOUT_MS if this ` +
              `call is legitimately slower.`
          )
        )
      }, timeoutMs)
      // Never let a pending call keep the process alive on its own.
      timer.unref?.()
      pending.set(id, { res, rej, timer })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async function evalJs(expression, opts) {
    const r = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      opts
    )
    if (r.exceptionDetails) {
      throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception ?? {}).slice(0, 400)}`)
    }
    return r.result.value
  }

  async function screenshot(absPath) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(absPath, Buffer.from(shot.data, 'base64'))
  }

  const mouse = (type, x, y) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  const click = async (x, y) => {
    await mouse('mousePressed', x, y)
    await mouse('mouseReleased', x, y)
  }
  const key = (keyName, code, modifiers = 0) =>
    send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers })
      .then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers }))
  const insertText = (text) => send('Input.insertText', { text })
  /** Real right-click — Chromium synthesizes the `contextmenu` event from it,
   *  which is what editor/codemirror.ts's domEventHandler listens for. */
  const rclick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 })
  }

  /**
   * Pin the renderer's viewport before anything measures geometry.
   *
   * macOS window tiling hands the app an arbitrary remembered size, and
   * Electron does not implement CDP's Browser domain, so the OS window cannot
   * be resized from here — Emulation.setDeviceMetricsOverride pins the
   * renderer's viewport instead, which is what assertions and input events
   * actually see. The override is in device-independent pixels: on a display
   * with a non-integral scale factor Chromium folds the remainder into a page
   * zoom (Page.getLayoutMetrics().cssVisualViewport.zoom), so a raw width
   * lands at width/zoom CSS px. Scaling the request by that zoom pins the CSS
   * viewport itself; on an integral-scale display zoom is 1 and it's a no-op.
   */
  async function pinViewport({ width = 1600, height = 1100 } = {}) {
    const metrics = await send('Page.getLayoutMetrics')
    const pageZoom = metrics.cssVisualViewport?.zoom ?? 1
    await send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(width * pageZoom),
      height: Math.round(height * pageZoom),
      deviceScaleFactor: 2,
      mobile: false
    })
    await sleep(800)
    return evalJs(`({ w: window.innerWidth, h: window.innerHeight })`)
  }

  const close = () => {
    try {
      ws.close()
    } catch { /* already closed */ }
  }

  // The hidden window never gets OS focus; emulate it so document.hasFocus()
  // is true and focus-dependent UI (editors, menus) behaves normally.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })

  return { send, evalJs, screenshot, click, rclick, mouse, key, insertText, pinViewport, close }
}
