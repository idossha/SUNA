#!/usr/bin/env node
/**
 * SUNA end-to-end smoke test. Launches the app with a CDP endpoint and
 * drives the full loop against examples/demo-paper: open project → edit
 * manuscript → rendered mode → canvas open → drag → save (1-line diff) →
 * undo → save (byte-identical) → compliance clean.
 *
 * Usage:  node scripts/e2e/smoke.mjs        (or: pnpm smoke)
 * Exit 0 = all steps passed. Artifacts in scripts/e2e/.artifacts/.
 */
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXAMPLE = join(ROOT, 'examples', 'demo-paper')
const FIGURE = join(EXAMPLE, 'figures', 'fig-spectrum', 'figure.svg')
const ARTIFACTS = join(ROOT, 'scripts', 'e2e', '.artifacts')
const PORT = Number(process.env.SUNA_SMOKE_PORT ?? 9321)

mkdirSync(ARTIFACTS, { recursive: true })

// ---------------------------------------------------------------- CDP client
let ws
let msgId = 0
const pending = new Map()

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) {
    throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception ?? {}).slice(0, 400)}`)
  }
  return r.result.value
}

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(ARTIFACTS, name), Buffer.from(shot.data, 'base64'))
}

const mouse = (type, x, y) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
const key = (keyName, code, modifiers = 0) =>
  send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers })
    .then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers }))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- harness
const results = []
async function step(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: String(error.message ?? error) })
    console.error(`  ✗ ${name}: ${error.message ?? error}`)
    await screenshot(`FAIL-${name}.png`).catch(() => {})
    throw error
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

// ---------------------------------------------------------------- run
console.log('SUNA smoke test')
try {
  execSync('pkill -f "electron-vite dev" ; pkill -f "Electron.app/Contents/MacOS/Electron"', {
    stdio: 'ignore', shell: '/bin/bash'
  })
} catch { /* nothing to kill */ }
await sleep(500)

const originalSvg = readFileSync(FIGURE, 'utf8')

const child = spawn('pnpm', ['dev'], {
  cwd: join(ROOT, 'apps', 'desktop'),
  env: { ...process.env, SUNA_DEBUG_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
})
const devLog = []
child.stdout.on('data', (d) => devLog.push(String(d)))
child.stderr.on('data', (d) => devLog.push(String(d)))

function cleanup() {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch { /* already gone */ }
  try {
    execSync('pkill -f "Electron.app/Contents/MacOS/Electron"', { stdio: 'ignore' })
  } catch { /* already gone */ }
}
process.on('exit', cleanup)

let exitCode = 0
try {
  // wait for CDP
  let target = null
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && !target) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
    } catch { /* not up yet */ }
    if (!target) await sleep(500)
  }
  assert(target, `no CDP page target on :${PORT} after 60s\n${devLog.join('').slice(-2000)}`)

  ws = new WebSocket(target.webSocketDebuggerUrl)
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    const p = msg.id && pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result)
    }
  }
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('CDP websocket failed'))
  })
  await sleep(1500)

  await step('app-loads-welcome', async () => {
    const ok = await evalJs(`!!document.querySelector('.welcome__title')`)
    assert(ok, 'welcome screen not rendered')
  })

  await step('open-example-project', async () => {
    await evalJs(`(() => {
      const btn = [...document.querySelectorAll('.welcome__actions button')]
        .find((b) => b.textContent.includes('example'));
      if (!btn) throw new Error('Open example button missing');
      btn.click();
    })()`)
    await sleep(2000)
    const state = await evalJs(`({
      profile: document.querySelector('.statusbar__profile')?.textContent ?? null,
      tree: !!document.querySelector('.tree'),
      dev: typeof window.__sunaDev === 'object'
    })`)
    assert(state.profile === 'Nature Astronomy', `profile chip: ${state.profile}`)
    assert(state.tree, 'explorer tree missing')
    assert(state.dev, '__sunaDev seam missing (not a dev build?)')
    await screenshot('01-project-open.png')
  })

  await step('editor-opens-section', async () => {
    const text = await evalJs(`document.querySelector('.cm-content')?.textContent ?? ''`)
    assert(text.includes('Galaxies falling'), 'intro section not in editor')
  })

  await step('rendered-mode', async () => {
    await evalJs(`document.querySelector('.editor-tab__mode').click()`)
    await sleep(400)
    const r = await evalJs(`({
      katex: !!document.querySelector('.scimark .katex'),
      cite: !!document.querySelector('.scimark sup.cite'),
      eqId: !!document.querySelector('.scimark [id="eq:stripping"]')
    })`)
    assert(r.katex, 'KaTeX math missing in rendered view')
    assert(r.cite, 'citation chip missing in rendered view')
    assert(r.eqId, 'equation anchor missing in rendered view')
    await screenshot('02-rendered.png')
    await evalJs(`document.querySelector('.editor-tab__mode').click()`)
  })

  await step('canvas-opens-figure', async () => {
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(FIGURE)})`)
    await sleep(1500)
    const r = await evalJs(`({
      svg: !!document.querySelector('.canvas-world svg'),
      artboard: document.querySelector('.canvas-tab__meta')?.textContent ?? ''
    })`)
    assert(r.svg, 'figure SVG not mounted on canvas')
    assert(r.artboard.includes('180.0'), `artboard label: ${r.artboard}`)
    await screenshot('03-canvas.png')
  })

  await step('compliance-clean', async () => {
    const chip = await evalJs(`document.querySelector('.canvas-tab__issues')?.textContent ?? null`)
    if (chip !== null) {
      await evalJs(`document.querySelector('.canvas-tab__issues').click()`)
      await sleep(200)
      const msgs = await evalJs(
        `[...document.querySelectorAll('.canvas-diagnostics__msg')].map((e) => e.textContent)`
      )
      throw new Error(`example figure should be compliant, got: ${chip} — ${msgs.join(' | ')}`)
    }
  })

  await step('canvas-drag-and-save', async () => {
    // probe inside the target's bbox for a point that actually hits it
    // (text glyphs have gaps; frameless legends are mostly holes)
    const center = await evalJs(`(() => {
      const id = 'ax0.title.left';
      const el = document.querySelector('.canvas-world svg [id="' + id + '"]');
      if (!el) throw new Error(id + ' not found in mounted SVG');
      const r = el.getBoundingClientRect();
      for (let iy = 1; iy < 6; iy++) {
        for (let ix = 1; ix < 6; ix++) {
          const x = r.left + (r.width * ix) / 6;
          const y = r.top + (r.height * iy) / 6;
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit.closest('[id="' + id + '"]') !== null)) return { x, y };
        }
      }
      throw new Error('no hittable point found inside ' + id);
    })()`)
    await mouse('mousePressed', center.x, center.y)
    for (let i = 1; i <= 6; i++) {
      await mouse('mouseMoved', center.x + i * 5, center.y + i * 3)
      await sleep(30)
    }
    await mouse('mouseReleased', center.x + 30, center.y + 18)
    await sleep(400)
    await key('s', 'KeyS', 4) // ⌘S
    await sleep(600)
    const edited = readFileSync(FIGURE, 'utf8')
    const diff = edited.split('\n').filter((line, i) => line !== originalSvg.split('\n')[i])
    assert(edited !== originalSvg, 'file did not change after drag+save')
    assert(diff.length === 1 && diff[0].includes('transform='),
      `expected a 1-line transform diff, got ${diff.length} differing lines`)
    await screenshot('04-dragged.png')
  })

  await step('canvas-undo-restores-bytes', async () => {
    await key('z', 'KeyZ', 4) // ⌘Z
    await sleep(300)
    await key('s', 'KeyS', 4)
    await sleep(600)
    const restored = readFileSync(FIGURE, 'utf8')
    assert(restored === originalSvg, 'undo+save did not restore byte-identical file')
  })

  console.log(`\nALL ${results.length} STEPS PASSED`)
} catch {
  exitCode = 1
  const failed = results.filter((r) => !r.ok)
  console.error(`\nFAILED: ${failed.map((f) => f.name).join(', ')}`)
  console.error(`artifacts: ${ARTIFACTS}`)
} finally {
  // never leave the working tree dirty
  writeFileSync(FIGURE, originalSvg)
  cleanup()
}
process.exit(exitCode)
