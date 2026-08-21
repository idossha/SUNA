import { getBundledProfile } from '@suna/formatter'
import { describe, expect, it } from 'vitest'
import { NEUTRAL_RAMPS, buildPaletteRamps, parseImportedPalette } from './palette'

describe('buildPaletteRamps', () => {
  it('returns just the neutral ramps with no profile', () => {
    expect(buildPaletteRamps(null)).toEqual(NEUTRAL_RAMPS)
  })

  it('leads with a Journal ramp when the profile suggests one (Wong order)', () => {
    const ramps = buildPaletteRamps(getBundledProfile('suna'))
    expect(ramps[0]?.name).toBe('Journal')
    expect(ramps[0]?.colors).toEqual([
      '#000000',
      '#E69F00',
      '#56B4E9',
      '#009E73',
      '#F0E442',
      '#0072B2',
      '#D55E00',
      '#CC79A7'
    ])
    expect(ramps.slice(1)).toEqual(NEUTRAL_RAMPS)
  })

  it('omits the Journal ramp when the profile states no suggested palette', () => {
    const ramps = buildPaletteRamps(getBundledProfile('science'))
    expect(ramps.map((r) => r.name)).not.toContain('Journal')
    expect(ramps).toEqual(NEUTRAL_RAMPS)
  })

  it('appends custom ramps after the neutrals', () => {
    const custom = [{ name: 'Imported', colors: ['#123456'] }]
    const ramps = buildPaletteRamps(null, custom)
    expect(ramps[ramps.length - 1]).toEqual(custom[0])
  })
})

describe('parseImportedPalette', () => {
  it('accepts an array of hex strings and normalizes them', () => {
    expect(parseImportedPalette(['#fff', '#000000', '#ABCDEF'])).toEqual([
      '#ffffff',
      '#000000',
      '#abcdef'
    ])
  })

  it('rejects a non-array, empty array, or any non-hex entry', () => {
    expect(parseImportedPalette('#fff')).toBeNull()
    expect(parseImportedPalette([])).toBeNull()
    expect(parseImportedPalette(['#fff', 'red'])).toBeNull()
    expect(parseImportedPalette(['#fff', 42])).toBeNull()
    expect(parseImportedPalette(null)).toBeNull()
  })
})
