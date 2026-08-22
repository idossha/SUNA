import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_DEFAULTS } from '@suna/core'
import { useSettingsStore } from '../state/settings'
import {
  clampSetting,
  editorSurfaceStyle,
  EDITOR_SETTINGS_DEFAULTS,
  FONT_FAMILY_STACKS,
  useEditorSettings
} from './settings'

describe('editorSurfaceStyle', () => {
  it('publishes every --ed-* custom property the editor surface reads', () => {
    const style = editorSurfaceStyle({
      contentWidthCh: 72,
      fontSizePx: 18,
      fontFamily: 'mono',
      lineHeight: 1.55,
      editorTheme: 'suna-dark'
    }) as Record<string, string>
    // --ed-content-width is the one editor.css puts on .cm-content as a
    // max-width, so a ch value here is what makes the slider change the measure
    expect(style['--ed-content-width']).toBe('72ch')
    expect(style['--ed-font-size']).toBe('18px')
    expect(style['--ed-line-height']).toBe('1.55')
    expect(style['--ed-body-font']).toBe(FONT_FAMILY_STACKS.mono)
  })

  it('tracks the width setting across its whole range', () => {
    for (const width of [50, 68, 150]) {
      const style = editorSurfaceStyle({
        ...EDITOR_SETTINGS_DEFAULTS,
        contentWidthCh: width
      }) as Record<string, string>
      expect(style['--ed-content-width']).toBe(`${width}ch`)
    }
  })
})

describe('clampSetting', () => {
  it('clamps to the documented ranges', () => {
    expect(clampSetting('contentWidthCh', 10)).toBe(50)
    expect(clampSetting('contentWidthCh', 500)).toBe(150)
    expect(clampSetting('contentWidthCh', 120)).toBe(120)
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
    vi.unstubAllGlobals()
    useSettingsStore.setState({ settings: SETTINGS_DEFAULTS })
    useEditorSettings.setState({ ...EDITOR_SETTINGS_DEFAULTS })
  })

  it('starts at the documented defaults', () => {
    const state = useEditorSettings.getState()
    expect(state.contentWidthCh).toBe(140)
    // feature-plan-5 §2: 14px / 1.6, matching @suna/core's SETTINGS_DEFAULTS
    expect(state.fontSizePx).toBe(14)
    expect(state.fontFamily).toBe('serif')
    expect(state.lineHeight).toBe(1.6)
    expect(state.editorTheme).toBe('suna-dark')
  })

  it('delegates a setter to the config store rather than mutating locally', async () => {
    const invoke = vi.fn().mockResolvedValue({
      config: {
        path: '/home/me/.suna/config.yml',
        text: '',
        settings: { ...SETTINGS_DEFAULTS, 'editor.fontSizePx': 22 },
        sources: {},
        themesCss: '',
        themes: [],
        diagnostics: []
      },
      error: null
    })
    vi.stubGlobal('window', { suna: { invoke } })

    // Clamped on the way out: the store's own limits are what the config file
    // is asked for, so an out-of-range slider drag cannot land in the file.
    useEditorSettings.getState().setFontSizePx(99)
    expect(invoke).toHaveBeenCalledWith('config:set', { key: 'editor.fontSizePx', value: 22 })

    // And the surface follows once the config comes back — this store is a
    // projection of the config, never a second place a value lives.
    await Promise.resolve()
    await Promise.resolve()
    expect(useEditorSettings.getState().fontSizePx).toBe(22)
  })

  it('projects the resolved config onto the surface style', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'editor.contentWidthCh': 92 }
    })
    const style = editorSurfaceStyle(useEditorSettings.getState()) as Record<string, string>
    expect(style['--ed-content-width']).toBe('92ch')
  })

  it('maps every font family to a token stack', () => {
    expect(FONT_FAMILY_STACKS.serif).toContain('--s-font-serif')
    expect(FONT_FAMILY_STACKS.sans).toContain('--s-font-ui')
    expect(FONT_FAMILY_STACKS.mono).toContain('--s-font-mono')
  })
})
