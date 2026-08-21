import { describe, expect, it } from 'vitest'
import { paperLabel } from './paperSize'

describe('paperLabel', () => {
  it('names the standard sizes', () => {
    expect(paperLabel({ widthIn: 8.5, heightIn: 11 })).toBe('US Letter')
    expect(paperLabel({ widthIn: 8.5, heightIn: 14 })).toBe('US Legal')
    expect(paperLabel({ widthIn: 8.268, heightIn: 11.693 })).toBe('A4')
  })

  it('tolerates the rounding a twips-based page size carries', () => {
    // 11906 x 16838 twips — Word's own A4.
    expect(paperLabel({ widthIn: 11906 / 1440, heightIn: 16838 / 1440 })).toBe('A4')
  })

  it('marks landscape rather than mislabelling it', () => {
    expect(paperLabel({ widthIn: 11, heightIn: 8.5 })).toBe('US Letter landscape')
  })

  it('reports an unusual page as its measurements', () => {
    expect(paperLabel({ widthIn: 7, heightIn: 9.25 })).toBe('7 × 9.25 in')
  })
})
