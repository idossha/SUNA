#!/usr/bin/env node
/**
 * Persistent dev driver: boot the app ONCE (hidden, own userData), leave it
 * running detached, then attach in milliseconds for screenshots, evals and
 * probe scripts — the fast inner loop that a full smoke run is too heavy for.
 *
 * State lives in scripts/e2e/.userdata-drive (never wiped automatically):
 * drive.json records {pid, port}; dev.log collects the app's stdio.
 *
 * Usage:
 *   node scripts/e2e/drive.mjs --boot --example        boot hidden + open the example project
 *   node scripts/e2e/drive.mjs --shot /tmp/app.png     screenshot the running app
 *   node scripts/e2e/drive.mjs --eval "location.href"  evaluate in the page, print the result
 *   node scripts/e2e/drive.mjs probe.mjs               run a probe: await mod.default(ctx)
 *   node scripts/e2e/drive.mjs --stop                  stop the app, remove drive.json
 *
 * Also: --boot [--show] [--port N] [--project <dir>], --status, and --no-pin
 * to skip the viewport re-pin on attach. A probe's ctx is the cdp.mjs client
 * plus sleep and waitFor(exprOrFn, { timeoutMs, intervalMs, desc }).
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connect, launchApp, sleep } from './cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const USER_DATA = join(ROOT, 'scripts', 'e2e', '.userdata-drive')
const STATE_FILE = join(USER_DATA, 'drive.json')
const LOG_FILE = join(USER_DATA, 'dev.log')
const DEFAULT_PORT = 9310
const HIDDEN_MARKER = '[suna] hidden test mode: window hidden, dock hidden'

// ---------------------------------------------------------------- arguments
function usage() {
  console.log(`SUNA dev driver — boot once, attach fast. State: scripts/e2e/.userdata-drive

  node scripts/e2e/drive.mjs --boot [--show] [--port N] [--example | --project <dir>]
  node scripts/e2e/drive.mjs --shot <out.png>   [--no-pin]
  node scripts/e2e/drive.mjs --eval "<expr>"    [--no-pin]
  node scripts/e2e/drive.mjs <script.mjs>       run probe: await mod.default(ctx)
  node scripts/e2e/drive.mjs --status
  node scripts/e2e/drive.mjs --stop`)
}

const args = process.argv.slice(2)
const opts = { port: DEFAULT_PORT, portSet: false, pin: true }
let command = null
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--boot' || a === '--stop' || a === '--status') command = a.slice(2)
  else if (a === '--shot') {
    command = 'shot'
    opts.out = args[++i]
  } else if (a === '--eval') {
    command = 'eval'
    opts.expr = args[++i]
  } else if (a === 'run') {
    command = 'run'
    opts.script = args[++i]
  } else if (a === '--show') opts.show = true
  else if (a === '--no-pin') opts.pin = false
  else if (a === '--port') {
    opts.port = Number(args[++i])
    opts.portSet = true
  } else if (a === '--example') opts.example = true
  else if (a === '--project') opts.project = args[++i]
  else if (a.endsWith('.mjs')) {
    command = 'run'
    opts.script = a
  } else {
    console.error(`unknown argument: ${a}\n`)
    usage()
    process.exit(1)
  }
}

if (opts.example && opts.project) {
  console.error('--example and --project are mutually exclusive')
  process.exit(1)
}

// ---------------------------------------------------------------- helpers
function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return null
  }
}

async function cdpAlive(port) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    return list.some((t) => t.type === 'page')
  } catch {
    return false
  }
}

/** The cdp.mjs client plus the probe-script conveniences. */
function makeCtx(client) {
  const waitFor = async (exprOrFn, { timeoutMs = 10000, intervalMs = 200, desc } = {}) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = typeof exprOrFn === 'function' ? await exprOrFn() : await client.evalJs(exprOrFn)
      if (value) return value
      if (Date.now() > deadline) {
        throw new Error(`timed out after ${timeoutMs}ms waiting for ${desc ?? String(exprOrFn).slice(0, 80)}`)
      }
      await sleep(intervalMs)
    }
  }
  return { ...client, sleep, waitFor }
}

