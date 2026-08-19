import { create } from 'zustand'
import {
  SETTINGS_DEFAULTS,
  SETTING_KEYS,
  SunaProjectManifestSchema,
  mergeProjectSettings,
  projectSettingPatch,
  resolveSettings,
  type LitCliPreference,
  type ProjectSettings,
  type ResolvedSettingKey,
  type ResolvedSettings,
  type ReviewAiDiffs,
  type SettingSource,
  type SettingsResolution,
  type SunaProjectManifest
} from '@suna/core'
import { mirrorAutosave } from './autosave'
import { useProjectStore } from './project'

/**
 * App-wide settings, persisted by the MAIN process (userData) via the frozen
 * settings:get / settings:set IPC contract. The record is an open bag of
 * namespaced keys — unknown keys written by other zones are preserved because
 * `update` sends single-key patches only.
 *
 * Cross-zone contract (for the editor zone — coordinate via the settings IPC,
 * not by importing this module):
 *   'editor.defaultMode'  'reading' | 'source'  initial view mode for newly
 *                         opened markdown tabs; READING is the default.
 *   'editor.vimMotions'   boolean               vim keymap in the source view.
 *   'editor.theme'        'suna-dark' | 'suna-light' | 'gruvbox' |
 *                         'jellybeans'
 *                         default app theme (editor surface + chrome).
 *   'editor.autosave'     boolean               save a dirty buffer (and the
 *                         figure canvas) after a pause in editing. ON by
 *                         default; `autosaveEnabled()` below is the consumer's
 *                         entry point.
 * The editor zone should read these once on startup via
 * `window.suna.invoke('settings:get', {})` and seed its own store's defaults.
 *
 * The main process consumes:
 *   'terminal.shell'      string  shell override for new ptys ('' = default).
 *   'lit.mailto'          string  polite-pool contact for Crossref/OpenAlex
 *                                 lit:search and lit:by-doi requests; falls
 *                                 back to 'user.email' when empty ('' = none).
 *   'lit.cli'              LitCliPreference  which agent CLI 'lit:ai-search'
 *                                 should prefer ('auto' tries claude, then
 *                                 codex).
 *   'references.autoOpenPdf' boolean         References view (feature-plan-4
 *                                 §4): auto-open a resolved PDF beside the
 *                                 list on selecting an entry. Default on.
 *
 * ---------------------------------------------------------------------------
 * TWO-LEVEL HIERARCHY (feature-plan-5 §4) — what other zones should use.
 *
 * `settings` above stays the GLOBAL-only view (the Settings page's own
 * controls). Anything a project may override goes through the resolver
 * instead, keyed by the dot-path the value has inside suna.json's `settings`
 * block (see @suna/core's SETTING_KEYS / SETTINGS_DEFAULTS):
 *
 *   const { value, source } = useResolved('editor.contentWidthCh')
 *   //  source: 'project' | 'global' | 'default'  → "from project" / "from
 *   //  global" / "default" in the UI
 *   getResolved('editor.fontSizePx')          // same, outside React
 *   store.setGlobal('editor.fontSizePx', 16)  // → settings:set
 *   store.setProject('editor.fontSizePx', 16) // → project:update-settings
 *   store.clearProject('editor.fontSizePx')   // "Reset to global"
 *
 * The resolution re-runs whenever global settings change, whenever the project
 * store's manifest changes, and whenever a file is saved (which is how a
 * hand-edit of suna.json in the editor re-resolves without a restart).
 */
export type EditorModeSetting = 'reading' | 'source'
export type EditorThemeSetting = 'suna-dark' | 'suna-light' | 'gruvbox' | 'jellybeans'

