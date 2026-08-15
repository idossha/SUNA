import { describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS, resolveSettings, type ResolvedSettings } from '@suna/core'
import { EDITOR_SETTINGS_LIMITS } from '../editor/settings'
import { MIRRORED_EDITOR_KEYS, editorPatchFor } from './editorSettingsBridge'

const base = (): ResolvedSettings => ({ ...SETTINGS_DEFAULTS })

describe('editorPatchFor', () => {
  it('applies nothing for the very first resolution', () => {
    // The baseline must not stamp defaults over a value the user already
    // saved through the gear popover (feature-plan-5 §2: "existing users'
    // persisted values are untouched").
    expect(editorPatchFor(null, base())).toEqual({})
  })

  it('applies nothing when nothing moved', () => {
    expect(editorPatchFor(base(), base())).toEqual({})
  })

  it('patches only the key whose resolved value changed', () => {
    const next = { ...base(), 'editor.contentWidthCh': 97 }
    expect(editorPatchFor(base(), next)).toEqual({ contentWidthCh: 97 })
  })

  it('patches several keys at once', () => {
    const next = { ...base(), 'editor.fontSizePx': 19, 'editor.lineHeight': 1.9 }
    expect(editorPatchFor(base(), next)).toEqual({ fontSizePx: 19, lineHeight: 1.9 })
  })

  it('carries the non-numeric keys through unchanged', () => {
    const next = {
      ...base(),
      'editor.fontFamily': 'sans' as const,
      'editor.editorTheme': 'suna-light' as const
    }
    expect(editorPatchFor(base(), next)).toEqual({
      fontFamily: 'sans',
      editorTheme: 'suna-light'
    })
  })

  it('pulls the editor back to the fallback when a project override is reset', () => {
    // "Reset to global" must not strand the editor on the override — the
    // resolution moving 97 → 68 is itself the change that gets applied.
    const overridden = { ...base(), 'editor.contentWidthCh': 97 }
    expect(editorPatchFor(overridden, base())).toEqual({
      contentWidthCh: SETTINGS_DEFAULTS['editor.contentWidthCh']
    })
  })

  it('ignores resolved keys that are not editor-surface settings', () => {
    const next = { ...base(), 'python.envPath': '/tmp/.venv', 'ai.mode': 'api' as const }
    expect(editorPatchFor(base(), next)).toEqual({})
  })

  it('clamps a numeric value that somehow arrives out of the editor limits', () => {
    const next = { ...base(), 'editor.fontSizePx': 999 }
    expect(editorPatchFor(base(), next)).toEqual({
      fontSizePx: EDITOR_SETTINGS_LIMITS.fontSizePx.max
    })
  })

  it('mirrors exactly the five editor-surface keys', () => {
    expect(Object.keys(MIRRORED_EDITOR_KEYS).sort()).toEqual([
      'editor.contentWidthCh',
      'editor.editorTheme',
      'editor.fontFamily',
      'editor.fontSizePx',
      'editor.lineHeight'
    ])
  })

  it('agrees with the resolver about a project override winning', () => {
    // End-to-end over the real resolver rather than a hand-built object.
    const before = resolveSettings({}, undefined).value
    const after = resolveSettings({}, { editor: { contentWidthCh: 120 } }).value
    expect(editorPatchFor(before, after)).toEqual({ contentWidthCh: 120 })
  })
})

describe('the two limit tables that both bound editor typography', () => {
  it('agree, so a value the resolver accepts is never clamped by the editor', () => {
    // @suna/core's SETTINGS_LIMITS bounds what may be written to suna.json /
    // userData; EDITOR_SETTINGS_LIMITS bounds the surface store. They must
    // match or a legally-stored setting would silently render as another value.
    expect(EDITOR_SETTINGS_LIMITS.contentWidthCh).toEqual({ min: 50, max: 150 })
    expect(EDITOR_SETTINGS_LIMITS.fontSizePx).toEqual({ min: 12, max: 22 })
    expect(EDITOR_SETTINGS_LIMITS.lineHeight).toEqual({ min: 1.4, max: 2 })
  })
})
