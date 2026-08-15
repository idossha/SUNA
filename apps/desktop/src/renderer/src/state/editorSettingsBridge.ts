import type { ResolvedSettings } from '@suna/core'
import { clampSetting, useEditorSettings, type EditorSettings } from '../editor/settings'
import { useSettingsStore } from './settings'

/**
 * Makes the two-level settings hierarchy (feature-plan-5 §4) actually reach
 * the editor surface.
 *
 * Five of the resolved keys name an editor-surface setting that a *third*
 * store already owns: `editor/settings.ts`, the localStorage-persisted store
 * the gear popover writes and `editorSurfaceStyle` renders from. Without this
 * bridge the Settings page writes suna.json and userData quite correctly and
 * the editor keeps rendering its own persisted numbers — measured before this
 * existed: resolved 111 ch / 19 px, editor still 68 ch / 14 px.
 *
 * The rule is "apply CHANGES in the resolution", not "apply the resolution":
 *
 *  - At startup the first resolution is adopted as a baseline and applied to
 *    nothing. That is what keeps feature-plan-5 §2's promise that "existing
 *    users' persisted values are untouched" — a fresh app whose global and
 *    project settings are both unset must not stamp the default 14 px over a
 *    gear tweak of 20 px sitting in localStorage.
 *  - Every later change — a global write, a project write, opening or closing
 *    a project, a "Reset to global" that falls back to the default — patches
 *    exactly the keys whose resolved value moved. So a Reset really does pull
 *    the editor back to the fallback value instead of stranding it on the
 *    override.
 *
 * The gear popover therefore stays authoritative until the next settings
 * change arrives, which is also what makes the pre-existing smoke steps that
 * set widths through the gear and then measure them keep passing.
 */

/** Resolved key → the editor-settings field it drives. */
export const MIRRORED_EDITOR_KEYS = {
  'editor.contentWidthCh': 'contentWidthCh',
  'editor.fontSizePx': 'fontSizePx',
  'editor.lineHeight': 'lineHeight',
  'editor.fontFamily': 'fontFamily',
  'editor.editorTheme': 'editorTheme'
} as const satisfies Partial<Record<keyof ResolvedSettings, keyof EditorSettings>>

type MirroredKey = keyof typeof MIRRORED_EDITOR_KEYS

const NUMERIC_FIELDS = new Set<keyof EditorSettings>([
  'contentWidthCh',
  'fontSizePx',
  'lineHeight'
])

/**
 * The editor-settings patch implied by a resolution change. `previous === null`
 * means "this is the baseline" and yields an empty patch. Numeric values are
 * clamped through the editor store's own limits, so the two limit tables
 * drifting apart can never push an out-of-range value onto the surface.
 */
export function editorPatchFor(
  previous: ResolvedSettings | null,
  next: ResolvedSettings
): Partial<EditorSettings> {
  const patch: Partial<EditorSettings> = {}
  if (previous === null) return patch
  for (const [resolvedKey, field] of Object.entries(MIRRORED_EDITOR_KEYS) as [
    MirroredKey,
    keyof EditorSettings
  ][]) {
    const before = previous[resolvedKey]
    const after = next[resolvedKey]
    if (before === after) continue
    if (typeof after === 'number' && NUMERIC_FIELDS.has(field)) {
      Object.assign(patch, { [field]: clampSetting(field as 'fontSizePx', after) })
    } else {
      Object.assign(patch, { [field]: after })
    }
  }
  return patch
}

let bridged = false

/** Subscribe the editor-settings store to resolution changes. Idempotent. */
export function bridgeResolvedEditorSettings(): () => void {
  if (bridged) return () => undefined
  bridged = true
  let previous: ResolvedSettings | null = null
  const unsubscribe = useSettingsStore.subscribe((state) => {
    const next = state.resolved.value
    if (next === previous) return
    const patch = editorPatchFor(previous, next)
    previous = next
    if (Object.keys(patch).length > 0) useEditorSettings.setState(patch)
  })
  // Adopt whatever is resolved right now as the baseline, so the very first
  // real change is measured against it rather than against `null`.
  previous = useSettingsStore.getState().resolved.value
  return () => {
    unsubscribe()
    bridged = false
  }
}

bridgeResolvedEditorSettings()