export interface GlobalSettings {
  'editor.defaultMode': EditorModeSetting
  'editor.vimMotions': boolean
  'editor.theme': EditorThemeSetting
  /** Save after a pause in editing instead of waiting for ⌘S. Default ON. */
  'editor.autosave': boolean
  /** Whole-window zoom factor (0.9 … 1.25). */
  'appearance.uiScale': number
  /** Shell override for new terminals; '' means the platform default. */
  'terminal.shell': string
  /** Polite-pool contact for Crossref/OpenAlex; '' falls back to 'user.email'. */
  'lit.mailto': string
  /** Which agent CLI the 'ai-cli' literature provider prefers. */
  'lit.cli': LitCliPreference
  /** Auto-open a resolved reference PDF beside the References list. */
  'references.autoOpenPdf': boolean
  /** Show the AI's unreviewed changes inline in the editor (feature-plan-11). */
  'review.aiDiffs': ReviewAiDiffs
}

export const GLOBAL_SETTINGS_DEFAULTS: GlobalSettings = {
  'editor.defaultMode': 'reading',
  'editor.vimMotions': false,
  'editor.theme': 'suna-dark',
  'editor.autosave': true,
  'appearance.uiScale': 1,
  'terminal.shell': '',
  'lit.mailto': '',
  'lit.cli': 'auto',
  'references.autoOpenPdf': true,
  'review.aiDiffs': 'inline'
}

export const UI_SCALE_CHOICES = [0.9, 1, 1.1, 1.25] as const

const EDITOR_THEMES: readonly EditorThemeSetting[] = [
  'suna-dark',
  'suna-light',
  'gruvbox',
  'jellybeans'
]

/** Coerce the untyped persisted record into a fully-populated settings object. */
export function coerceSettings(raw: Record<string, unknown>): GlobalSettings {
  const out: GlobalSettings = { ...GLOBAL_SETTINGS_DEFAULTS }
  const mode = raw['editor.defaultMode']
  if (mode === 'reading' || mode === 'source') out['editor.defaultMode'] = mode
  const theme = raw['editor.theme']
  if (EDITOR_THEMES.includes(theme as EditorThemeSetting)) {
    out['editor.theme'] = theme as EditorThemeSetting
  }
  if (typeof raw['editor.vimMotions'] === 'boolean') {
    out['editor.vimMotions'] = raw['editor.vimMotions']
  }
  if (typeof raw['editor.autosave'] === 'boolean') {
    out['editor.autosave'] = raw['editor.autosave']
  }
  const aiDiffs = raw['review.aiDiffs']
  if (aiDiffs === 'inline' || aiDiffs === 'off') out['review.aiDiffs'] = aiDiffs
  const scale = raw['appearance.uiScale']
  if (typeof scale === 'number' && scale >= 0.75 && scale <= 1.5) {
    out['appearance.uiScale'] = scale
  }
  if (typeof raw['terminal.shell'] === 'string') {
    out['terminal.shell'] = raw['terminal.shell']
  }
  if (typeof raw['lit.mailto'] === 'string') {
    out['lit.mailto'] = raw['lit.mailto']
  }
  const cliPreference = raw['lit.cli']
  if (cliPreference === 'auto' || cliPreference === 'claude' || cliPreference === 'codex') {
    out['lit.cli'] = cliPreference
  }
  if (typeof raw['references.autoOpenPdf'] === 'boolean') {
    out['references.autoOpenPdf'] = raw['references.autoOpenPdf']
  }
  return out
}

function applyUiScale(scale: number): void {
  // Chromium's non-standard `zoom` scales the whole window uniformly.
  document.documentElement.style.setProperty('zoom', String(scale))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Parse a suna.json payload down to its settings block. Split out from the
 * store so the failure wording is unit-testable: a project whose manifest went
 * invalid keeps its last good settings and says so, rather than silently
 * reverting every project override to the global value.
 */
export function parseProjectSettings(content: string): {
  settings: ProjectSettings | null
  error: string | null
  /** The whole manifest, so a caller can re-seed the project store from the same read. */
  manifest: SunaProjectManifest | null
} {
  let json: unknown
  try {
    json = JSON.parse(content) as unknown
  } catch (error) {
    return {
      settings: null,
      error: `suna.json is not valid JSON: ${errorMessage(error)}`,
      manifest: null
    }
  }
  const parsed = SunaProjectManifestSchema.safeParse(json)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : ''
    return {
      settings: null,
      error: `suna.json is invalid${where}: ${first?.message ?? 'unknown error'}`,
      manifest: null
    }
  }
  return { settings: parsed.data.settings ?? null, error: null, manifest: parsed.data }
}

