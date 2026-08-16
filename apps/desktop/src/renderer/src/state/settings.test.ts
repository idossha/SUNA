import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSettings, type SunaProjectManifest } from '@suna/core'
import { useProjectStore } from './project'
import {
  coerceSettings,
  getResolved,
  parseProjectSettings,
  useSettingsStore,
  GLOBAL_SETTINGS_DEFAULTS
} from './settings'

const invoke = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: { suna: { invoke } },
  writable: true,
  configurable: true
})

const manifest = {
  schemaVersion: 1,
  name: 'my-paper',
  activeProfileId: 'nature-astronomy',
  directories: {
    manuscript: 'manuscript',
    figures: 'figures',
    code: 'code',
    data: 'data',
    analysis: 'analysis',
    results: 'results',
    output: 'output'
  },
  createdAt: '2026-08-13T09:30:00.000Z'
} satisfies SunaProjectManifest

function resetStores(): void {
  invoke.mockReset()
  useSettingsStore.setState({
    settings: GLOBAL_SETTINGS_DEFAULTS,
    raw: {},
    projectSettings: null,
    resolved: resolveSettings({}, undefined),
    error: null,
    projectError: null
  })
  useProjectStore.setState({ rootDir: '/work/p', manifest, saveBump: 0 })
}

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

describe('parseProjectSettings', () => {
  it('extracts the settings block of a valid manifest', () => {
    const content = JSON.stringify({ ...manifest, settings: { editor: { fontSizePx: 18 } } })
    expect(parseProjectSettings(content)).toMatchObject({
      settings: { editor: { fontSizePx: 18 } },
      error: null
    })
  })

  it('returns a null block for a manifest without settings', () => {
    expect(parseProjectSettings(JSON.stringify(manifest))).toMatchObject({
      settings: null,
      error: null
    })
  })

  /**
   * The manifest comes back alongside the settings block so
   * refreshProjectSettings can re-seed useProjectStore from the SAME read.
   * Without that the two copies of suna.json diverge, and load() — which every
   * editor mount calls — silently reverts an out-of-band edit.
   */
  it('returns the whole manifest, so the project store can be kept in step', () => {
    expect(parseProjectSettings(JSON.stringify(manifest)).manifest).toEqual(manifest)
    expect(parseProjectSettings('{ not json').manifest).toBeNull()
    const invalid = JSON.stringify({ ...manifest, settings: { editor: { fontSizePx: 400 } } })
    expect(parseProjectSettings(invalid).manifest).toBeNull()
  })

  it('names the offending path when a value is out of range', () => {
    const content = JSON.stringify({ ...manifest, settings: { editor: { fontSizePx: 400 } } })
    const { settings, error } = parseProjectSettings(content)
    expect(settings).toBeNull()
    expect(error).toMatch(/settings\.editor\.fontSizePx/)
  })

  it('reports unparseable JSON rather than throwing', () => {
    expect(parseProjectSettings('{ not json').error).toMatch(/not valid JSON/)
  })
})

