#!/usr/bin/env node
/**
 * Run every PDF reading-notes probe in one command (ADR-008).
 *
 * These were manual-only, which is the same as not running. They are NOT
 * folded into `pnpm smoke`: that suite still references selectors and paths the
 * flat-manuscript layout removed (`.ms__open`, `manuscript/sections/`), so it
 * cannot currently run, and adding steps to a suite nobody can execute would
 * look like coverage without being any. When the smoke driver is brought back,
 * these should move into it and this file should go away.
 *
 * Boots the app hidden with the example project, stages a reference PDF the
 * probes can annotate, runs each probe against the same instance, and stops.
 *
 *   node scripts/e2e/pdf-probes.mjs            all probes
 *   node scripts/e2e/pdf-probes.mjs --keep     leave the app running
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DRIVE = join(ROOT, 'scripts', 'e2e', 'drive.mjs')
const PROJECT = join(ROOT, 'scripts', 'e2e', '.userdata-drive', 'example-project')

/** The probes, in the order they build on each other's assumptions. */
const PROBES = [
  'pdf-textlayer-scale.mjs',
  'pdf-quote.mjs',
  'pdf-highlight.mjs',
  'pdf-native-highlight.mjs',
  // The lifecycle suite runs last and resets itself between scenarios, so it
  // is unaffected by whatever the earlier probes left behind.
  'pdf-notes-suite.mjs'
]

const keep = process.argv.includes('--keep')

function drive(args, { quiet = false } = {}) {
  return spawnSync(process.execPath, [DRIVE, ...args], {
    cwd: ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8'
  })
}

/**
 * Each probe needs a clean starting point: no sidecar, and a reference PDF at
 * the conventional `references/<citekey>.pdf` so the citekey resolves through
 * the filename tier. The source is one of the example project's own exports.
 */
function resetFixture() {
  const notes = join(PROJECT, 'references', 'notes')
  const pdf = join(PROJECT, 'references', 'gunn1972.pdf')
  const source = join(PROJECT, 'output', 'ram-pressure-stripping-at-z-1-7.pdf')
  rmSync(notes, { recursive: true, force: true })
  rmSync(pdf, { force: true })
  if (!existsSync(source)) {
    throw new Error(
      `no example PDF at ${source} — export the demo manuscript once, or run the app's ` +
        'Export → PDF, so the probes have a real paper to annotate'
    )
  }
  mkdirSync(dirname(pdf), { recursive: true })
  copyFileSync(source, pdf)
}

console.log('booting the app hidden with the example project…')
drive(['--stop'], { quiet: true })
const boot = drive(['--boot', '--example'])
if (boot.status !== 0) {
  console.error('could not boot the app')
  process.exit(1)
}

// `--boot --example` has been seen to return before the project store settles.
const opened = drive(
  ['--eval', `window.__sunaDev.openProjectAt(${JSON.stringify(PROJECT)}).then(() => 'ok')`],
  { quiet: true }
)
if (opened.status !== 0) console.log('  (project already open)')

/**
 * The app has to be told the fixture moved under it.
 *
 * `referencePdfs` rescans on project open and on save, neither of which
 * happens when a probe runner swaps the file on disk — so without this the
 * citekey stops resolving, the popover offers no colours, and the next probe
 * fails for a reason that has nothing to do with what it tests. The stale PDF
 * tab has to go too: dockview focuses the existing panel for a path, which
 * would leave the previous probe's document on screen.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Close the previous probe's tab and let any debounced write land. */
function closePdfTab() {
  const pdf = join(PROJECT, 'references', 'gunn1972.pdf')
  drive(
    ['--eval', `(() => { window.__sunaDev.dock.closePanel(${JSON.stringify(pdf)}); return 1 })()`],
    { quiet: true }
  )
  // The highlight sync is debounced, so a write scheduled by the last probe
  // can still be in flight. Swapping the fixture under it would drop that
  // write into the FRESH copy, and the next probe would open a paper that is
  // already annotated — which is exactly how this failed.
  sleepSync(1500)
}

/** Tell the reference scan the file changed underneath it. */
function rescanReferences() {
  drive(
    [
      '--eval',
      `window.__sunaDev.referencePdfsStore.getState().scan(${JSON.stringify(PROJECT)}).then(() => 'ok')`
    ],
    { quiet: true }
  )
}

const results = []
for (const probe of PROBES) {
  console.log(`\n${'='.repeat(64)}\n${probe}\n${'='.repeat(64)}`)
  closePdfTab()
  try {
    resetFixture()
  } catch (error) {
    console.error(`  fixture: ${error.message}`)
    results.push({ probe, ok: false })
    continue
  }
  rescanReferences()
  const run = drive([join(ROOT, 'scripts', 'e2e', 'probes', probe)])
  results.push({ probe, ok: run.status === 0 })
}

// Leave the project as it was found.
rmSync(join(PROJECT, 'references', 'notes'), { recursive: true, force: true })
rmSync(join(PROJECT, 'references', 'gunn1972.pdf'), { force: true })
try {
  execFileSync('git', ['-C', PROJECT, 'checkout', '--', 'manuscript/manuscript.md'], {
    stdio: 'ignore'
  })
} catch {
  // The example project may not be a git repo in every environment.
}

if (!keep) drive(['--stop'], { quiet: true })

console.log(`\n${'='.repeat(64)}`)
for (const { probe, ok } of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${probe}`)
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
