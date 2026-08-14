import { GLOBAL_SETTINGS_DEFAULTS, useSettingsStore } from '../state/settings'

/**
 * Dev-only seam for e2e drivers (wired into window.__sunaDev by the verifier;
 * not imported by production code).
 */
export const settingsDevSeam = {
  settingsStore: useSettingsStore,
  defaults: GLOBAL_SETTINGS_DEFAULTS
}