describe('resolved settings store', () => {
  beforeEach(() => {
    resetStores()
  })

  it('starts on the built-in defaults', () => {
    expect(getResolved('editor.fontSizePx')).toEqual({ value: 14, source: 'default' })
    expect(getResolved('editor.lineHeight')).toEqual({ value: 1.6, source: 'default' })
  })

  it('setGlobal writes settings:set and reports the value as global', async () => {
    invoke.mockResolvedValue({ settings: {} })
    await useSettingsStore.getState().setGlobal('editor.contentWidthCh', 90)
    expect(invoke).toHaveBeenCalledWith('settings:set', {
      patch: { 'editor.contentWidthCh': 90 }
    })
    expect(getResolved('editor.contentWidthCh')).toEqual({ value: 90, source: 'global' })
  })

  it('setGlobal keeps writing the legacy editor.theme key for the editor theme', async () => {
    invoke.mockResolvedValue({ settings: {} })
    await useSettingsStore.getState().setGlobal('editor.editorTheme', 'suna-light')
    expect(invoke).toHaveBeenCalledWith('settings:set', { patch: { 'editor.theme': 'suna-light' } })
    expect(getResolved('editor.editorTheme')).toEqual({ value: 'suna-light', source: 'global' })
  })

  it('setProject writes project:update-settings with a nested patch and never settings:set', async () => {
    invoke.mockResolvedValue({
      manifest: { ...manifest, settings: { editor: { contentWidthCh: 120 } } }
    })
    await useSettingsStore.getState().setProject('editor.contentWidthCh', 120)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('project:update-settings', {
      dir: '/work/p',
      patch: { editor: { contentWidthCh: 120 } }
    })
    expect(getResolved('editor.contentWidthCh')).toEqual({ value: 120, source: 'project' })
  })

  it('a project value wins over a global one, and clearProject falls back to it', async () => {
    invoke.mockResolvedValue({ settings: {} })
    await useSettingsStore.getState().setGlobal('editor.contentWidthCh', 90)
    invoke.mockResolvedValue({
      manifest: { ...manifest, settings: { editor: { contentWidthCh: 120 } } }
    })
    await useSettingsStore.getState().setProject('editor.contentWidthCh', 120)
    expect(getResolved('editor.contentWidthCh')).toEqual({ value: 120, source: 'project' })

    invoke.mockResolvedValue({ manifest })
    await useSettingsStore.getState().clearProject('editor.contentWidthCh')
    expect(invoke).toHaveBeenLastCalledWith('project:update-settings', {
      dir: '/work/p',
      patch: { editor: { contentWidthCh: null } }
    })
    expect(getResolved('editor.contentWidthCh')).toEqual({ value: 90, source: 'global' })
  })

  it('rolls back and reports when the project write fails', async () => {
    invoke.mockRejectedValue(new Error('read-only file system'))
    await useSettingsStore.getState().setProject('editor.fontSizePx', 18)
    expect(getResolved('editor.fontSizePx')).toEqual({ value: 14, source: 'default' })
    expect(useSettingsStore.getState().projectError).toMatch(/read-only/)
  })

  it('refuses a project write with no project open', async () => {
    useProjectStore.setState({ rootDir: null })
    await useSettingsStore.getState().setProject('editor.fontSizePx', 18)
    expect(invoke).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().projectError).toMatch(/No project/)
  })

  it('re-resolves when a manifest arrives from the project store', () => {
    useSettingsStore.getState().syncProjectSettings({ editor: { defaultMode: 'source' } })
    expect(getResolved('editor.defaultMode')).toEqual({ value: 'source', source: 'project' })
    useSettingsStore.getState().syncProjectSettings(undefined)
    expect(getResolved('editor.defaultMode')).toEqual({ value: 'reading', source: 'default' })
  })

  it('picks up an external edit of suna.json on refresh', async () => {
    invoke.mockResolvedValue({
      content: JSON.stringify({ ...manifest, settings: { editor: { lineHeight: 1.9 } } })
    })
    await useSettingsStore.getState().refreshProjectSettings()
    expect(invoke).toHaveBeenCalledWith('fs:read-text', { path: '/work/p/suna.json' })
    expect(getResolved('editor.lineHeight')).toEqual({ value: 1.9, source: 'project' })
  })

  it('keeps the last good settings when suna.json goes invalid mid-edit', async () => {
    invoke.mockResolvedValue({
      content: JSON.stringify({ ...manifest, settings: { editor: { lineHeight: 1.9 } } })
    })
    await useSettingsStore.getState().refreshProjectSettings()
    invoke.mockResolvedValue({ content: '{ "schemaVersion": 1, ' })
    await useSettingsStore.getState().refreshProjectSettings()
    expect(getResolved('editor.lineHeight')).toEqual({ value: 1.9, source: 'project' })
    expect(useSettingsStore.getState().projectError).toMatch(/not valid JSON/)
  })

  // The trap that made a project's vim override inert: `settings` is the
  // GLOBAL-only view (coerceSettings over the persisted record) and knows
  // nothing about suna.json. Anything a project may override has to be read
  // through `resolved` / useResolved / getResolved.
  it('a project vimMotions override moves resolved but never the global-only slice', async () => {
    invoke.mockResolvedValue({ settings: {} })
    await useSettingsStore.getState().setGlobal('editor.vimMotions', true)
    expect(getResolved('editor.vimMotions')).toEqual({ value: true, source: 'global' })
    expect(useSettingsStore.getState().settings['editor.vimMotions']).toBe(true)

    useSettingsStore.getState().syncProjectSettings({ editor: { vimMotions: false } })
    expect(getResolved('editor.vimMotions')).toEqual({ value: false, source: 'project' })
    expect(useSettingsStore.getState().settings['editor.vimMotions']).toBe(true)
  })

  it('drops project settings when the project closes', async () => {
    useSettingsStore.getState().syncProjectSettings({ editor: { lineHeight: 1.9 } })
    useProjectStore.setState({ rootDir: null })
    await useSettingsStore.getState().refreshProjectSettings()
    expect(getResolved('editor.lineHeight')).toEqual({ value: 1.6, source: 'default' })
  })
})
