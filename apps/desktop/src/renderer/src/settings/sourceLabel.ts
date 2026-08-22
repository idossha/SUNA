import type { SettingSource } from '@suna/core'

/**
 * What the Settings page says about where a value came from. Two levels now:
 * the user's ~/.suna/config.yml, or the value SUNA ships. Split out from
 * SettingsTab so the copy — and the fact every SettingSource is covered — is
 * unit-testable without a DOM.
 */
export const SOURCE_LABELS: Record<SettingSource, string> = {
  config: 'from your config',
  default: 'default'
}

export function sourceLabel(source: SettingSource): string {
  return SOURCE_LABELS[source]
}
