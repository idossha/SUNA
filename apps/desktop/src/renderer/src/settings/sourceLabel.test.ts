import { describe, expect, it } from 'vitest'
import { sourceLabel, SOURCE_LABELS } from './sourceLabel'

describe('sourceLabel', () => {
  it('names the two levels a value can come from', () => {
    expect(sourceLabel('config')).toBe('from your config')
    expect(sourceLabel('default')).toBe('default')
  })

  it('covers every SettingSource with no extras', () => {
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual(['config', 'default'])
  })
})
