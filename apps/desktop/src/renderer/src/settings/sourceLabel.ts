import type { SettingSource } from '@suna/core'

/**
 * Exact copy the Settings page shows for a resolved setting's winning level
 * (feature-plan-5 §4's own wording: "from project" / "from global" /
 * "default"). Split out from SettingsTab so the copy — and the fact every
 * SettingSource is covered — is unit-testable without a DOM.
 */
export const SOURCE_LABELS: Record<SettingSource, string> = {
  project: 'from project',
  global: 'from global',
  default: 'default'
}

export function sourceLabel(source: SettingSource): string {
  return SOURCE_LABELS[source]
}
