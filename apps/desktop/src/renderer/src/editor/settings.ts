import type { CSSProperties } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type EditorFontFamily = 'serif' | 'sans' | 'mono'
export type EditorThemeName = 'suna-dark' | 'suna-light' | 'high-contrast'

/**
 * Two surfaces on one editable CodeMirror instance: 'source' is plain
 * markdown, 'reading' adds live-preview decorations. Defined here (not in
 * EditorTab) so the settings store can hold the app-global default mode
 * without a component import cycle.
 */
export type EditorViewMode = 'source' | 'reading'

export interface EditorSettings {
  /** Reading-mode content column width, in ch. */
  contentWidthCh: number
  /** Base editor font size, in px (applies to both modes). */
  fontSizePx: number
  /** Body font for reading mode (source stays mono). */
  fontFamily: EditorFontFamily
  /** Line height for both modes. */
  lineHeight: number
  /** Editor-surface theme; app chrome stays dark regardless. */
  editorTheme: EditorThemeName
}

export const EDITOR_SETTINGS_LIMITS = {
  contentWidthCh: { min: 50, max: 150 },
  fontSizePx: { min: 12, max: 22 },
  lineHeight: { min: 1.4, max: 2 }
} as const

/**
 * Must match @suna/core's SETTINGS_DEFAULTS (feature-plan-5 §2: 14px / 1.6).
 * This store is what the editor surface renders from, so a mismatch here is
 * what the user actually sees — the resolver's defaults would never show.
 * Persisted user values are unaffected: only the fallback changes.
 */
export const EDITOR_SETTINGS_DEFAULTS: EditorSettings = {
  contentWidthCh: 140,
  fontSizePx: 14,
  fontFamily: 'serif',
  lineHeight: 1.6,
  editorTheme: 'suna-dark'
}

/** Token stacks from tokens.css, keyed by the fontFamily setting. */
export const FONT_FAMILY_STACKS: Record<EditorFontFamily, string> = {
  serif: 'var(--s-font-serif)',
  sans: 'var(--s-font-ui)',
  mono: 'var(--s-font-mono)'
}

export const EDITOR_THEME_LABELS: Record<EditorThemeName, string> = {
  'suna-dark': 'SUNA Dark',
  'suna-light': 'SUNA Light',
  'high-contrast': 'High Contrast'
}

/**
 * The `--ed-*` custom properties the editor surface reads. Set on the tab
 * container; `editor.css` and `themes.ts` consume them from there.
 *
 * `--ed-content-width` lands on `.cm-content` (see editor.css) so its `ch`
 * unit resolves against the *editor's own* font — mono in source, the body
 * font in reading — which is what makes the slider mean characters-per-line.
 */
export function editorSurfaceStyle(settings: EditorSettings): CSSProperties {
  return {
    '--ed-content-width': `${settings.contentWidthCh}ch`,
    '--ed-font-size': `${settings.fontSizePx}px`,
    '--ed-line-height': String(settings.lineHeight),
    '--ed-body-font': FONT_FAMILY_STACKS[settings.fontFamily]
  } as CSSProperties
}

type NumericSettingKey = 'contentWidthCh' | 'fontSizePx' | 'lineHeight'

export function clampSetting(key: NumericSettingKey, value: number): number {
  if (Number.isNaN(value)) return EDITOR_SETTINGS_DEFAULTS[key]
  const { min, max } = EDITOR_SETTINGS_LIMITS[key]
  return Math.min(max, Math.max(min, value))
}

interface EditorSettingsState extends EditorSettings {
  setContentWidthCh: (value: number) => void
  setFontSizePx: (value: number) => void
  setLineHeight: (value: number) => void
  setFontFamily: (value: EditorFontFamily) => void
  setEditorTheme: (value: EditorThemeName) => void
  reset: () => void
}

export const useEditorSettings = create<EditorSettingsState>()(
  persist(
    (set) => ({
      ...EDITOR_SETTINGS_DEFAULTS,
      setContentWidthCh: (value) =>
        set({ contentWidthCh: clampSetting('contentWidthCh', value) }),
      setFontSizePx: (value) => set({ fontSizePx: clampSetting('fontSizePx', value) }),
      setLineHeight: (value) => set({ lineHeight: clampSetting('lineHeight', value) }),
      setFontFamily: (value) => set({ fontFamily: value }),
      setEditorTheme: (value) => set({ editorTheme: value }),
      reset: () => set({ ...EDITOR_SETTINGS_DEFAULTS })
    }),
    {
      name: 'suna-editor-settings',
      version: 2,
      // v1 -> v2: the default measure moved 68ch -> 140ch. Installs that never
      // touched the slider have 68 persisted verbatim and would otherwise be
      // pinned to the old default forever; adopt the new one for them only.
      // A deliberate 68 is indistinguishable from the old default, so it is
      // (knowingly) reset too — every other stored width is left alone.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<EditorSettings>
        if (version < 2 && Number(state.contentWidthCh) === 68) {
          return { ...state, contentWidthCh: EDITOR_SETTINGS_DEFAULTS.contentWidthCh }
        }
        return state
      },
      // Clamp persisted numeric values on rehydrate so stored settings from
      // older builds (or hand-edited storage) always land inside the limits.
      merge: (persisted, current) => {
        const merged = { ...current, ...((persisted ?? {}) as Partial<EditorSettings>) }
        return {
          ...merged,
          contentWidthCh: clampSetting('contentWidthCh', Number(merged.contentWidthCh)),
          fontSizePx: clampSetting('fontSizePx', Number(merged.fontSizePx)),
          lineHeight: clampSetting('lineHeight', Number(merged.lineHeight))
        }
      },
      partialize: (state) => ({
        contentWidthCh: state.contentWidthCh,
        fontSizePx: state.fontSizePx,
        fontFamily: state.fontFamily,
        lineHeight: state.lineHeight,
        editorTheme: state.editorTheme
      })
    }
  )
)