interface SettingsState {
  settings: GlobalSettings
  /**
   * Everything persisted globally, untyped — the resolver reads keys that the
   * GlobalSettings view does not model (e.g. 'editor.contentWidthCh').
   */
  raw: Record<string, unknown>
  /** The open project's `settings` block from suna.json; null when unset. */
  projectSettings: ProjectSettings | null
  /** project ?? global ?? default, with the winning level per key. */
  resolved: SettingsResolution
  loaded: boolean
  error: string | null
  /** Non-fatal: suna.json could not be read/parsed, so project overrides are stale. */
  projectError: string | null
  /** Fetch once from the main process; safe to call from several mounts. */
  load: () => Promise<void>
  /** Optimistic single-key write of a GLOBAL settings key; rolls back on failure. */
  update: <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) => Promise<void>
  /** Write a resolved key at the GLOBAL level (settings:set). */
  setGlobal: <K extends ResolvedSettingKey>(
    key: K,
    value: ResolvedSettings[K]
  ) => Promise<void>
  /** Write a resolved key at the PROJECT level (project:update-settings). */
  setProject: <K extends ResolvedSettingKey>(
    key: K,
    value: ResolvedSettings[K]
  ) => Promise<void>
  /** "Reset to global": removes the key from suna.json so it falls back. */
  clearProject: (key: ResolvedSettingKey) => Promise<void>
  /** Adopt a manifest's settings block (called on project store changes). */
  syncProjectSettings: (next: ProjectSettings | null | undefined) => void
  /** Re-read suna.json from disk and re-resolve (external edits). */
  refreshProjectSettings: () => Promise<void>
}

/**
 * In-flight load, so concurrent callers share one read instead of racing.
 * It is NOT a "loaded once" latch: settings.json can change under us (the
 * Settings page, another window, an agent, a reset) and every later call must
 * actually re-read the file.
 */
let loadInFlight: Promise<void> | null = null

