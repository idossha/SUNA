import { describe, expect, it } from 'vitest'
import { hasDrawableContent, type ElementLike } from './blank-canvas'

function el(localName: string, children: ElementLike[] = []): ElementLike {
  return { localName, children }
}

describe('hasDrawableContent', () => {
  it('is false for a brand-new artboard with no children', () => {
    expect(hasDrawableContent(el('svg'))).toBe(false)
  })

  it('is false when only bookkeeping elements are present', () => {
    const root = el('svg', [el('defs'), el('metadata'), el('title'), el('desc'), el('style')])
    expect(hasDrawableContent(root)).toBe(false)
  })

  it('is true once a shape exists', () => {
    const root = el('svg', [el('defs'), el('rect')])
    expect(hasDrawableContent(root)).toBe(true)
  })

  it('is true for an imported group', () => {
    const root = el('svg', [el('g')])
    expect(hasDrawableContent(root)).toBe(true)
  })

  it('is true for a raster import', () => {
    expect(hasDrawableContent(el('svg', [el('image')]))).toBe(true)
  })

  it('tag matching is case-insensitive', () => {
    expect(hasDrawableContent(el('svg', [el('DEFS')]))).toBe(false)
  })
})
