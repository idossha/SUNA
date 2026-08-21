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
 *   apps/desktop/build/icon.ico       Windows
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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * Pack PNGs into an .ico. The container is trivial — a 6-byte header, one
 * 16-byte directory entry per image, then the payloads — and every Windows
 * since Vista reads PNG payloads, so no BMP encoding is needed and no
 * dependency either.
 */
function ico(sizes, files, out) {
  const blobs = files.map((f) => readFileSync(f))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(sizes.length, 4)

  const dir = Buffer.alloc(16 * sizes.length)
  let offset = header.length + dir.length
  sizes.forEach((size, i) => {
    const at = i * 16
    // 256 is written as 0: the field is one byte wide.
    dir.writeUInt8(size >= 256 ? 0 : size, at)
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1)
    dir.writeUInt8(0, at + 2) // palette size, 0 for truecolour
    dir.writeUInt8(0, at + 3) // reserved
    dir.writeUInt16LE(1, at + 4) // colour planes
    dir.writeUInt16LE(32, at + 6) // bits per pixel
    dir.writeUInt32LE(blobs[i].length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += blobs[i].length
  })

  writeFileSync(out, Buffer.concat([header, dir, ...blobs]))
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

// --- .ico -----------------------------------------------------------------
const icoSizes = [16, 32, 48, 64, 128, 256]
ico(
  icoSizes,
  icoSizes.map((s) => png(s, join(work, `ico-${s}.png`))),
  join(buildDir, 'icon.ico')
)

rmSync(work, { recursive: true, force: true })
console.log('make-icons: wrote icon.png, icon.icns and icon.ico')
