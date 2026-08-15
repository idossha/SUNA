import {
  DEFAULT_PROJECT_DIRS,
  SunaProjectManifestSchema,
  mergeProjectSettings,
  type ProjectSettings,
  type SunaProjectManifest
} from '@suna/core'

export interface WizardManifestInput {
  name: string
  activeProfileId: string
  settings: ProjectSettings
  /** Injectable for deterministic tests/snapshots; defaults to "now". */
  createdAt?: string
}

/**
 * Builds the exact suna.json step 7 (Review) previews and step 7 (Create)
 * asks the main process to write — pure, so the preview and the eventual
 * write can never diverge in shape. Validated against the same schema the
 * writer uses, so an invalid wizard state fails here, in the UI, rather than
 * silently producing a manifest the main process would reject.
 */
export function buildProjectManifest(input: WizardManifestInput): SunaProjectManifest {
  const settingsBlock = mergeProjectSettings({}, input.settings)
  return SunaProjectManifestSchema.parse({
    schemaVersion: 1,
    name: input.name,
    activeProfileId: input.activeProfileId,
    directories: DEFAULT_PROJECT_DIRS,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(settingsBlock !== undefined ? { settings: settingsBlock } : {})
  })
}
