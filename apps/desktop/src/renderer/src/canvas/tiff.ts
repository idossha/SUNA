/**
 * Baseline uncompressed RGBA TIFF encoder (canvas parity spec §6). No
 * dependency: little-endian, single strip, 8-bit/sample straight (not
 * premultiplied) alpha — exactly what `CanvasRenderingContext2D.getImageData`
 * already returns, so encoding is a header + a byte-for-byte pixel copy.
 *
 * Tag layout (ascending tag order, as TIFF readers expect):
 *   256 ImageWidth · 257 ImageLength · 258 BitsPerSample [8,8,8,8]
 *   259 Compression=1 (none) · 262 PhotometricInterpretation=2 (RGB)
 *   273 StripOffsets · 277 SamplesPerPixel=4 · 278 RowsPerStrip
 *   279 StripByteCounts · 282/283 X/YResolution · 296 ResolutionUnit=2 (inch)
 *   338 ExtraSamples=2 (unassociated/straight alpha)
 */

export interface TiffOptions {
  /** Pixels per inch written into XResolution/YResolution. */
  dpi?: number
}

const TYPE_SHORT = 3
const TYPE_LONG = 4
const TYPE_RATIONAL = 5

interface IfdEntry {
  tag: number
  type: number
  count: number
  /** Inline value (fits in 4 bytes) or byte offset into the file. */
  value: number
}

function rationalBytes(numerator: number, denominator: number): Uint8Array {
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, numerator, true)
  view.setUint32(4, denominator, true)
  return bytes
}

function shortsBytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  values.forEach((v, i) => view.setUint16(i * 2, v, true))
  return bytes
}

/** Encode an RGBA pixel buffer (row-major, top-to-bottom) as a baseline TIFF. */
export function encodeTiff(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: TiffOptions = {}
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`encodeTiff: width/height must be positive integers (got ${width}×${height})`)
  }
  const stripByteCount = width * height * 4
  if (rgba.length < stripByteCount) {
    throw new Error(`encodeTiff: pixel buffer too small (${rgba.length} < ${stripByteCount} bytes)`)
  }
  const dpi = options.dpi ?? 300

  const HEADER_SIZE = 8
  const ENTRY_COUNT = 13
  const IFD_SIZE = 2 + ENTRY_COUNT * 12 + 4
  const ifdOffset = HEADER_SIZE

  // Values wider than 4 bytes (or SHORT arrays of more than 2 elements) live
  // just after the IFD; layout order here fixes their offsets below.
  const bitsPerSample = shortsBytes([8, 8, 8, 8])
  const bitsPerSampleOffset = ifdOffset + IFD_SIZE
  const xResolution = rationalBytes(Math.round(dpi), 1)
  const xResolutionOffset = bitsPerSampleOffset + bitsPerSample.length
  const yResolution = rationalBytes(Math.round(dpi), 1)
  const yResolutionOffset = xResolutionOffset + xResolution.length
  const stripOffset = yResolutionOffset + yResolution.length

  const entries: IfdEntry[] = [
    { tag: 256, type: TYPE_LONG, count: 1, value: width }, // ImageWidth
    { tag: 257, type: TYPE_LONG, count: 1, value: height }, // ImageLength
    { tag: 258, type: TYPE_SHORT, count: 4, value: bitsPerSampleOffset }, // BitsPerSample
    { tag: 259, type: TYPE_SHORT, count: 1, value: 1 }, // Compression: none
    { tag: 262, type: TYPE_SHORT, count: 1, value: 2 }, // PhotometricInterpretation: RGB
    { tag: 273, type: TYPE_LONG, count: 1, value: stripOffset }, // StripOffsets
    { tag: 277, type: TYPE_SHORT, count: 1, value: 4 }, // SamplesPerPixel
    { tag: 278, type: TYPE_LONG, count: 1, value: height }, // RowsPerStrip: one strip
    { tag: 279, type: TYPE_LONG, count: 1, value: stripByteCount }, // StripByteCounts
    { tag: 282, type: TYPE_RATIONAL, count: 1, value: xResolutionOffset }, // XResolution
    { tag: 283, type: TYPE_RATIONAL, count: 1, value: yResolutionOffset }, // YResolution
    { tag: 296, type: TYPE_SHORT, count: 1, value: 2 }, // ResolutionUnit: inch
    { tag: 338, type: TYPE_SHORT, count: 1, value: 2 } // ExtraSamples: unassociated alpha
  ]

  const out = new Uint8Array(stripOffset + stripByteCount)
  const view = new DataView(out.buffer)

  // Header: byte order 'II' (little-endian), magic 42, offset to the IFD.
  out[0] = 0x49
  out[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)

  // IFD: entry count, then 12-byte entries in ascending tag order, then the
  // next-IFD offset (0 — this is the only image).
  view.setUint16(ifdOffset, ENTRY_COUNT, true)
  let cursor = ifdOffset + 2
  for (const e of entries) {
    view.setUint16(cursor, e.tag, true)
    view.setUint16(cursor + 2, e.type, true)
    view.setUint32(cursor + 4, e.count, true)
    // Every value here is either a SHORT/LONG that fits in 4 bytes or a
    // byte offset — both are a plain little-endian uint32 in the value field.
    view.setUint32(cursor + 8, e.value, true)
    cursor += 12
  }
  view.setUint32(cursor, 0, true)

  out.set(bitsPerSample, bitsPerSampleOffset)
  out.set(xResolution, xResolutionOffset)
  out.set(yResolution, yResolutionOffset)
  out.set(rgba.subarray(0, stripByteCount), stripOffset)

  return out
}
