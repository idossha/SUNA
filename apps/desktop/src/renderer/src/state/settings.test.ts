import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_DEFAULTS, type LoadedConfigPayload } from '@suna/core'
import { chromeVars, useSettingsStore } from './settings'

let revision = 0

function payload(overrides: Partial<LoadedConfigPayload> = {}): LoadedConfigPayload {
  revision += 1
  return {
    revision,
    path: '/home/me/.suna/config.yml',
    text: '',
    settings: { ...SETTINGS_DEFAULTS },
    sources: Object.fromEntries(
      Object.keys(SETTINGS_DEFAULTS).map((key) => [key, 'default'])
    ) as LoadedConfigPayload['sources'],
    themesCss: '',
    themes: [{ id: 'suna-dark', name: 'SUNA Dark', base: 'dark', builtin: true }],
    diagnostics: [],
    ...overrides
  }
}

beforeEach(() => {
  useSettingsStore.setState({
    settings: SETTINGS_DEFAULTS,
    sources: Object.fromEntries(
      Object.keys(SETTINGS_DEFAULTS).map((key) => [key, 'default'])
    ) as never,
    themes: [],
    path: '',
    revision: 0,
    diagnostics: [],
    error: null
  })
})

describe('adopt', () => {
  it('takes the resolved values and their sources from the config', () => {
    useSettingsStore.getState().adopt(
      payload({
        settings: { ...SETTINGS_DEFAULTS, 'editor.lineHeight': 1.9 },
        sources: { ...payload().sources, 'editor.lineHeight': 'config' }
      })
    )
    expect(useSettingsStore.getState().settings['editor.lineHeight']).toBe(1.9)
    expect(useSettingsStore.getState().sources['editor.lineHeight']).toBe('config')
  })

  it('fills in any key the payload omitted, so the surface is never partial', () => {
    useSettingsStore
      .getState()
      .adopt(payload({ settings: { 'editor.lineHeight': 1.9 } as never }))
    expect(useSettingsStore.getState().settings['ai.model']).toBe(SETTINGS_DEFAULTS['ai.model'])
  })

  it('surfaces the config path and its diagnostics', () => {
    useSettingsStore
      .getState()
      .adopt(payload({ diagnostics: [{ path: 'editor.lineHeight', message: 'too big' }] }))
    expect(useSettingsStore.getState().path).toBe('/home/me/.suna/config.yml')
    expect(useSettingsStore.getState().diagnostics).toHaveLength(1)
  })
})

describe('set', () => {
  it('applies optimistically, then adopts what the file actually became', async () => {
    const invoke = vi.fn().mockResolvedValue({
      config: payload({
        settings: { ...SETTINGS_DEFAULTS, 'editor.fontSizePx': 18 },
        sources: { ...payload().sources, 'editor.fontSizePx': 'config' }
      }),
      error: null
    })
    vi.stubGlobal('window', { suna: { invoke } })

    await useSettingsStore.getState().set('editor.fontSizePx', 18)
    expect(invoke).toHaveBeenCalledWith('config:set', { key: 'editor.fontSizePx', value: 18 })
    expect(useSettingsStore.getState().settings['editor.fontSizePx']).toBe(18)
    expect(useSettingsStore.getState().sources['editor.fontSizePx']).toBe('config')
  })

  it('rolls back and reports when the write fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('disk is full'))
    vi.stubGlobal('window', { suna: { invoke } })

    await useSettingsStore.getState().set('editor.fontSizePx', 18)
    expect(useSettingsStore.getState().settings['editor.fontSizePx']).toBe(
      SETTINGS_DEFAULTS['editor.fontSizePx']
    )
    expect(useSettingsStore.getState().error).toBe('disk is full')
  })

  it("keeps main's answer but shows the error when the file could not be rewritten", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ config: payload(), error: 'config.yml is not valid YAML' })
    vi.stubGlobal('window', { suna: { invoke } })

    await useSettingsStore.getState().set('editor.fontSizePx', 18)
    expect(useSettingsStore.getState().settings['editor.fontSizePx']).toBe(
      SETTINGS_DEFAULTS['editor.fontSizePx']
    )
    expect(useSettingsStore.getState().error).toBe('config.yml is not valid YAML')
  })
})

describe('reset', () => {
  it('sends a null so the key is deleted from the file', async () => {
    const invoke = vi.fn().mockResolvedValue({ config: payload(), error: null })
    vi.stubGlobal('window', { suna: { invoke } })

    await useSettingsStore.getState().reset('editor.fontSizePx')
    expect(invoke).toHaveBeenCalledWith('config:set', {
      key: 'editor.fontSizePx',
      value: null
    })
    expect(useSettingsStore.getState().sources['editor.fontSizePx']).toBe('default')
  })
})

describe('adopt ordering', () => {
  it('ignores a config older than the one already held', () => {
    const older = payload({ settings: { ...SETTINGS_DEFAULTS, 'editor.lineHeight': 1.5 } })
    const newer = payload({ settings: { ...SETTINGS_DEFAULTS, 'editor.lineHeight': 1.9 } })
    useSettingsStore.getState().adopt(newer)
    // A `config:set` reply landing after a file-watch push that superseded it
    // must not roll the UI back over the hand edit.
    useSettingsStore.getState().adopt(older)
    expect(useSettingsStore.getState().settings['editor.lineHeight']).toBe(1.9)
  })
})

describe('chromeVars', () => {
  it('maps the ui block onto the properties tokens.css declares', () => {
    const vars = chromeVars({
      ...SETTINGS_DEFAULTS,
      'ui.scale': 1.1,
      'ui.statusBarHeightPx': 30,
      'ui.radiusPx': 0,
      'ui.textScale': 2
    })
    expect(vars['zoom']).toBe('1.1')
    expect(vars['--s-statusbar-h']).toBe('30px')
    // 0 has to survive: square corners are a real choice, not an unset value.
    expect(vars['--s-radius']).toBe('0px')
    expect(vars['--s-text-md']).toBe('26px')
  })

  it('nulls a font stack the config leaves empty, so the shipped one applies', () => {
    expect(chromeVars({ ...SETTINGS_DEFAULTS, 'ui.fontMono': '' })['--s-font-mono']).toBeNull()
  })

  it('passes a font stack through verbatim when the config names one', () => {
    const vars = chromeVars({ ...SETTINGS_DEFAULTS, 'ui.fontMono': 'Berkeley Mono, monospace' })
    expect(vars['--s-font-mono']).toBe('Berkeley Mono, monospace')
  })
})
