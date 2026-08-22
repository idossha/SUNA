import type { CSSProperties } from 'react'
import { create } from 'zustand'
import { useSettingsStore } from '../state/settings'

export type EditorFontFamily = 'serif' | 'sans' | 'mono'

/**
 * A theme id. A plain string, not a union over the built-ins: the user's own
 * `~/.suna/themes/nord.yml` names itself, and the compiler cannot know that
 * name. The loader is what decides whether an id resolves to a theme.
 */
export type EditorThemeName = string

/**
 * Two surfaces on one editable CodeMirror instance: 'source' is plain
 * markdown, 'reading' adds live-preview decorations. Defined here (not in
 * EditorTab) so the settings store can hold the app-global default mode
 * without a component import cycle.
 */
export type EditorViewMode = 'source' | 'reading'

/**
 * The view modes a whole DOCUMENT tab offers (feature-plan-13 §B1).
 *
 * A manuscript or a letter is exported as pages, so it can also be shown as
 * the pages it will become — read-only, rendered by the exporter itself
 * (export/DocumentPages.tsx). A loose `.md` file in EditorTab has no page
 * geometry to show and keeps the two editing modes, which is also why
 * `editor.defaultMode` stays an EditorViewMode: a default of 'pages' would
 * be meaningless for most of the files it applies to.
 */
export type DocViewMode = EditorViewMode | 'pages'

export const DOC_VIEW_MODES: readonly DocViewMode[] = ['source', 'reading', 'pages']

/**
 * The view switch's options, in the order the control shows them, and the one
 * place a mode's label lives.
 *
 * Ordered by how much of the document's final form each shows: the source you
 * type, the same text rendered, then the pages it becomes. A control that
 * shows all three is also the reason there is no separate label table — the
 * segmented switch replaced a cycling button, and a cycling button was the
 * only thing that ever needed a mode's name on its own.
 */
export const DOC_MODE_OPTIONS: readonly { value: DocViewMode; label: string; title: string }[] = [
  { value: 'source', label: 'Source', title: 'The Markdown as written' },
  { value: 'reading', label: 'Reading', title: 'Live preview — rendered, and still editable' },
  { value: 'pages', label: 'Pages', title: 'The pages this exports as — read-only' }
]

/** The next mode in the cycle ⌘E walks. */
export function nextDocMode(current: DocViewMode): DocViewMode {
  const i = DOC_VIEW_MODES.indexOf(current)
  return DOC_VIEW_MODES[(i + 1) % DOC_VIEW_MODES.length] as DocViewMode
}

export interface EditorSettings {
  /** Reading-mode content column width, in ch. */
  contentWidthCh: number
  /** Base editor font size, in px (applies to both modes). */
  fontSizePx: number
  /** Body font for reading mode (source stays mono). */
  fontFamily: EditorFontFamily
  /** Line height for both modes. */
  lineHeight: number
  /** App-wide theme: editor surface plus chrome (App.tsx's data-suna-theme). */
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

/** Display names for the built-ins; a user theme carries its own `name`. */
export const EDITOR_THEME_LABELS: Record<string, string> = {
  'suna-dark': 'SUNA Dark',
  'suna-light': 'SUNA Light',
  gruvbox: 'Gruvbox',
  jellybeans: 'Jellybeans',
  'mono-blue-dark': 'Mono Blue Dark',
  'mono-blue-light': 'Mono Blue Light'
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

/**
 * The editor surface's live view of the five appearance settings.
 *
 * A PROJECTION of the config, not a store of its own: nothing here is
 * persisted, and every setter writes straight into ~/.suna/config.yml. It
 * exists because the editor surface and CodeMirror read these on a hot path
 * and want them without a resolution lookup, and because the gear popover
 * predates the config file. `syncEditorSettings` below keeps it in step.
 */
export const useEditorSettings = create<EditorSettingsState>()((set) => ({
  ...EDITOR_SETTINGS_DEFAULTS,
  setContentWidthCh: (value) => {
    void useSettingsStore
      .getState()
      .set('editor.contentWidthCh', clampSetting('contentWidthCh', value))
  },
  setFontSizePx: (value) => {
    void useSettingsStore.getState().set('editor.fontSizePx', clampSetting('fontSizePx', value))
  },
  setLineHeight: (value) => {
    void useSettingsStore.getState().set('editor.lineHeight', clampSetting('lineHeight', value))
  },
  setFontFamily: (value) => {
    void useSettingsStore.getState().set('editor.fontFamily', value)
  },
  setEditorTheme: (value) => {
    void useSettingsStore.getState().set('editor.editorTheme', value)
  },
  reset: () => {
    const store = useSettingsStore.getState()
    void store.reset('editor.contentWidthCh')
    void store.reset('editor.fontSizePx')
    void store.reset('editor.lineHeight')
    void store.reset('editor.fontFamily')
    void store.reset('editor.editorTheme')
    set({ ...EDITOR_SETTINGS_DEFAULTS })
  }
}))

/**
 * Mirror the resolved config onto this store. Subscribed once at module load;
 * the initial call adopts whatever is already resolved, so a surface mounted
 * before the first config:get still paints with the shipped defaults rather
 * than with nothing.
 */
function adoptResolved(): void {
  const { settings } = useSettingsStore.getState()
  useEditorSettings.setState({
    contentWidthCh: clampSetting('contentWidthCh', settings['editor.contentWidthCh']),
    fontSizePx: clampSetting('fontSizePx', settings['editor.fontSizePx']),
    lineHeight: clampSetting('lineHeight', settings['editor.lineHeight']),
    fontFamily: settings['editor.fontFamily'],
    editorTheme: settings['editor.editorTheme']
  })
}

adoptResolved()
useSettingsStore.subscribe((state, prev) => {
  if (state.settings !== prev.settings) adoptResolved()
})
