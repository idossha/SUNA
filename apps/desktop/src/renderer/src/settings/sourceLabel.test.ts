import { describe, expect, it } from 'vitest'
import { sourceLabel, SOURCE_LABELS } from './sourceLabel'

describe('sourceLabel', () => {
  it('labels every resolver source with the exact feature-plan-5 §4 copy', () => {
    expect(sourceLabel('project')).toBe('from project')
    expect(sourceLabel('global')).toBe('from global')
    expect(sourceLabel('default')).toBe('default')
  })

  it('covers every SettingSource with no extras', () => {
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual(['default', 'global', 'project'])
  })
})