function resolveFrom(
  raw: Record<string, unknown>,
  project: ProjectSettings | null
): SettingsResolution {
  return resolveSettings(raw, project ?? undefined)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: GLOBAL_SETTINGS_DEFAULTS,
  raw: {},
  projectSettings: null,
  resolved: resolveSettings({}, undefined),
  loaded: false,
  error: null,
  projectError: null,

  load: async () => {
    if (loadInFlight !== null) return loadInFlight
    loadInFlight = (async () => {
      try {
        const { settings } = await window.suna.invoke('settings:get', {})
        const coerced = coerceSettings(settings)
        applyUiScale(coerced['appearance.uiScale'])
        // Seed the project half from whatever project is already open.
        const projectSettings = useProjectStore.getState().manifest?.settings ?? null
        set({
          settings: coerced,
          raw: settings,
          projectSettings,
          resolved: resolveFrom(settings, projectSettings),
          loaded: true,
          error: null
        })
      } catch (error) {
        // Defaults still apply; a later call retries (e.g. from the Settings tab).
        set({ loaded: true, error: errorMessage(error) })
      } finally {
        loadInFlight = null
      }
    })()
    return loadInFlight
  },

  update: async (key, value) => {
    const prev = get().settings
    const prevRaw = get().raw
    const next = { ...prev, [key]: value }
    const nextRaw = { ...prevRaw, [key]: value }
    set({
      settings: next,
      raw: nextRaw,
      resolved: resolveFrom(nextRaw, get().projectSettings),
      error: null
    })
    if (key === 'appearance.uiScale') applyUiScale(next['appearance.uiScale'])
    try {
      await window.suna.invoke('settings:set', { patch: { [key]: value } })
    } catch (error) {
      set({
        settings: prev,
        raw: prevRaw,
        resolved: resolveFrom(prevRaw, get().projectSettings),
        error: errorMessage(error)
      })
      if (key === 'appearance.uiScale') applyUiScale(prev['appearance.uiScale'])
    }
  },

  setGlobal: async (key, value) => {
    const globalKey = SETTING_KEYS[key].globalKeys[0]
    const prevRaw = get().raw
    const nextRaw = { ...prevRaw, [globalKey]: value }
    set({
      raw: nextRaw,
      settings: coerceSettings(nextRaw),
      resolved: resolveFrom(nextRaw, get().projectSettings),
      error: null
    })
    try {
      await window.suna.invoke('settings:set', { patch: { [globalKey]: value } })
    } catch (error) {
      set({
        raw: prevRaw,
        settings: coerceSettings(prevRaw),
        resolved: resolveFrom(prevRaw, get().projectSettings),
        error: errorMessage(error)
      })
    }
  },

  setProject: async (key, value) => {
    await writeProjectSetting(set, get, key, value)
  },

  clearProject: async (key) => {
    await writeProjectSetting(set, get, key, null)
  },

  syncProjectSettings: (next) => {
    const projectSettings = next ?? null
    set({ projectSettings, resolved: resolveFrom(get().raw, projectSettings) })
  },

  refreshProjectSettings: async () => {
    const rootDir = useProjectStore.getState().rootDir
    if (rootDir === null) {
      set({ projectSettings: null, projectError: null, resolved: resolveFrom(get().raw, null) })
      return
    }
    if (typeof window === 'undefined' || typeof window.suna === 'undefined') return
    try {
      const { content } = await window.suna.invoke('fs:read-text', {
        path: `${rootDir}/suna.json`
      })
      // The read is async: a project switch mid-flight must not write the old
      // project's manifest over the new one.
      if (useProjectStore.getState().rootDir !== rootDir) return
      const { settings, error, manifest } = parseProjectSettings(content)
      if (error !== null) {
        // Keep the last good block: a half-typed file must not blank the UI.
        set({ projectError: error })
        return
      }
      set({
        projectSettings: settings,
        projectError: null,
        resolved: resolveFrom(get().raw, settings)
      })
      // Keep the project store's copy of suna.json in step, exactly as
      // writeProjectSetting does. Without it the two diverge and `load()` —
      // which every editor mount calls, and which re-seeds the project half
      // from that manifest — silently reverts an out-of-band edit: hand-edit
      // suna.json, ⌘S, open any file, and the override is gone again.
      if (manifest !== null) useProjectStore.setState({ manifest })
    } catch (error) {
      set({ projectError: errorMessage(error) })
    }
  }
}))

type SettingsSet = (partial: Partial<SettingsState>) => void
type SettingsGet = () => SettingsState

/**
 * Optimistic project-level write: merge locally, send the nested patch, adopt
 * whatever main says the file now holds, roll back if the write failed.
 */
async function writeProjectSetting<K extends ResolvedSettingKey>(
  set: SettingsSet,
  get: SettingsGet,
  key: K,
  value: ResolvedSettings[K] | null
): Promise<void> {
  const rootDir = useProjectStore.getState().rootDir
  if (rootDir === null) {
    set({ projectError: 'No project is open, so it has no project settings.' })
    return
  }
  const patch = projectSettingPatch(key, value)
  const prev = get().projectSettings
  const optimistic = mergeProjectSettings(prev ?? {}, patch) ?? null
  set({
    projectSettings: optimistic,
    projectError: null,
    resolved: resolveFrom(get().raw, optimistic)
  })
  try {
    const { manifest } = await window.suna.invoke('project:update-settings', {
      dir: rootDir,
      patch
    })
    const settings = manifest.settings ?? null
    set({ projectSettings: settings, resolved: resolveFrom(get().raw, settings) })
    // suna.json just changed on disk, so the project store's copy is stale.
    // load() re-seeds the project half from that manifest — without this the
    // next load (every EditorTab mount calls one) silently reverts the
    // override that was just written.
    const fresh = SunaProjectManifestSchema.safeParse(manifest)
    if (fresh.success) useProjectStore.setState({ manifest: fresh.data })
  } catch (error) {
    set({
      projectSettings: prev,
      projectError: errorMessage(error),
      resolved: resolveFrom(get().raw, prev)
    })
  }
}