/**
 * Attach to the running instance. Never auto-boots: a boot takes ~30s and
 * would turn a typo'd port into a surprise second app instance.
 */
async function attach() {
  const state = readState()
  const port = opts.portSet ? opts.port : state?.port ?? opts.port
  if (!(await cdpAlive(port))) {
    console.error(`no running app on :${port} — boot first: node scripts/e2e/drive.mjs --boot`)
    process.exit(1)
  }
  const client = await connect({ port, timeoutMs: 10000 })
  // Emulation overrides are cleared when a CDP session detaches, so re-pin
  // the viewport on every attach unless --no-pin asked otherwise.
  if (opts.pin) await client.pinViewport()
  return { client, port }
}

// ---------------------------------------------------------------- open project
/**
 * Same page-side seam as smoke.mjs's 'open-example-project' step: the welcome
 * screen's "Open example" button copies examples/hello-suna under userData
 * and git-inits it — copy + init + tree listing take a moment on first open.
 */
async function openExample(ctx) {
  await ctx.waitFor(`!!document.querySelector('.welcome__title')`, {
    timeoutMs: 20000,
    desc: 'welcome screen'
  })
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev' })
  await ctx.evalJs(`window.__sunaDev.projectStore.getState().openExampleProject()`)
  const rootDir = await ctx.waitFor(
    `window.__sunaDev ? window.__sunaDev.projectStore.getState().rootDir : null`,
    { timeoutMs: 20000, desc: 'project rootDir after open-example' }
  )
  console.log(`opened example project at ${rootDir}`)
  return rootDir
}

async function openProject(ctx, dir) {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev' })
  await ctx.evalJs(`window.__sunaDev.openProjectAt(${JSON.stringify(dir)})`)
  const rootDir = await ctx.waitFor(`window.__sunaDev.projectStore.getState().rootDir`, {
    timeoutMs: 20000,
    desc: 'project rootDir after openProjectAt'
  })
  console.log(`opened project at ${rootDir}`)
  return rootDir
}

/**
 * Rebuild packages/agent/dist-mcp/server.mjs before every boot (esbuild,
 * ~90 ms). The app spawns that BUNDLE for MCP, not the TypeScript sources,
 * and nothing else in the dev loop regenerates it — so without this a probe
 * exercises whichever agent build happened to be on disk, and a just-fixed
 * verb still behaves like the old one.
 */
function buildMcpBundle() {
  try {
    execSync('node build-mcp.mjs', { cwd: join(ROOT, 'packages', 'agent'), stdio: 'ignore' })
  } catch (error) {
    console.warn(`warning: could not rebuild the MCP bundle — ${error.message}`)
  }
}

