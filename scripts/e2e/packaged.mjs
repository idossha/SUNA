#!/usr/bin/env node
/**
 * Smoke-test the PACKAGED app (release/mac-arm64/SUNA.app or a --app path).
 *
 * The dev driver runs `pnpm dev`, which never exercises the packaged layout:
 * asar contents, extraResources and the MCP bundle beside its node_modules
 * only exist once electron-builder has run. This boots the real bundle hidden,
 * opens the bundled example project and asserts the pieces that resolve by
 * process.resourcesPath actually resolve.
 *
 *   node scripts/e2e/packaged.mjs [--app /path/to/SUNA.app]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, sleep } from './cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argApp = process.argv.indexOf('--app')
const APP = argApp === -1 ? join(ROOT, 'release', 'mac-arm64', 'SUNA.app') : process.argv[argApp + 1]
const BIN = join(APP, 'Contents', 'MacOS', 'SUNA')
const PORT = 9321

if (!existsSync(BIN)) {
  console.error(`no packaged app at ${APP} — run \`pnpm package:mac\` first`)
  process.exit(1)
}

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const res = join(APP, 'Contents', 'Resources')
check('resources/mcp/server.mjs shipped', existsSync(join(res, 'mcp', 'server.mjs')))
check('resources/mcp/node_modules/jsdom shipped', existsSync(join(res, 'mcp', 'node_modules', 'jsdom')))
check('resources/mcp/node_modules/zod shipped', existsSync(join(res, 'mcp', 'node_modules', 'zod')))
check('resources/examples/hello-suna shipped', existsSync(join(res, 'examples', 'hello-suna', 'suna.json')))
check('resources/python kernel bridge shipped', existsSync(join(res, 'python', 'suna_kernel', 'bridge.py')))
check('node-pty unpacked from asar', existsSync(join(res, 'app.asar.unpacked', 'node_modules', 'node-pty')))

const userData = mkdtempSync(join(tmpdir(), 'suna-packaged-'))
const logFile = join(userData, 'app.log')
const fd = openSync(logFile, 'a')
const child = spawn(BIN, [], {
  env: { ...process.env, SUNA_HIDDEN: '1', SUNA_DEBUG_PORT: String(PORT), SUNA_USER_DATA: userData },
  stdio: ['ignore', fd, fd],
  detached: true
})

let client
try {
  client = await connect({ port: PORT, timeoutMs: 60_000 })
  const title = await client.evalJs('document.title')
  check('renderer booted', typeof title === 'string', `title=${JSON.stringify(title)}`)

  const opened = await client.evalJs(`window.suna.invoke('project:open-example', {}).then(r => JSON.stringify(r)).catch(e => 'ERR:' + e.message)`)
  check('bundled example project opens', typeof opened === 'string' && !opened.startsWith('ERR:'), String(opened).slice(0, 200))

  await sleep(1500)
  const root = await client.evalJs(`document.body.innerText.length`)
  check('UI rendered content', typeof root === 'number' && root > 100, `${root} chars`)
} catch (err) {
  check('packaged app boot', false, err.message)
} finally {
  try { await client?.close() } catch {}
  try { process.kill(-child.pid, 'SIGTERM') } catch {}
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed  (log: ${logFile})`)
process.exit(failed.length ? 1 : 0)
