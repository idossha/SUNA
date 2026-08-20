import { describe, expect, it } from 'vitest'
import { nextActiveIndex, pickerNavDirection, scrollTopFor } from './pickerNavigation'

/**
 * The palettes list every figure in a project, so the highlight routinely
 * walks below the fold — these cover both halves of "the scroll follows the
 * selection": which keys move it, and the list scrolling to keep up.
 */
describe('pickerNavDirection', () => {
  const ev = (key: string, ctrlKey = false): Parameters<typeof pickerNavDirection>[0] => ({
    key,
    ctrlKey,
    metaKey: false,
    altKey: false
  })

  it('takes the arrows', () => {
    expect(pickerNavDirection(ev('ArrowDown'))).toBe('down')
    expect(pickerNavDirection(ev('ArrowUp'))).toBe('up')
  })

  it('takes vim ⌃j/⌃k and readline ⌃n/⌃p', () => {
    expect(pickerNavDirection(ev('j', true))).toBe('down')
    expect(pickerNavDirection(ev('k', true))).toBe('up')
    expect(pickerNavDirection(ev('n', true))).toBe('down')
    expect(pickerNavDirection(ev('p', true))).toBe('up')
  })

  it('leaves bare j/k alone so they can be typed into the filter', () => {
    expect(pickerNavDirection(ev('j'))).toBeNull()
    expect(pickerNavDirection(ev('k'))).toBeNull()
  })
})

describe('nextActiveIndex', () => {
  it('clamps at both ends', () => {
    expect(nextActiveIndex(0, 'up', 5)).toBe(0)
    expect(nextActiveIndex(4, 'down', 5)).toBe(4)
    expect(nextActiveIndex(1, 'down', 5)).toBe(2)
    expect(nextActiveIndex(3, 'down', 0)).toBe(0)
  })
})

describe('scrollTopFor', () => {
  /** Rows of 20 px in a 60 px viewport. */
  const row = (index: number, scrollTop: number): number =>
    scrollTopFor({ top: index * 20, height: 20, scrollTop, viewportHeight: 60 })

  it('scrolls down just far enough to show a row below the fold', () => {
    expect(row(5, 0)).toBe(60) // row 5 ends at 120, viewport is 60 tall
  })

  it('scrolls up to a row above the fold', () => {
    expect(row(1, 60)).toBe(20)
  })

  it('leaves a row already in view alone', () => {
    expect(row(4, 60)).toBe(60)
  })
})
