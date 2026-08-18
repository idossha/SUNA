#!/usr/bin/env node
/**
 * Regenerate the website's screenshots from the real application.
 *
 * Boots SUNA hidden against a fresh copy of examples/demo-paper, drives every
 * documented surface (scripts/e2e/probes/docs-shots.mjs), converts the raw
 * captures to WebP, and stops the app again. The PNGs are ~500 KB each and
 * the WebPs ~120 KB for the same legibility at the width the site shows them,
 * so only the WebPs are kept and committed.
 *
 *   node website/scripts/shots.mjs          boot → capture → convert → stop
 *   node website/scripts/shots.mjs --keep   leave the app running afterwards
 *   node website/scripts/shots.mjs --convert-only
 *
 * Requires cwebp (`brew install webp`).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHOTS = join(ROOT, 'website', 'public', 'shots')
const DRIVE = join(ROOT, 'scripts', 'e2e', 'drive.mjs')
const PROBE = join(ROOT, 'scripts', 'e2e', 'probes', 'docs-shots.mjs')

/** Long edge in px. The site shows these at ~1000 px, so 2000 is a 2× asset. */
const WIDTH = 2000
const QUALITY = 88

const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const convertOnly = argv.includes('--convert-only')

const run = (args, opts = {}) =>
  execFileSync('node', args, { stdio: 'inherit', cwd: ROOT, ...opts })

function requireCwebp() {
  const probe = spawnSync('cwebp', ['-version'], { stdio: 'ignore' })
  if (probe.status !== 0) {
    console.error('cwebp not found — install it with:  brew install webp')
    process.exit(1)
  }
}

function convert() {
  requireCwebp()
  const pngs = readdirSync(SHOTS).filter((f) => f.endsWith('.png'))
  if (pngs.length === 0) {
    console.log('no PNGs to convert — nothing to do')
    return
  }
  let before = 0
  let after = 0
  for (const png of pngs) {
    const src = join(SHOTS, png)
    const out = join(SHOTS, png.replace(/\.png$/, '.webp'))
    before += statSync(src).size
    execFileSync('cwebp', ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', src, '-o', out])
    after += statSync(out).size
    rmSync(src)
    console.log(`  ${png} → ${png.replace(/\.png$/, '.webp')}`)
  }
  const pct = Math.round((1 - after / before) * 100)
  console.log(
    `converted ${pngs.length} shots: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB (−${pct}%)`
  )
}

if (convertOnly) {
  convert()
  process.exit(0)
}

if (!existsSync(DRIVE)) {
  console.error(`missing driver: ${DRIVE}`)
  process.exit(1)
}

console.log('booting SUNA hidden against the example project…')
run([DRIVE, '--boot', '--example'])
try {
  run([DRIVE, PROBE])
} finally {
  if (!keep) {
    console.log('stopping the app…')
    try {
      run([DRIVE, '--stop'])
    } catch {
      /* already gone */
    }
  }
}
convert()
