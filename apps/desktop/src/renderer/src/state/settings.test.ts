import { describe, expect, it } from 'vitest'
import { coerceSettings, GLOBAL_SETTINGS_DEFAULTS } from './settings'

describe('coerceSettings', () => {
  it('defaults lit.mailto to the empty string when absent', () => {
    expect(coerceSettings({})).toEqual(GLOBAL_SETTINGS_DEFAULTS)
  })

  it('adopts a persisted lit.mailto', () => {
    expect(coerceSettings({ 'lit.mailto': 'ada@example.edu' })['lit.mailto']).toBe('ada@example.edu')
  })

  it('ignores a non-string lit.mailto and falls back to the default', () => {
    expect(coerceSettings({ 'lit.mailto': 42 })['lit.mailto']).toBe('')
  })

  it('leaves unrelated keys at their defaults', () => {
    const out = coerceSettings({ 'lit.mailto': 'ada@example.edu' })
    expect(out['editor.defaultMode']).toBe('reading')
    expect(out['terminal.shell']).toBe('')
  })
})
