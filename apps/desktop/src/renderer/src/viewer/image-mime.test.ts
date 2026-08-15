import { describe, expect, it } from 'vitest'
import { dataUriForImage, mimeForImagePath } from './image-mime'

describe('mimeForImagePath', () => {
  it('maps every supported extension, case-insensitively', () => {
    expect(mimeForImagePath('figures/plot.png')).toBe('image/png')
    expect(mimeForImagePath('figures/PLOT.PNG')).toBe('image/png')
    expect(mimeForImagePath('a.jpg')).toBe('image/jpeg')
    expect(mimeForImagePath('a.JPEG')).toBe('image/jpeg')
    expect(mimeForImagePath('a.gif')).toBe('image/gif')
    expect(mimeForImagePath('a.webp')).toBe('image/webp')
  })

  it('returns null for an unrecognized or missing extension', () => {
    expect(mimeForImagePath('a.tiff')).toBeNull()
    expect(mimeForImagePath('a.svg')).toBeNull()
    expect(mimeForImagePath('no-extension')).toBeNull()
    expect(mimeForImagePath('')).toBeNull()
  })

  it('uses the last extension of a multi-dot path', () => {
    expect(mimeForImagePath('figures/2024.summary.final.png')).toBe('image/png')
  })
})

describe('dataUriForImage', () => {
  it('builds a data URI with the mapped mime type', () => {
    expect(dataUriForImage('a.png', 'AAAA')).toBe('data:image/png;base64,AAAA')
    expect(dataUriForImage('a.jpg', 'BBBB')).toBe('data:image/jpeg;base64,BBBB')
  })

  it('falls back to octet-stream for an unrecognized extension', () => {
    expect(dataUriForImage('a.bin', 'CCCC')).toBe('data:application/octet-stream;base64,CCCC')
  })
})
