import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampSetting,
  EDITOR_SETTINGS_DEFAULTS,
  FONT_FAMILY_STACKS,
  useEditorSettings
} from './settings'

describe('clampSetting', () => {
  it('clamps to the documented ranges', () => {
    expect(clampSetting('contentWidthCh', 10)).toBe(50)
    expect(clampSetting('contentWidthCh', 500)).toBe(100)
    expect(clampSetting('fontSizePx', 8)).toBe(12)
    expect(clampSetting('fontSizePx', 99)).toBe(22)
    expect(clampSetting('lineHeight', 1)).toBe(1.4)
    expect(clampSetting('lineHeight', 3)).toBe(2)
  })

  it('passes in-range values through', () => {
    expect(clampSetting('contentWidthCh', 68)).toBe(68)
    expect(clampSetting('lineHeight', 1.7)).toBe(1.7)
  })

  it('falls back to the default on NaN', () => {
    expect(clampSetting('fontSizePx', Number.NaN)).toBe(EDITOR_SETTINGS_DEFAULTS.fontSizePx)
  })
})

describe('useEditorSettings store', () => {
  beforeEach(() => {
    useEditorSettings.getState().reset()
  })

  it('starts at the documented defaults', () => {
    const state = useEditorSettings.getState()
    expect(state.contentWidthCh).toBe(68)
    expect(state.fontSizePx).toBe(16)
    expect(state.fontFamily).toBe('serif')
    expect(state.lineHeight).toBe(1.7)
    expect(state.editorTheme).toBe('suna-dark')
  })

  it('clamps numeric setters', () => {
    useEditorSettings.getState().setFontSizePx(99)
    expect(useEditorSettings.getState().fontSizePx).toBe(22)
    useEditorSettings.getState().setContentWidthCh(1)
    expect(useEditorSettings.getState().contentWidthCh).toBe(50)
    useEditorSettings.getState().setLineHeight(0.5)
    expect(useEditorSettings.getState().lineHeight).toBe(1.4)
  })

  it('sets categorical settings and resets', () => {
    useEditorSettings.getState().setFontFamily('mono')
    useEditorSettings.getState().setEditorTheme('suna-light')
    expect(useEditorSettings.getState().fontFamily).toBe('mono')
    expect(useEditorSettings.getState().editorTheme).toBe('suna-light')
    useEditorSettings.getState().reset()
    expect(useEditorSettings.getState().fontFamily).toBe('serif')
    expect(useEditorSettings.getState().editorTheme).toBe('suna-dark')
  })

  it('maps every font family to a token stack', () => {
    expect(FONT_FAMILY_STACKS.serif).toContain('--s-font-serif')
    expect(FONT_FAMILY_STACKS.sans).toContain('--s-font-ui')
    expect(FONT_FAMILY_STACKS.mono).toContain('--s-font-mono')
  })
})
