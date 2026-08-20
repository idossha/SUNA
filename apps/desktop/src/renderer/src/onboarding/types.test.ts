import { describe, expect, it } from 'vitest'
import { ProjectSettingsSchema } from '@suna/core'
import {
  buildScaffoldSettings,
  createInitialWizardState,
  defaultsToProjectSettings,
  FALLBACK_DEFAULTS,
  repoNameFromProjectName
} from './types'

describe('defaultsToProjectSettings', () => {
  it('nests the five Defaults values under editor and validates against ProjectSettingsSchema', () => {
    const patch = defaultsToProjectSettings(FALLBACK_DEFAULTS)
    expect(ProjectSettingsSchema.safeParse(patch).success).toBe(true)
    expect(patch).toEqual({
      editor: {
        defaultMode: 'reading',
        editorTheme: 'suna-dark',
        fontSizePx: 14,
        lineHeight: 1.6,
        contentWidthCh: 140
      }
    })
  })
})

describe('buildScaffoldSettings', () => {
  it('always includes the AI choice, mapping "skip" to mode "none"', () => {
    const state = createInitialWizardState('create', { aiChoice: 'skip' })
    expect(buildScaffoldSettings(state).ai).toEqual({ mode: 'none', cliCommand: null })
  })

  it('carries the chosen CLI command when aiChoice is "cli"', () => {
    const state = createInitialWizardState('create', { aiChoice: 'cli', aiCliCommand: 'claude' })
    expect(buildScaffoldSettings(state).ai).toEqual({ mode: 'cli', cliCommand: 'claude' })
  })

  it('always writes the defaults into the project, and they validate', () => {
    const state = createInitialWizardState('create')
    const settings = buildScaffoldSettings(state)
    expect(settings.editor).toEqual({
      defaultMode: 'reading',
      editorTheme: 'suna-dark',
      fontSizePx: 14,
      lineHeight: 1.6,
      contentWidthCh: 140
    })
    expect(ProjectSettingsSchema.safeParse(settings).success).toBe(true)
  })
})

describe('repoNameFromProjectName', () => {
  it('passes a name that is already a valid repository name through', () => {
    expect(repoNameFromProjectName('quenching-paper')).toBe('quenching-paper')
  })

  it('replaces runs of anything git or GitHub would reject with one dash', () => {
    expect(repoNameFromProjectName('Ram-pressure stripping at z=1.7')).toBe(
      'Ram-pressure-stripping-at-z-1.7'
    )
  })

  it('trims leading and trailing separators, which GitHub refuses', () => {
    expect(repoNameFromProjectName('  ...my paper...  ')).toBe('my-paper')
  })

  it('falls back rather than proposing an empty name', () => {
    expect(repoNameFromProjectName('   ')).toBe('manuscript')
    expect(repoNameFromProjectName('///')).toBe('manuscript')
  })

  it('caps the length at GitHub\'s limit', () => {
    expect(repoNameFromProjectName('a'.repeat(300))).toHaveLength(100)
  })
})
