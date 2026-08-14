import { describe, expect, it } from 'vitest'
import { encodeTiff } from './tiff'

/** Independent re-parse of the IFD, so the test doesn't just mirror the encoder's own math. */
function readIfd(bytes: Uint8Array): { tags: Map<number, { type: number; count: number; value: number }>; ifdOffset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ifdOffset = view.getUint32(4, true)
  const count = view.getUint16(ifdOffset, true)
  const tags = new Map<number, { type: number; count: number; value: number }>()
  for (let i = 0; i < count; i++) {
    const base = ifdOffset + 2 + i * 12
    tags.set(view.getUint16(base, true), {
      type: view.getUint16(base + 2, true),
      count: view.getUint32(base + 4, true),
      value: view.getUint32(base + 8, true)
    })
  }
  return { tags, ifdOffset }
}

describe('encodeTiff', () => {
  it('writes a little-endian header with the IFD immediately after it', () => {
    const rgba = new Uint8ClampedArray(2 * 1 * 4)
    const out = encodeTiff(rgba, 2, 1)
    expect(out[0]).toBe(0x49) // 'I'
    expect(out[1]).toBe(0x49) // 'I'
    const view = new DataView(out.buffer)
    expect(view.getUint16(2, true)).toBe(42)
    expect(view.getUint32(4, true)).toBe(8) // IFD right after the 8-byte header
  })

  it('encodes width/height/strip tags an independent reader can recover', () => {
    const width = 4
    const height = 3
    const rgba = new Uint8ClampedArray(width * height * 4)
    const out = encodeTiff(rgba, width, height, { dpi: 600 })
    const { tags } = readIfd(out)

    expect(tags.get(256)).toMatchObject({ value: width }) // ImageWidth
    expect(tags.get(257)).toMatchObject({ value: height }) // ImageLength
    expect(tags.get(259)).toMatchObject({ value: 1 }) // Compression: none
    expect(tags.get(262)).toMatchObject({ value: 2 }) // PhotometricInterpretation: RGB
    expect(tags.get(277)).toMatchObject({ value: 4 }) // SamplesPerPixel
    expect(tags.get(278)).toMatchObject({ value: height }) // RowsPerStrip
    expect(tags.get(279)).toMatchObject({ value: width * height * 4 }) // StripByteCounts
    expect(tags.get(296)).toMatchObject({ value: 2 }) // ResolutionUnit: inch
    expect(tags.get(338)).toMatchObject({ value: 2 }) // ExtraSamples: unassociated alpha

    const bitsPerSample = tags.get(258)
    expect(bitsPerSample?.count).toBe(4)
    const view = new DataView(out.buffer)
    const bpsOffset = bitsPerSample?.value as number
    expect([0, 1, 2, 3].map((i) => view.getUint16(bpsOffset + i * 2, true))).toEqual([8, 8, 8, 8])

    const xRes = tags.get(282)
    const xResOffset = xRes?.value as number
    expect(view.getUint32(xResOffset, true)).toBe(600)
    expect(view.getUint32(xResOffset + 4, true)).toBe(1)

    const stripOffset = tags.get(273)?.value as number
    expect(out.length).toBe(stripOffset + width * height * 4)
  })

  it('tags appear in ascending order (required for a valid TIFF)', () => {
    const out = encodeTiff(new Uint8ClampedArray(4 * 4), 1, 1)
    const view = new DataView(out.buffer)
    const ifdOffset = view.getUint32(4, true)
    const count = view.getUint16(ifdOffset, true)
    const tagIds: number[] = []
    for (let i = 0; i < count; i++) tagIds.push(view.getUint16(ifdOffset + 2 + i * 12, true))
    expect(tagIds).toEqual([...tagIds].sort((a, b) => a - b))
  })

  it('copies pixel bytes verbatim into the strip', () => {
    const rgba = Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 128])
    const out = encodeTiff(rgba, 2, 1)
    const { tags } = readIfd(out)
    const stripOffset = tags.get(273)?.value as number
    expect(Array.from(out.subarray(stripOffset, stripOffset + 8))).toEqual([
      10, 20, 30, 255, 40, 50, 60, 128
    ])
  })

  it('rejects non-positive dimensions and undersized buffers', () => {
    expect(() => encodeTiff(new Uint8ClampedArray(0), 0, 1)).toThrow()
    expect(() => encodeTiff(new Uint8ClampedArray(0), 1, 0)).toThrow()
    expect(() => encodeTiff(new Uint8ClampedArray(3), 2, 2)).toThrow()
  })
})
