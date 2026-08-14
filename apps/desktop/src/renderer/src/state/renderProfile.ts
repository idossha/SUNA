import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BUNDLED_PROFILE_IDS, type BundledProfileId } from '@suna/formatter'
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

export const FALLBACK_PROFILE_ID: BundledProfileId = 'nature-astronomy'

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
