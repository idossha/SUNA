import { describe, expect, it } from 'vitest'
import { locate, makeAnchor } from './anchor'

/**
 * Smoke coverage that this zone's local import path resolves to the real
 * @suna/core algorithm (the thorough test suite lives in
 * packages/core/src/anchor.test.ts, which this module re-exports).
 */
describe('comments/anchor (re-export of @suna/core)', () => {
  it('finds an exact, unique quote', () => {
    const text = 'The best-fit centroid of 6563.3 Å was measured.'
    const range = locate(text, { quote: 'best-fit centroid of 6563.3' })
    expect(range).not.toBeNull()
    expect(text.slice(range!.from, range!.to)).toBe('best-fit centroid of 6563.3')
  })

  it('disambiguates a duplicate quote by its stored prefix', () => {
    const text = 'First: the result held. Second: the result held.'
    const anchor = makeAnchor(
      text,
      text.indexOf('Second: the result') + 'Second: '.length,
      text.indexOf('Second: the result') + 'Second: the result'.length
    )
    const range = locate(text, anchor)
    expect(range!.from).toBe(text.indexOf('Second: the result') + 'Second: '.length)
  })

  it('keeps resolving a unique quote after nearby text is edited', () => {
    const original = 'Intro. The best-fit centroid of 6563.3 Å was measured.'
    const anchor = makeAnchor(
      original,
      original.indexOf('best-fit centroid'),
      original.indexOf('best-fit centroid') + 'best-fit centroid of 6563.3'.length
    )
    const edited = 'A new opening sentence.\n\nThe best-fit centroid of 6563.3 Å was measured, confirmed twice.'
    const range = locate(edited, anchor)
    expect(range).not.toBeNull()
    expect(edited.slice(range!.from, range!.to)).toBe('best-fit centroid of 6563.3')
  })

  it('returns null once the quoted text is deleted', () => {
    const original = 'The best-fit centroid of 6563.3 Å was measured.'
    const anchor = makeAnchor(
      original,
      original.indexOf('best-fit centroid'),
      original.indexOf('best-fit centroid') + 'best-fit centroid of 6563.3'.length
    )
    expect(locate('The line center was measured.', anchor)).toBeNull()
  })
})