// ---------------------------------------------------------------- commands
async function boot() {
  mkdirSync(USER_DATA, { recursive: true })
  buildMcpBundle()
  if (await cdpAlive(opts.port)) {
    const ignored = opts.example || opts.project ? ' — --example/--project ignored, the running instance keeps its project' : ''
    console.log(`already running on :${opts.port} — reusing${ignored} (stop with --stop)`)
    return
  }
  // dev.log appends across boots; remember where this boot's output starts
  // so the hidden-marker check below can't match a previous run's line.
  const logStart = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0
  const { child } = await launchApp({
    root: ROOT,
    port: opts.port,
    hidden: !opts.show,
    userData: USER_DATA,
    // The user's real ~/.suna must never be touched by a driven run: their
    // config.yml and themes live there, and the app writes settings into it.
    env: { SUNA_CONFIG_HOME: join(USER_DATA, 'suna-config') },
    logFile: LOG_FILE
  })
  const client = await connect({
    port: opts.port,
    diagnostics: () => {
      try {
        return 'dev.log tail:\n' + readFileSync(LOG_FILE, 'utf8').slice(-2000)
      } catch {
        return '(no dev.log)'
      }
    }
  })
  const { w, h } = await client.pinViewport()
  const ctx = makeCtx(client)
  if (opts.example) await openExample(ctx)
  else if (opts.project) await openProject(ctx, resolve(opts.project))
  writeFileSync(STATE_FILE, JSON.stringify({ pid: child.pid, port: opts.port }) + '\n')
  if (!opts.show) {
    // The marker is printed from ready-to-show (first paint), which can trail
    // the first CDP eval on a fast boot — poll briefly before warning.
    let seen = false
    for (let i = 0; i < 10 && !seen; i++) {
      const log = existsSync(LOG_FILE) ? readFileSync(LOG_FILE).subarray(logStart).toString('utf8') : ''
      seen = log.includes(HIDDEN_MARKER)
      if (!seen) await sleep(500)
    }
    if (!seen) {
      console.warn(`warning: '${HIDDEN_MARKER}' not found in dev.log — the window may be visible`)
    }
  }
  client.close()
  console.log(`ready on :${opts.port} (viewport ${w}×${h}) — attach with --shot/--eval/run, stop with --stop`)
}

async function shot(out) {
  if (!out) throw new Error('--shot needs an output path')
  const { client } = await attach()
  const file = resolve(out)
  mkdirSync(dirname(file), { recursive: true })
  await client.screenshot(file)
  client.close()
  console.log(file)
}

async function evalCmd(expr) {
  if (!expr) throw new Error('--eval needs an expression')
  const { client } = await attach()
  const value = await client.evalJs(expr)
  client.close()
  if (value !== undefined) console.log(JSON.stringify(value, null, 2))
}

async function runScript(file) {
  if (!file) throw new Error('run needs a script path')
  const { client } = await attach()
  const ctx = makeCtx(client)
  try {
    const mod = await import(pathToFileURL(resolve(file)).href)
    if (typeof mod.default !== 'function') {
      throw new Error(`${file} has no default export function — expected: export default async (ctx) => { ... }`)
    }
    const result = await mod.default(ctx)
    if (result !== undefined) console.log(JSON.stringify(result, null, 2))
  } finally {
    client.close()
  }
}

async function status() {
  const state = readState()
  if (state) console.log(`drive.json: pid ${state.pid}, port ${state.port}`)
  else console.log('no drive.json recorded')
  const { client, port } = await attach()
  const info = await client.evalJs(`({
    rootDir: window.__sunaDev ? window.__sunaDev.projectStore.getState().rootDir : null,
    viewport: window.innerWidth + 'x' + window.innerHeight
  })`)
  client.close()
  console.log(`running on :${port} — project: ${info.rootDir ?? '(none open)'}, viewport ${info.viewport}`)
}

async function stopApp() {
  const state = readState()
  if (state?.pid) {
    try {
      process.kill(-state.pid, 'SIGTERM')
    } catch { /* already gone */ }
    await sleep(500)
  }
  // fall back to whatever still holds the port (an orphaned Electron, say)
  const port = state?.port ?? opts.port
  try {
    execSync(`lsof -ti tcp:${port} | xargs kill -9`, { stdio: 'ignore', shell: '/bin/bash' })
  } catch { /* nothing on the port */ }
  rmSync(STATE_FILE, { force: true })
  console.log(`stopped (port ${port})`)
}

// ---------------------------------------------------------------- dispatch
if (args.length === 0) {
  usage()
  process.exit(0)
}
try {
  if (command === 'boot') await boot()
  else if (command === 'shot') await shot(opts.out)
  else if (command === 'eval') await evalCmd(opts.expr)
  else if (command === 'run') await runScript(opts.script)
  else if (command === 'status') await status()
  else if (command === 'stop') await stopApp()
  else {
    usage()
    process.exit(1)
  }
  process.exit(0)
} catch (error) {
  console.error(String(error.message ?? error))
  process.exit(1)
}
