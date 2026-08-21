import { describe, expect, it } from 'vitest'
import { dataUri, pickRepresentation } from './mime'

describe('pickRepresentation', () => {
  // The case this exists for: matplotlib sends both, and the plot wins.
  it('prefers the figure over its repr', () => {
    expect(
      pickRepresentation({ 'image/png': 'AAAA', 'text/plain': '<Figure size 640x480>' })
    ).toEqual({ kind: 'image', mime: 'image/png', data: 'AAAA' })
  })

  it('prefers a vector figure over a raster one', () => {
    expect(pickRepresentation({ 'image/svg+xml': '<svg/>', 'image/png': 'AAAA' })).toEqual({
      kind: 'svg',
      svg: '<svg/>'
    })
  })

  it('prefers a DataFrame table over its text repr', () => {
    expect(pickRepresentation({ 'text/html': '<table></table>', 'text/plain': 'a b' })).toEqual({
      kind: 'html',
      html: '<table></table>'
    })
  })

  it('accepts a line list as readily as a string', () => {
    expect(pickRepresentation({ 'text/plain': ['one\n', 'two'] })).toEqual({
      kind: 'text',
      text: 'one\ntwo'
    })
  })

  it('keeps application/json as a value, never as text', () => {
    expect(pickRepresentation({ 'application/json': { a: 1 } })).toEqual({
      kind: 'json',
      value: { a: 1 }
    })
  })

  it('falls past a type it cannot read down to one it can', () => {
    // an image whose payload is an object, not base64
    expect(pickRepresentation({ 'image/png': { oops: true }, 'text/plain': 'x' })).toEqual({
      kind: 'text',
      text: 'x'
    })
  })

  it('reports nothing renderable rather than guessing', () => {
    expect(pickRepresentation({})).toEqual({ kind: 'none' })
    expect(pickRepresentation({ 'application/vnd.custom': 'x' })).toEqual({ kind: 'none' })
  })
})

describe('dataUri', () => {
  it('strips the line wrapping kernels put in base64', () => {
    expect(dataUri('image/png', 'AAAA\nBBBB\n')).toBe('data:image/png;base64,AAAABBBB')
  })
})
