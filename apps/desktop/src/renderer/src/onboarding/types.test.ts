import { describe, expect, it } from 'vitest'
import { ProjectSettingsSchema } from '@suna/core'
import {
  buildScaffoldSettings,
  createInitialWizardState,
  defaultsToGlobalPatch,
  defaultsToProjectSettings,
  FALLBACK_DEFAULTS
} from './types'

describe('defaultsToProjectSettings', () => {
  it('nests the five step-6 values under editor and validates against ProjectSettingsSchema', () => {
    const patch = defaultsToProjectSettings(FALLBACK_DEFAULTS)
    expect(ProjectSettingsSchema.safeParse(patch).success).toBe(true)
    expect(patch).toEqual({
      editor: {
        defaultMode: 'reading',
        editorTheme: 'suna-dark',
        fontSizePx: 14,
        lineHeight: 1.6,
        contentWidthCh: 68
      }
    })
  })
})

describe('defaultsToGlobalPatch', () => {
  it('keys the editor theme under the legacy "editor.theme" global slot', () => {
    const patch = defaultsToGlobalPatch(FALLBACK_DEFAULTS)
    expect(patch['editor.theme']).toBe('suna-dark')
    expect(patch['editor.editorTheme']).toBeUndefined()
  })

  it('carries the other four values under their own dotted keys', () => {
    const patch = defaultsToGlobalPatch({
      defaultMode: 'source',
      editorTheme: 'high-contrast',
      fontSizePx: 18,
      lineHeight: 1.8,
      contentWidthCh: 80
    })
    expect(patch).toEqual({
      'editor.defaultMode': 'source',
      'editor.theme': 'high-contrast',
      'editor.fontSizePx': 18,
      'editor.lineHeight': 1.8,
      'editor.contentWidthCh': 80
    })
  })
})

describe('buildScaffoldSettings', () => {
  it('always includes the AI choice, mapping "skip" to mode "none"', () => {
    const state = createInitialWizardState('create', { aiChoice: 'skip' })
    expect(buildScaffoldSettings(state)).toEqual({ ai: { mode: 'none', cliCommand: null } })
  })

  it('carries the chosen CLI command when aiChoice is "cli"', () => {
    const state = createInitialWizardState('create', { aiChoice: 'cli', aiCliCommand: 'claude' })
    expect(buildScaffoldSettings(state)).toEqual({ ai: { mode: 'cli', cliCommand: 'claude' } })
  })

  it('omits the editor block when "save defaults to project" is off', () => {
    const state = createInitialWizardState('create', { saveDefaultsToProject: false })
    expect(buildScaffoldSettings(state).editor).toBeUndefined()
  })

  it('includes the editor block, and it validates, when the checkbox is on', () => {
    const state = createInitialWizardState('create', { saveDefaultsToProject: true })
    const settings = buildScaffoldSettings(state)
    expect(settings.editor).toEqual({
      defaultMode: 'reading',
      editorTheme: 'suna-dark',
      fontSizePx: 14,
      lineHeight: 1.6,
      contentWidthCh: 68
    })
    expect(ProjectSettingsSchema.safeParse(settings).success).toBe(true)
  })
})
