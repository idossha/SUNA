import { getBundledProfile } from '@suna/formatter'
import { describe, expect, it } from 'vitest'
import { defaultDpi, widthPresetsFor } from './export-presets'

describe('widthPresetsFor', () => {
  it('falls back to generic mm defaults with no profile', () => {
    const presets = widthPresetsFor(null)
    expect(presets).toEqual([
      { key: 'single', widthMm: 89, label: 'Single column (89 mm)' },
      { key: 'onehalf', widthMm: 120, label: '1.5 column (120 mm)' },
      { key: 'double', widthMm: 180, label: 'Double column (180 mm)' }
    ])
  })

  it('uses the profile-stated mm for presets it defines, falling back per-key otherwise', () => {
    // nature: single 89, onehalf null, double 183.
    const profile = getBundledProfile('nature')
    const presets = widthPresetsFor(profile)
    expect(presets.find((p) => p.key === 'single')).toEqual({
      key: 'single',
      widthMm: 89,
      label: 'Single column (89 mm)'
    })
    expect(presets.find((p) => p.key === 'onehalf')).toEqual({
      key: 'onehalf',
      widthMm: 120,
      label: '1.5 column (120 mm)'
    })
    expect(presets.find((p) => p.key === 'double')).toEqual({
      key: 'double',
      widthMm: 183,
      label: 'Double column (183 mm)'
    })
  })

  it('always returns exactly the three presets, in order', () => {
    const profile = getBundledProfile('neuron') // every widthPresetsMm value is null
    expect(widthPresetsFor(profile).map((p) => p.key)).toEqual(['single', 'onehalf', 'double'])
  })
})

describe('defaultDpi', () => {
  it('defaults to 300 with no profile', () => {
    expect(defaultDpi(null)).toBe(300)
  })

  it('reads the profile minDpi', () => {
    expect(defaultDpi(getBundledProfile('nature'))).toBe(300)
  })
})
