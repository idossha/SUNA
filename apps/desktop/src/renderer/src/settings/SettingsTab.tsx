import { useEffect, useState, type JSX } from 'react'
import { useProjectStore } from '../state/project'
import {
  UI_SCALE_CHOICES,
  useSettingsStore,
  type EditorModeSetting,
  type EditorThemeSetting
} from '../state/settings'
import './settings.css'

const MODE_LABELS: Record<EditorModeSetting, string> = {
  reading: 'Reading (live preview)',
  source: 'Source (plain markdown)'
}

const THEME_LABELS: Record<EditorThemeSetting, string> = {
  'suna-dark': 'SUNA Dark',
  'suna-light': 'SUNA Light',
  'high-contrast': 'High Contrast'
}

/** Global Settings dock tab, persisted app-wide via settings:get/set. */
export function SettingsTab(): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const loaded = useSettingsStore((s) => s.loaded)
  const error = useSettingsStore((s) => s.error)
  const load = useSettingsStore((s) => s.load)
  const update = useSettingsStore((s) => s.update)
  const rootDir = useProjectStore((s) => s.rootDir)

  const [shellDraft, setShellDraft] = useState(settings['terminal.shell'])

  useEffect(() => {
    void load()
  }, [load])

  // adopt the persisted value once it arrives (or after another writer changes it)
  useEffect(() => {
    setShellDraft(settings['terminal.shell'])
  }, [settings])

  const commitShell = (): void => {
    const value = shellDraft.trim()
    if (value !== settings['terminal.shell']) void update('terminal.shell', value)
  }

  return (
    <div className="settings-tab">
      <div className="settings-tab__page">
        <h1 className="settings-tab__title">Settings</h1>
        <p className="settings-tab__sub">
          Apply app-wide and persist across projects{!loaded && ' — loading…'}
        </p>
        {error !== null && <div className="settings-tab__error">{error}</div>}

        <h2 className="settings-tab__section">General</h2>
        <div className="settings-tab__row">
          <label htmlFor="set-default-mode">
            Default editor mode
            <span className="settings-tab__hint">How markdown files open. Reading is the editable live preview.</span>
          </label>
          <select
            id="set-default-mode"
            value={settings['editor.defaultMode']}
            onChange={(e) => void update('editor.defaultMode', e.target.value as EditorModeSetting)}
          >
            {(Object.keys(MODE_LABELS) as EditorModeSetting[]).map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-tab__row">
          <label htmlFor="set-vim">
            Vim motions
            <span className="settings-tab__hint">Vim keybindings in the source editor.</span>
          </label>
          <input
            id="set-vim"
            type="checkbox"
            checked={settings['editor.vimMotions']}
            onChange={(e) => void update('editor.vimMotions', e.target.checked)}
          />
        </div>
        <div className="settings-tab__row">
          <label htmlFor="set-editor-theme">
            Editor theme
            <span className="settings-tab__hint">Default theme for the editor surface; app chrome stays dark.</span>
          </label>
          <select
            id="set-editor-theme"
            value={settings['editor.theme']}
            onChange={(e) => void update('editor.theme', e.target.value as EditorThemeSetting)}
          >
            {(Object.keys(THEME_LABELS) as EditorThemeSetting[]).map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-tab__row">
          <label htmlFor="set-autosave">
            Autosave
            <span className="settings-tab__hint">Reserved — not applied yet; saving stays manual (⌘S).</span>
          </label>
          <input
            id="set-autosave"
            type="checkbox"
            checked={settings['editor.autosave']}
            onChange={(e) => void update('editor.autosave', e.target.checked)}
          />
        </div>

        <h2 className="settings-tab__section">Appearance</h2>
        <div className="settings-tab__row">
          <label htmlFor="set-ui-scale">
            Interface scale
            <span className="settings-tab__hint">Zoom applied to the whole window.</span>
          </label>
          <select
            id="set-ui-scale"
            value={String(settings['appearance.uiScale'])}
            onChange={(e) => void update('appearance.uiScale', Number(e.target.value))}
          >
            {UI_SCALE_CHOICES.map((scale) => (
              <option key={scale} value={String(scale)}>
                {Math.round(scale * 100)}%
              </option>
            ))}
          </select>
        </div>

        <h2 className="settings-tab__section">Terminal</h2>
        <div className="settings-tab__row">
          <label htmlFor="set-shell">
            Shell
            <span className="settings-tab__hint">
              Absolute path (e.g. /bin/zsh). Empty uses the system default. Applies to new terminals.
            </span>
          </label>
          <input
            id="set-shell"
            type="text"
            spellCheck={false}
            placeholder="System default ($SHELL)"
            value={shellDraft}
            onChange={(e) => setShellDraft(e.target.value)}
            onBlur={commitShell}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitShell()
            }}
          />
        </div>

        <h2 className="settings-tab__section">About</h2>
        <div className="settings-tab__info">
          <div>
            <span>SUNA</span> 0.1.0
          </div>
          <div>
            <span>Electron</span> {window.suna.versions.electron}
          </div>
          <div>
            <span>Chrome</span> {window.suna.versions.chrome}
          </div>
          <div>
            <span>Platform</span> {window.suna.platform}
          </div>
          <div>
            <span>Project</span> {rootDir ?? 'no project open'}
          </div>
        </div>
      </div>
    </div>
  )
}
