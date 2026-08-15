import { create } from 'zustand'
import type { LitCliPreference } from '@suna/core'

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
 *   'editor.theme'        'suna-dark' | 'suna-light' | 'high-contrast'
 *                         default editor-surface theme.
 *   'editor.autosave'     boolean               reserved; no consumer yet.
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
 */
export type EditorModeSetting = 'reading' | 'source'
export type EditorThemeSetting = 'suna-dark' | 'suna-light' | 'high-contrast'

export interface GlobalSettings {
  'editor.defaultMode': EditorModeSetting
  'editor.vimMotions': boolean
  'editor.theme': EditorThemeSetting
  'editor.autosave': boolean
  /** Whole-window zoom factor (0.9 … 1.25). */
  'appearance.uiScale': number
  /** Shell override for new terminals; '' means the platform default. */
  'terminal.shell': string
  /** Polite-pool contact for Crossref/OpenAlex; '' falls back to 'user.email'. */
  'lit.mailto': string
  /** Which agent CLI the 'ai-cli' literature provider prefers. */
  'lit.cli': LitCliPreference
}

export const GLOBAL_SETTINGS_DEFAULTS: GlobalSettings = {
  'editor.defaultMode': 'reading',
  'editor.vimMotions': false,
  'editor.theme': 'suna-dark',
  'editor.autosave': false,
  'appearance.uiScale': 1,
  'terminal.shell': '',
  'lit.mailto': '',
  'lit.cli': 'auto'
}

export const UI_SCALE_CHOICES = [0.9, 1, 1.1, 1.25] as const

const EDITOR_THEMES: readonly EditorThemeSetting[] = [
  'suna-dark',
  'suna-light',
  'high-contrast'
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
  return out
}

function applyUiScale(scale: number): void {
  // Chromium's non-standard `zoom` scales the whole window uniformly.
  document.documentElement.style.setProperty('zoom', String(scale))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface SettingsState {
  settings: GlobalSettings
  loaded: boolean
  error: string | null
  /** Fetch once from the main process; safe to call from several mounts. */
  load: () => Promise<void>
  /** Optimistic single-key write; rolls back if the IPC write fails. */
  update: <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) => Promise<void>
}

let loadStarted = false

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: GLOBAL_SETTINGS_DEFAULTS,
  loaded: false,
  error: null,

  load: async () => {
    if (loadStarted) return
    loadStarted = true
    try {
      const { settings } = await window.suna.invoke('settings:get', {})
      const coerced = coerceSettings(settings)
      applyUiScale(coerced['appearance.uiScale'])
      set({ settings: coerced, loaded: true, error: null })
    } catch (error) {
      // Defaults still apply; allow a later retry (e.g. from the Settings tab).
      loadStarted = false
      set({ loaded: true, error: errorMessage(error) })
    }
  },

  update: async (key, value) => {
    const prev = get().settings
    const next = { ...prev, [key]: value }
    set({ settings: next, error: null })
    if (key === 'appearance.uiScale') applyUiScale(next['appearance.uiScale'])
    try {
      await window.suna.invoke('settings:set', { patch: { [key]: value } })
    } catch (error) {
      set({ settings: prev, error: errorMessage(error) })
      if (key === 'appearance.uiScale') applyUiScale(prev['appearance.uiScale'])
    }
  }
}))
