import { describe, expect, it } from 'vitest'
import { stepGate } from './gating'
import { createInitialWizardState } from './types'

describe('stepGate — step 1 (Where & what)', () => {
  it('blocks with no parent directory chosen', () => {
    const state = createInitialWizardState('create', { parentDir: null, name: 'paper' })
    expect(stepGate(1, state)).toEqual({ canAdvance: false, reason: 'Choose a parent folder.' })
  })

  it('blocks (silently) while the filesystem check is in flight', () => {
    const state = createInitialWizardState('create', {
      parentDir: '/work',
      name: 'paper',
      targetExists: null,
      targetParentWritable: null
    })
    expect(stepGate(1, state)).toEqual({ canAdvance: false, reason: null })
  })

  it('blocks while checkingTarget is true even if a stale check result is present', () => {
    const state = createInitialWizardState('create', {
      parentDir: '/work',
      name: 'paper',
      targetExists: false,
      targetParentWritable: true,
      checkingTarget: true
    })
    expect(stepGate(1, state).canAdvance).toBe(false)
  })

  it('blocks when the target already exists', () => {
    const state = createInitialWizardState('create', {
      parentDir: '/work',
      name: 'paper',
      targetExists: true,
      targetParentWritable: true
    })
    expect(stepGate(1, state).canAdvance).toBe(false)
  })

  it('advances once name, parent, and the filesystem check all pass', () => {
    const state = createInitialWizardState('create', {
      parentDir: '/work',
      name: 'paper',
      targetExists: false,
      targetParentWritable: true
    })
    expect(stepGate(1, state)).toEqual({ canAdvance: true, reason: null })
  })
})

describe('stepGate — step 2 (Target journal)', () => {
  it('always advances — "Decide later" is allowed', () => {
    const state = createInitialWizardState('create', { profileId: null, decideLater: true })
    expect(stepGate(2, state)).toEqual({ canAdvance: true, reason: null })
  })
})

describe('stepGate — step 3 (What to scaffold)', () => {
  it('advances for blank and starter with no importDir needed', () => {
    expect(stepGate(3, createInitialWizardState('create', { scaffold: 'blank' })).canAdvance).toBe(
      true
    )
    expect(
      stepGate(3, createInitialWizardState('create', { scaffold: 'starter' })).canAdvance
    ).toBe(true)
  })

  it('blocks import until a source folder is chosen', () => {
    const state = createInitialWizardState('create', { scaffold: 'import', importDir: null })
    expect(stepGate(3, state).canAdvance).toBe(false)
  })

  it('advances import once a source folder is chosen, even with zero files found', () => {
    const state = createInitialWizardState('create', {
      scaffold: 'import',
      importDir: '/old-paper',
      importFiles: []
    })
    expect(stepGate(3, state).canAdvance).toBe(true)
  })
})

describe('stepGate — step 4 (Python environment)', () => {
  it('advances on skip and on create-with-uv', () => {
    expect(
      stepGate(4, createInitialWizardState('create', { pythonChoice: 'skip' })).canAdvance
    ).toBe(true)
    expect(
      stepGate(4, createInitialWizardState('create', { pythonChoice: 'create-uv' })).canAdvance
    ).toBe(true)
  })

  it('blocks "use existing" until one is selected', () => {
    const state = createInitialWizardState('create', {
      pythonChoice: 'existing',
      existingEnvPath: null
    })
    expect(stepGate(4, state).canAdvance).toBe(false)
  })

  it('advances "use existing" once a path is selected', () => {
    const state = createInitialWizardState('create', {
      pythonChoice: 'existing',
      existingEnvPath: '/work/paper/.venv'
    })
    expect(stepGate(4, state).canAdvance).toBe(true)
  })
})

describe('stepGate — step 5 (AI)', () => {
  it('advances on cli and skip', () => {
    expect(stepGate(5, createInitialWizardState('create', { aiChoice: 'cli' })).canAdvance).toBe(
      true
    )
    expect(stepGate(5, createInitialWizardState('create', { aiChoice: 'skip' })).canAdvance).toBe(
      true
    )
  })

  it('blocks api with no provider chosen', () => {
    const state = createInitialWizardState('create', { aiChoice: 'api', apiProvider: null })
    expect(stepGate(5, state).canAdvance).toBe(false)
  })

  it('blocks api with a provider but an empty key', () => {
    const state = createInitialWizardState('create', {
      aiChoice: 'api',
      apiProvider: 'anthropic',
      apiKey: ''
    })
    expect(stepGate(5, state).canAdvance).toBe(false)
  })

  it('advances api once a provider and a non-empty key are both set', () => {
    const state = createInitialWizardState('create', {
      aiChoice: 'api',
      apiProvider: 'anthropic',
      apiKey: 'sk-ant-...'
    })
    expect(stepGate(5, state).canAdvance).toBe(true)
  })
})

describe('stepGate — step 6 (Defaults) and step 7 (Review)', () => {
  it('step 6 always advances', () => {
    expect(stepGate(6, createInitialWizardState('create')).canAdvance).toBe(true)
  })

  it('step 7 advances when idle and blocks while creating', () => {
    expect(stepGate(7, createInitialWizardState('create', { creating: false })).canAdvance).toBe(
      true
    )
    expect(stepGate(7, createInitialWizardState('create', { creating: true })).canAdvance).toBe(
      false
    )
  })
})
