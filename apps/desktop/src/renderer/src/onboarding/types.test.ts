import { describe, expect, it } from 'vitest'
import { SETTING_KEYS } from '@suna/core'
import { createInitialWizardState, wizardSettingWrites, repoNameFromProjectName } from './types'

describe('wizardSettingWrites', () => {
  it('maps the "skip" AI choice to mode "none" and clears the CLI command', () => {
    const writes = wizardSettingWrites(createInitialWizardState('create', { aiChoice: 'skip' }))
    expect(writes).toContainEqual({ key: 'ai.mode', value: 'none' })
    expect(writes).toContainEqual({ key: 'ai.cliCommand', value: null })
  })

  it('carries the chosen CLI command when aiChoice is "cli"', () => {
    const state = createInitialWizardState('create', { aiChoice: 'cli', aiCliCommand: 'claude' })
    const writes = wizardSettingWrites(state)
    expect(writes).toContainEqual({ key: 'ai.mode', value: 'cli' })
    expect(writes).toContainEqual({ key: 'ai.cliCommand', value: 'claude' })
  })

  it('writes all five Defaults, and every key it names is a real setting', () => {
    const writes = wizardSettingWrites(createInitialWizardState('create'))
    expect(writes).toContainEqual({ key: 'editor.editorTheme', value: 'suna-dark' })
    expect(writes).toContainEqual({ key: 'editor.lineHeight', value: 1.6 })
    expect(writes).toContainEqual({ key: 'editor.contentWidthCh', value: 140 })
    for (const write of writes) {
      expect(SETTING_KEYS[write.key], write.key).toBeDefined()
    }
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
