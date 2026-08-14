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

export const EDITOR_SETTINGS_DEFAULTS: EditorSettings = {
  contentWidthCh: 68,
  fontSizePx: 16,
  fontFamily: 'serif',
  lineHeight: 1.7,
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
      version: 1,
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
