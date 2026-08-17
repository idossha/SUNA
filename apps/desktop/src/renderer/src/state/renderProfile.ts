import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BUNDLED_PROFILE_IDS, getBundledProfile, type BundledProfileId } from '@suna/formatter'
import { useProjectStore } from './project'

/**
 * Preview render profile — which publisher profile the References view and
 * the combined Manuscript tab *visualize* with. Defaults to the project's
 * activeProfileId (suna.json); the References view's 'Rendered as' selector
 * overrides it per project, persisted in localStorage keyed by rootDir.
 *
 * The override never writes back to suna.json — it is a view preference, not
 * a project setting.
 */

// The house style: what new projects draft in (main's project.ts default),
// and — unlike a journal — never hidden from the pickers.
export const FALLBACK_PROFILE_ID: BundledProfileId = 'suna'

export function isBundledProfileId(
  id: string | null | undefined
): id is BundledProfileId {
  return id != null && (BUNDLED_PROFILE_IDS as readonly string[]).includes(id)
}

/**
 * Pure resolution: a valid per-project override wins, then the project's
 * activeProfileId (when it names a bundled profile), then the fallback.
 */
export function resolvePreviewProfileId(
  override: string | undefined,
  activeProfileId: string | null | undefined
): BundledProfileId {
  if (isBundledProfileId(override)) return override
  if (isBundledProfileId(activeProfileId)) return activeProfileId
  return FALLBACK_PROFILE_ID
}

/**
 * Short labels for the profile pickers ('Rendered as', Settings). Only ids
 * whose full `journalName` is too long for a picker need an entry — this map
 * is deliberately PARTIAL so that bundling a new profile can never again
 * break the build (it did: two hardcoded `Record<BundledProfileId, string>`
 * maps went stale the moment feature-plan-6 §1 added eight journals).
 */
const PROFILE_SHORT_LABELS: Partial<Record<BundledProfileId, string>> = {
  'nature-astronomy': 'Nat. Astron.',
  'apj-aas': 'ApJ (AAS)',
  mnras: 'MNRAS',
  'brain-stimulation': 'Brain Stimul.',
  jne: 'J. Neural Eng.',
  jneurosci: 'J. Neurosci.',
  'sleep-advances': 'SLEEP Adv.'
}

/**
 * Display label for a bundled profile: the short label when one is defined,
 * otherwise the profile's own `journalName`, otherwise the raw id. Total by
 * construction — a newly bundled profile shows up automatically.
 */
export function profileLabel(id: BundledProfileId): string {
  return PROFILE_SHORT_LABELS[id] ?? getBundledProfile(id)?.journalName ?? id
}

interface RenderProfileState {
  /**
   * Per-project 'Rendered as' overrides keyed by project rootDir. Values are
   * plain strings so persisted ids that stop being bundled degrade gracefully
   * (resolvePreviewProfileId validates on read).
   */
  byProject: Record<string, string>
  setPreviewProfile: (rootDir: string, id: BundledProfileId) => void
}

export const useRenderProfileStore = create<RenderProfileState>()(
  persist(
    (set) => ({
      byProject: {},
      setPreviewProfile: (rootDir, id) =>
        set((s) => ({ byProject: { ...s.byProject, [rootDir]: id } }))
    }),
    {
      name: 'suna-render-profile',
      version: 1,
      partialize: (state) => ({ byProject: state.byProject })
    }
  )
)

/** Effective preview profile id for the open project. */
export function usePreviewProfileId(): BundledProfileId {
  const rootDir = useProjectStore((s) => s.rootDir)
  const activeProfileId = useProjectStore((s) => s.manifest?.activeProfileId ?? null)
  const override = useRenderProfileStore((s) =>
    rootDir === null ? undefined : s.byProject[rootDir]
  )
  return resolvePreviewProfileId(override, activeProfileId)
}