/**
 * The resolved value of one key and where it came from — the unit every
 * settings control renders ("from project" / "from global" / "default").
 * Two primitive selectors, so the hook never hands React a fresh snapshot.
 */
export function useResolved<K extends ResolvedSettingKey>(
  key: K
): { value: ResolvedSettings[K]; source: SettingSource } {
  const value = useSettingsStore((s) => s.resolved.value[key])
  const source = useSettingsStore((s) => s.resolved.sources[key])
  return { value, source }
}

/** Imperative read for non-React code (CodeMirror extensions, command handlers). */
export function getResolved<K extends ResolvedSettingKey>(
  key: K
): { value: ResolvedSettings[K]; source: SettingSource } {
  const { resolved } = useSettingsStore.getState()
  return { value: resolved.value[key], source: resolved.sources[key] }
}

/**
 * External-edit reactivity (feature-plan-5 §4, "watch suna.json"). Two
 * independent triggers, because a hand-edit can arrive by two very different
 * routes:
 *
 *  - IN-APP: the project store knows a project changed or a file was saved. A
 *    manifest swap re-resolves immediately; a rootDir change or a saveBump
 *    (raised by the editor after every successful write, including a ⌘S on
 *    suna.json itself) re-reads the file from disk.
 *  - OUT-OF-BAND: an agent, the integrated terminal, or another editor writes
 *    suna.json with the app none the wiser — nothing bumps. The MAIN process
 *    watches the project directory and pushes
 *    EVENT_CHANNELS.projectManifestChanged; that is what the second
 *    subscription below is for (main/services/projectWatch.ts).
 */
let watching = false

export function watchProjectSettings(): () => void {
  if (watching) return () => undefined
  watching = true
  const unsubscribeStore = useProjectStore.subscribe((state, prev) => {
    if (state.manifest !== prev.manifest) {
      useSettingsStore.getState().syncProjectSettings(state.manifest?.settings)
    }
    if (state.rootDir !== prev.rootDir || state.saveBump !== prev.saveBump) {
      void useSettingsStore.getState().refreshProjectSettings()
    }
  })
  // Guarded: unit tests import this module without a preload bridge.
  const unsubscribePush =
    typeof window !== 'undefined' && typeof window.suna?.onProjectManifestChanged === 'function'
      ? window.suna.onProjectManifestChanged(({ dir }) => {
          // Ignore a push for a project that is no longer the open one.
          if (useProjectStore.getState().rootDir !== dir) return
          void useSettingsStore.getState().refreshProjectSettings()
        })
      : () => undefined
  return () => {
    unsubscribeStore()
    unsubscribePush()
    watching = false
  }
}

watchProjectSettings()

/**
 * Push 'editor.autosave' down to state/autosave.ts, which the editing
 * surfaces read. They cannot import this module — see the note there — so
 * this subscription is the one-way channel. Fired once now for the shipped
 * default, then on every change.
 */
mirrorAutosave(useSettingsStore.getState().settings['editor.autosave'])
useSettingsStore.subscribe((state, prev) => {
  if (state.settings['editor.autosave'] !== prev.settings['editor.autosave']) {
    mirrorAutosave(state.settings['editor.autosave'])
  }
})

export { SETTINGS_DEFAULTS }
