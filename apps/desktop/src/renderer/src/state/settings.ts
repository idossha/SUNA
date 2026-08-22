import { create } from 'zustand'
import {
  SETTINGS_DEFAULTS,
  SETTING_KEYS,
  resolveSettings,
  type LoadedConfigPayload,
  type ResolvedSettingKey,
  type ResolvedSettings,
  type SettingSource
} from '@suna/core'
import { mirrorAutosave } from './autosave'

/**
 * The app's configuration, as the renderer sees it.
 *
 * ONE source: `~/.suna/config.yml`, owned by the main process (see
 * main/services/userconfig.ts). This store holds the resolved values, where
 * each came from, the theme stylesheet, and anything wrong with the file. It
 * never persists anything of its own — a second store of the same values is
 * exactly what makes an rc file feel like a lie.
 *
 * Reading a value:
 *   const { value, source } = useResolved('editor.lineHeight')
 *   //  source: 'config' | 'default' → "from your config" / "default"
 *   getResolved('editor.fontSizePx')            // outside React
 *
 * Writing one — both go straight into the user's config.yml, comments intact:
 *   useSettingsStore.getState().set('editor.fontSizePx', 16)
 *   useSettingsStore.getState().reset('editor.fontSizePx')   // delete the key
 *
 * The file is watched by main, so a hand-edit in any editor arrives here as a
 * push (EVENT_CHANNELS.configChanged) and repaints without a reload.
 */

export type ThemeSummary = LoadedConfigPayload['themes'][number]
export type ConfigDiagnostic = LoadedConfigPayload['diagnostics'][number]

const DEFAULT_SOURCES = Object.fromEntries(
  Object.keys(SETTING_KEYS).map((key) => [key, 'default'])
) as Record<ResolvedSettingKey, SettingSource>

interface SettingsState {
  /** Resolved value of every setting. */
  settings: ResolvedSettings
  /** Per key: did the config file set it, or is this the shipped default? */
  sources: Record<ResolvedSettingKey, SettingSource>
  /** Every theme the app knows, built-in and the user's own. */
  themes: ThemeSummary[]
  /** Absolute path of config.yml — the "open my config" target. */
  path: string
  /** Revision of the config currently held; see `adopt`. */
  revision: number
  /** Whatever is wrong with the config file or a theme file. */
  diagnostics: ConfigDiagnostic[]
  loaded: boolean
  /** Non-null when the config could not be read or written. */
  error: string | null
  load: () => Promise<void>
  /** Write one setting into config.yml. Optimistic; rolls back on failure. */
  set: <K extends ResolvedSettingKey>(key: K, value: ResolvedSettings[K]) => Promise<void>
  /** Remove the key from config.yml, so it falls back to the shipped default. */
  reset: (key: ResolvedSettingKey) => Promise<void>
  /** Adopt a config pushed by main (an external edit). */
  adopt: (config: LoadedConfigPayload) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * In-flight load, so concurrent mounts share one read. NOT a "loaded once"
 * latch: config.yml changes under us and every later call must really re-read.
 */
let loadInFlight: Promise<void> | null = null

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: SETTINGS_DEFAULTS,
  sources: DEFAULT_SOURCES,
  themes: [],
  path: '',
  revision: 0,
  diagnostics: [],
  loaded: false,
  error: null,

  load: async () => {
    if (loadInFlight !== null) return loadInFlight
    loadInFlight = (async () => {
      try {
        const { config } = await window.suna.invoke('config:get', {})
        get().adopt(config)
        set({ loaded: true, error: null })
      } catch (error) {
        // Defaults still apply; a later call retries (e.g. from Settings).
        set({ loaded: true, error: errorMessage(error) })
      } finally {
        loadInFlight = null
      }
    })()
    return loadInFlight
  },

  set: async (key, value) => {
    const previous = { settings: get().settings, sources: get().sources }
    // Optimistic, so a slider tracks the pointer rather than the disk.
    set({
      settings: { ...previous.settings, [key]: value },
      sources: { ...previous.sources, [key]: 'config' },
      error: null
    })
    applyChrome({ ...previous.settings, [key]: value })
    try {
      const { config, error } = await window.suna.invoke('config:set', { key, value })
      get().adopt(config)
      if (error !== null) set({ error })
    } catch (error) {
      set({ ...previous, error: errorMessage(error) })
      applyChrome(previous.settings)
    }
  },

  reset: async (key) => {
    const previous = { settings: get().settings, sources: get().sources }
    const fallback = SETTINGS_DEFAULTS[key]
    set({
      settings: { ...previous.settings, [key]: fallback },
      sources: { ...previous.sources, [key]: 'default' },
      error: null
    })
    try {
      const { config, error } = await window.suna.invoke('config:set', { key, value: null })
      get().adopt(config)
      if (error !== null) set({ error })
    } catch (error) {
      set({ ...previous, error: errorMessage(error) })
    }
  },

  adopt: (config) => {
    // Ignore anything older than what we already hold: a `config:set` reply
    // can arrive after a file-watch push that already superseded it, and
    // adopting it would roll the UI back over someone's hand edit.
    if (config.revision <= get().revision) return
    // The wire shape is an open record (see LoadedConfigSchema); re-resolving
    // is not needed because main already did it, but a config whose settings
    // block somehow arrived empty must still produce a full surface.
    const settings = {
      ...resolveSettings({}).value,
      ...(config.settings as Partial<ResolvedSettings>)
    } as ResolvedSettings
    set({
      settings,
      sources: config.sources as Record<ResolvedSettingKey, SettingSource>,
      themes: config.themes,
      path: config.path,
      revision: config.revision,
      diagnostics: config.diagnostics
    })
    applyThemeCss(config.themesCss)
    applyChrome(settings)
  }
}))

