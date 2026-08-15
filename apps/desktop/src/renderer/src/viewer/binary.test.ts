import { describe, expect, it } from 'vitest'
import { base64ToUint8Array } from './binary'

describe('base64ToUint8Array', () => {
  it('round-trips through btoa for arbitrary byte values', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255, 16, 32])
    const binary = String.fromCharCode(...bytes)
    const base64 = btoa(binary)
    expect(Array.from(base64ToUint8Array(base64))).toEqual(Array.from(bytes))
  })

  it('decodes the empty string to an empty array', () => {
    expect(base64ToUint8Array('')).toEqual(new Uint8Array(0))
  })

  it('decodes a known ASCII payload ("PDF-1.7")', () => {
    const base64 = btoa('PDF-1.7')
    const bytes = base64ToUint8Array(base64)
    expect(String.fromCharCode(...bytes)).toBe('PDF-1.7')
  })
})
