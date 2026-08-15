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

  it('defaults lit.cli to auto and adopts a valid persisted preference', () => {
    expect(coerceSettings({})['lit.cli']).toBe('auto')
    expect(coerceSettings({ 'lit.cli': 'claude' })['lit.cli']).toBe('claude')
    expect(coerceSettings({ 'lit.cli': 'codex' })['lit.cli']).toBe('codex')
  })

  it('ignores an unknown lit.cli value and falls back to auto', () => {
    expect(coerceSettings({ 'lit.cli': 'gemini' })['lit.cli']).toBe('auto')
  })

  it('defaults references.autoOpenPdf to on and adopts a persisted false', () => {
    expect(coerceSettings({})['references.autoOpenPdf']).toBe(true)
    expect(coerceSettings({ 'references.autoOpenPdf': false })['references.autoOpenPdf']).toBe(false)
  })

  it('ignores a non-boolean references.autoOpenPdf and falls back to the default', () => {
    expect(coerceSettings({ 'references.autoOpenPdf': 'no' })['references.autoOpenPdf']).toBe(true)
  })
})
