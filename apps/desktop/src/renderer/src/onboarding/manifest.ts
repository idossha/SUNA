import {
  DEFAULT_PROJECT_DIRS,
  SunaProjectManifestSchema,
  starterDocuments,
  type SunaProjectManifest
} from '@suna/core'
import type { ScaffoldKind } from './types'

export interface WizardManifestInput {
  name: string
  activeProfileId: string
  /**
   * Which scaffold Create will run. It changes the manifest: only the Starter
   * ships a cover letter beside the paper, so only the Starter declares a
   * document registry (ARCHITECTURE §4.2) — exactly as `scaffoldProject` does.
   */
  scaffold: ScaffoldKind
  /** Injectable for deterministic tests/snapshots; defaults to "now". */
  createdAt?: string
}

/**
 * Builds the exact suna.json the Review step previews and Create
 * asks the main process to write — pure, so the preview and the eventual
 * write can never diverge in shape. Validated against the same schema the
 * writer uses, so an invalid wizard state fails here, in the UI, rather than
 * silently producing a manifest the main process would reject.
 */
export function buildProjectManifest(input: WizardManifestInput): SunaProjectManifest {
  return SunaProjectManifestSchema.parse({
    schemaVersion: 1,
    name: input.name,
    activeProfileId: input.activeProfileId,
    directories: DEFAULT_PROJECT_DIRS,
    // Absent, not empty, for every other scaffold: a manifest with
    // `documents: []` is a different thing on disk from one that never
    // mentions documents at all.
    ...(input.scaffold === 'starter' ? { documents: starterDocuments() } : {}),
    createdAt: input.createdAt ?? new Date().toISOString()
  })
}
