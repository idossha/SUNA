#!/usr/bin/env node
/**
 * Rasterize SUNA's icon sources into the files a build and the running app
 * need.
 *
 *   node scripts/branding/make-icons.mjs
 *
 * Sources live in resources/branding/ and are the only things edited by hand;
 * everything this writes is generated and committed so that a clone has an
 * icon without needing librsvg installed. Run this after touching a source.
 *
 * Writes:
 *   apps/desktop/resources/icon.png   512, loaded at runtime for the dock
 *   apps/desktop/build/icon.icns      macOS bundle icon
 *   apps/desktop/build/icon.png       1024, Linux
 *
 * `build/` is where electron-builder looks for these by name with no config
 * at all. Packaging is not set up yet (roadmap); the icons are placed where
 * it will find them so that milestone is not also an icon milestone.
 *
 * Needs rsvg-convert (`brew install librsvg`) and, for the .icns, iconutil,
 * which ships with macOS. On other platforms the .icns step is skipped.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = join(root, 'resources', 'branding')
const desktop = join(root, 'apps', 'desktop')
const buildDir = join(desktop, 'build')
const runtimeDir = join(desktop, 'resources')
const work = join(buildDir, '.iconset-tmp')

/** Sizes 32 and below come from the small drawing; see icon-small.svg. */
const SMALL_UP_TO = 32
const sourceFor = (size) =>
  join(src, size <= SMALL_UP_TO ? 'icon-small.svg' : 'icon.svg')

function have(bin) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!have('rsvg-convert')) {
  console.error(
    'make-icons: rsvg-convert not found. Install it with `brew install librsvg`.'
  )
  process.exit(1)
}

/** Render one square PNG at `size` from whichever source that size uses. */
function png(size, out) {
  mkdirSync(dirname(out), { recursive: true })
  execFileSync('rsvg-convert', [
    '-w', String(size), '-h', String(size),
    sourceFor(size), '-o', out
  ])
  return out
}

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

// --- the app's runtime and packaging PNGs ---------------------------------
png(512, join(runtimeDir, 'icon.png'))
png(1024, join(buildDir, 'icon.png'))

// --- .icns ----------------------------------------------------------------
// The names are fixed by iconutil. 16@2x and 32x32 are the same pixel size
// and both come from the small drawing.
const iconset = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]
const iconsetDir = join(work, 'icon.iconset')
mkdirSync(iconsetDir, { recursive: true })
for (const [size, name] of iconset) png(size, join(iconsetDir, name))

if (process.platform === 'darwin' && have('iconutil')) {
  execFileSync('iconutil', [
    '-c', 'icns', iconsetDir, '-o', join(buildDir, 'icon.icns')
  ])
} else {
  console.warn('make-icons: not macOS (or no iconutil) — skipped icon.icns')
}

rmSync(work, { recursive: true, force: true })
console.log('make-icons: wrote icon.png and icon.icns')
