import { beforeEach, describe, expect, it } from 'vitest'
import type { Manuscript, PublisherProfile } from '@suna/core'
import { clearRasterCache, rasterizeManuscriptFigures } from './rasterizeFigures'

/**
 * The live preview re-rasterizes on every styling change, so the cache is the
 * difference between a preview that keeps up and one that re-encodes every
 * figure for nothing. What these tests hold it to:
 *   - a figure whose SVG has not changed is not re-encoded;
 *   - a figure whose SVG HAS changed is (a cache that serves stale pixels is
 *     worse than no cache — the preview would be lying);
 *   - the cache never touches a real export, which must always write the
 *     bytes it is about to embed.
 */

/** Calls the SVG read / figure export / write channels record here, in order. */
let calls: { channel: string; payload: Record<string, unknown> }[] = []
/** figures/<id>/figure.svg -> its current text, so a test can "edit" a figure. */
const svgOnDisk = new Map<string, string>()

const invoke = async (channel: string, payload: Record<string, unknown>): Promise<unknown> => {
  calls.push({ channel, payload })
  if (channel === 'fs:read-text') {
    const path = String(payload['path'])
    return { content: svgOnDisk.get(path) ?? '<svg/>' }
  }
  if (channel === 'figure:export') {
    // The real handler THROWS for png (main has no canvas), naming the path
    // and pixel size in the message in the exact shape canvas/units.ts's
    // parseRasterExportError reads — rasterizeOne goes through that parse.
    throw new Error(
      `main cannot draw the SVG at 800×600 px — write the bytes from the renderer ` +
        `(/out/${String(payload['figureId'])}-${String(payload['dpi'])}.png)`
    )
  }
  if (channel === 'figure:write-binary') return { path: payload['path'] }
  throw new Error(`unexpected channel ${channel}`)
}

Object.defineProperty(globalThis, 'window', {
  value: {
    suna: { invoke },
    devicePixelRatio: 1
  },
  writable: true,
  configurable: true
})

// The canvas half of the pass, stubbed: these tests are about how OFTEN the
// encode runs, not what it produces.
Object.defineProperty(globalThis, 'Blob', { value: class {}, writable: true, configurable: true })
Object.defineProperty(globalThis, 'URL', {
  value: { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined },
  writable: true,
  configurable: true
})
Object.defineProperty(globalThis, 'Image', {
  value: class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      setTimeout(() => this.onload?.(), 0)
    }
  },
  writable: true,
  configurable: true
})
Object.defineProperty(globalThis, 'FileReader', {
  value: class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    result = 'data:image/png;base64,AAAA'
    readAsDataURL(): void {
      setTimeout(() => this.onload?.(), 0)
    }
  },
  writable: true,
  configurable: true
})
Object.defineProperty(globalThis, 'document', {
  value: {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect: () => undefined, drawImage: () => undefined, fillStyle: '' }),
      toBlob: (cb: (b: unknown) => void) => cb({})
    })
  },
  writable: true,
  configurable: true
})

const manuscript = {
  figures: [{ id: 'fig1', canvasRef: 'figures/fig1/figure.svg', widthPreset: 'single' }]
} as unknown as Manuscript

const profile = {
  figures: { widths: { singleColumnMm: 89 }, formats: { minDpi: 300 } }
} as unknown as PublisherProfile

const encodes = (): number => calls.filter((c) => c.channel === 'figure:write-binary').length

beforeEach(() => {
  calls = []
  svgOnDisk.clear()
  svgOnDisk.set('/proj/figures/fig1/figure.svg', '<svg>one</svg>')
  clearRasterCache()
})

describe('preview raster cache', () => {
  it('encodes once, then serves the same path without re-encoding', async () => {
    const first = await rasterizeManuscriptFigures('/proj', manuscript, profile, {
      compress: true,
      cache: true
    })
    expect(encodes()).toBe(1)

    const second = await rasterizeManuscriptFigures('/proj', manuscript, profile, {
      compress: true,
      cache: true
    })
    expect(encodes()).toBe(1)
    expect(second).toEqual(first)
  })

  it('re-encodes when the figure SVG changed — a preview must never show stale pixels', async () => {
    await rasterizeManuscriptFigures('/proj', manuscript, profile, { compress: true, cache: true })
    expect(encodes()).toBe(1)

    svgOnDisk.set('/proj/figures/fig1/figure.svg', '<svg>two</svg>')
    await rasterizeManuscriptFigures('/proj', manuscript, profile, { compress: true, cache: true })
    expect(encodes()).toBe(2)
  })

  it('never serves a cached raster to a real export', async () => {
    await rasterizeManuscriptFigures('/proj', manuscript, profile, { compress: true, cache: true })
    await rasterizeManuscriptFigures('/proj', manuscript, profile, {})
    await rasterizeManuscriptFigures('/proj', manuscript, profile, {})
    // Two export passes, two writes — plus the one preview pass.
    expect(encodes()).toBe(3)
  })

  it('keeps compressed and full-resolution rasters in separate slots', async () => {
    const preview = await rasterizeManuscriptFigures('/proj', manuscript, profile, {
      compress: true,
      cache: true
    })
    const full = await rasterizeManuscriptFigures('/proj', manuscript, profile, { cache: true })
    expect(preview['fig1']).not.toBe(full['fig1'])
    expect(encodes()).toBe(2)
  })
})