/* ------------------------------------------------------------------ */
/* Putting the config on the page                                       */
/* ------------------------------------------------------------------ */

const THEME_STYLE_ID = 'suna-themes'

/**
 * Every theme's palette, as one stylesheet in <head>.
 *
 * Built-ins and user themes arrive by exactly the same route — main resolves
 * both from the same registry and emits one sheet — which is what makes a
 * `~/.suna/themes/nord.yml` indistinguishable from a shipped theme at
 * runtime. `tokens.css` therefore carries no colours at all; it carries the
 * metrics and font stacks the themes deliberately do not own.
 */
export function applyThemeCss(css: string): void {
  if (typeof document === 'undefined') return
  let style = document.getElementById(THEME_STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = THEME_STYLE_ID
    // Prepended, not appended: theme declarations set custom properties that
    // component stylesheets read, and a later sheet must be able to override
    // one deliberately (the export preview's forced-light block does).
    document.head.prepend(style)
  }
  if (style.textContent !== css) style.textContent = css
}

/**
 * The `ui:` block as CSS custom properties for :root, plus the window zoom.
 *
 * These are inline properties rather than part of a theme because they are
 * LAYOUT, shared by every theme: switching from gruvbox to suna-light must not
 * silently move the status bar. A `null` value means "remove the override", so
 * tokens.css's shipped value applies again — which is what an empty font stack
 * in the config means.
 *
 * Pure, so the mapping is testable without a DOM (apps/desktop has none).
 * The type ramp's base sizes are tokens.css's, restated here because scaling
 * them is arithmetic and CSS cannot multiply a length by a unitless token.
 */
export function chromeVars(settings: ResolvedSettings): Record<string, string | null> {
  const scale = settings['ui.textScale']
  const size = (px: number): string => `${Math.round(px * scale * 10) / 10}px`
  const stack = (value: string): string | null => (value.trim() === '' ? null : value)
  return {
    // Chromium's non-standard `zoom` scales the whole window uniformly.
    zoom: String(settings['ui.scale']),
    '--s-titlebar-h': `${settings['ui.titleBarHeightPx']}px`,
    '--s-activitybar-w': `${settings['ui.activityBarWidthPx']}px`,
    '--s-statusbar-h': `${settings['ui.statusBarHeightPx']}px`,
    '--s-radius': `${settings['ui.radiusPx']}px`,
    '--s-text-xs': size(11),
    '--s-text-sm': size(12),
    '--s-text-md': size(13),
    '--s-text-lg': size(15),
    '--s-font-ui': stack(settings['ui.fontUi']),
    '--s-font-serif': stack(settings['ui.fontSerif']),
    '--s-font-mono': stack(settings['ui.fontMono'])
  }
}

/** Put `chromeVars` on :root. */
export function applyChrome(settings: ResolvedSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [name, value] of Object.entries(chromeVars(settings))) {
    if (value === null) root.style.removeProperty(name)
    else root.style.setProperty(name, value)
  }
}

/* ------------------------------------------------------------------ */
/* Reading a setting                                                    */
/* ------------------------------------------------------------------ */

/**
 * The resolved value of one key and where it came from — the unit every
 * settings control renders. Two primitive selectors, so the hook never hands
 * React a fresh object snapshot.
 */
export function useResolved<K extends ResolvedSettingKey>(
  key: K
): { value: ResolvedSettings[K]; source: SettingSource } {
  const value = useSettingsStore((s) => s.settings[key])
  const source = useSettingsStore((s) => s.sources[key])
  return { value, source }
}

/** Imperative read for non-React code (CodeMirror extensions, commands). */
export function getResolved<K extends ResolvedSettingKey>(
  key: K
): { value: ResolvedSettings[K]; source: SettingSource } {
  const { settings, sources } = useSettingsStore.getState()
  return { value: settings[key], source: sources[key] }
}

/* ------------------------------------------------------------------ */
/* External edits                                                       */
/* ------------------------------------------------------------------ */

let watching = false

/**
 * Adopt config changes pushed by the main process — the user editing
 * config.yml in SUNA, in vim, or dropping a theme into ~/.suna/themes/.
 * The push carries the whole reloaded config, so there is no round trip.
 */
export function watchUserConfig(): () => void {
  if (watching) return () => undefined
  watching = true
  // Guarded: unit tests import this module without a preload bridge.
  const unsubscribe =
    typeof window !== 'undefined' && typeof window.suna?.onConfigChanged === 'function'
      ? window.suna.onConfigChanged((config) => {
          useSettingsStore.getState().adopt(config)
        })
      : () => undefined
  return () => {
    unsubscribe()
    watching = false
  }
}

watchUserConfig()

/**
 * Push `editor.autosave` down to state/autosave.ts, which the editing surfaces
 * read. They cannot import this module — see the note there — so this
 * subscription is the one-way channel. Fired once now for the shipped default,
 * then on every change.
 */
mirrorAutosave(useSettingsStore.getState().settings['editor.autosave'])
useSettingsStore.subscribe((state, prev) => {
  if (state.settings['editor.autosave'] !== prev.settings['editor.autosave']) {
    mirrorAutosave(state.settings['editor.autosave'])
  }
})

export { SETTINGS_DEFAULTS }
