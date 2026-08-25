import { describe, expect, it } from 'vitest'
import { directionForCode, moveRegion, NAV_REGIONS, type ChromeVisibility } from './vimNav'

const BOTH: ChromeVisibility = { rail: true, sidebar: true }
const RAIL_ONLY: ChromeVisibility = { rail: true, sidebar: false }
const NONE: ChromeVisibility = { rail: false, sidebar: false }

describe('moveRegion', () => {
  it('walks left out of the editor one chrome region at a time', () => {
    expect(moveRegion('dock', 'h', BOTH)).toBe('sidebar')
    expect(moveRegion('sidebar', 'h', BOTH)).toBe('rail')
    expect(moveRegion('rail', 'h', BOTH)).toBeNull()
  })

  it('skips hidden chrome instead of focusing nothing', () => {
    expect(moveRegion('dock', 'h', RAIL_ONLY)).toBe('rail')
    expect(moveRegion('dock', 'h', NONE)).toBeNull()
    expect(moveRegion('sidebar', 'h', { rail: false, sidebar: true })).toBeNull()
    expect(moveRegion('rail', 'l', RAIL_ONLY)).toBe('dock')
  })

  it('walks back right to the editor', () => {
    expect(moveRegion('rail', 'l', BOTH)).toBe('sidebar')
    expect(moveRegion('sidebar', 'l', BOTH)).toBe('dock')
    expect(moveRegion('dock', 'l', BOTH)).toBeNull()
  })

  it('leaves j and k to the focused list — the hop is one axis', () => {
    for (const region of NAV_REGIONS) {
      expect(moveRegion(region, 'j', BOTH)).toBeNull()
      expect(moveRegion(region, 'k', BOTH)).toBeNull()
    }
  })
})

describe('directionForCode', () => {
  it('maps the home row by physical key, not by letter', () => {
    expect(directionForCode('KeyH')).toBe('h')
    expect(directionForCode('KeyJ')).toBe('j')
    expect(directionForCode('KeyK')).toBe('k')
    expect(directionForCode('KeyL')).toBe('l')
    expect(directionForCode('KeyG')).toBeNull()
  })
})
