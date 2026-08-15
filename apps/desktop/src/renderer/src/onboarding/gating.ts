import { validateTarget, type TargetCheckResult } from './validation'
import type { WizardState } from './types'

export interface StepGate {
  canAdvance: boolean
  reason: string | null
}

const OK: StepGate = { canAdvance: true, reason: null }

function targetCheck(state: WizardState): TargetCheckResult | null {
  if (state.targetExists === null || state.targetParentWritable === null) return null
  return { exists: state.targetExists, parentWritable: state.targetParentWritable }
}

function gateStep1(state: WizardState): StepGate {
  if (state.checkingTarget) return { canAdvance: false, reason: null }
  const result = validateTarget(state.parentDir, state.name, targetCheck(state))
  return { canAdvance: result.valid, reason: result.reason }
}

function gateStep3(state: WizardState): StepGate {
  if (state.scaffold !== 'import') return OK
  if (state.importDir === null) {
    return { canAdvance: false, reason: 'Choose a folder to import files from.' }
  }
  return OK
}

function gateStep4(state: WizardState): StepGate {
  if (state.pythonChoice !== 'existing') return OK
  if (state.existingEnvPath === null) {
    return { canAdvance: false, reason: 'Select one of the detected environments.' }
  }
  return OK
}

function gateStep5(state: WizardState): StepGate {
  if (state.aiChoice !== 'api') return OK
  if (state.apiProvider === null) {
    return { canAdvance: false, reason: 'Choose a provider.' }
  }
  if (state.apiKey.trim() === '') {
    return { canAdvance: false, reason: 'Enter an API key.' }
  }
  return OK
}

/**
 * Whether "Next" (or, on step 7, "Create project") is enabled for the step
 * the wizard is currently on — pure given the wizard's state, so the same
 * function drives the button and is unit-testable without rendering
 * anything. Steps 2 and 6 have no gate ("Decide later" / defaults are always
 * valid); step 7's gate is "not already creating".
 */
export function stepGate(step: number, state: WizardState): StepGate {
  switch (step) {
    case 1:
      return gateStep1(state)
    case 2:
      return OK
    case 3:
      return gateStep3(state)
    case 4:
      return gateStep4(state)
    case 5:
      return gateStep5(state)
    case 6:
      return OK
    case 7:
      return state.creating ? { canAdvance: false, reason: null } : OK
    default:
      return OK
  }
}
