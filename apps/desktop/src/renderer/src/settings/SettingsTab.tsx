import { useEffect, useState, type JSX } from 'react'
import {
  LIT_CLI_PREFERENCE_IDS,
  LIT_PROVIDER_IDS,
  LIT_PROVIDER_META,
  type LitCliId,
  type LitCliPreference,
  type LitProviderId
} from '@suna/core'
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

/** Only these providers accept a stored key server-side (agent-keys `lit:<id>` slots). */
const KEY_CAPABLE_PROVIDERS = new Set<LitProviderId>(['openalex', 'ads'])

interface LitProviderStatus {
  id: LitProviderId
  hasKey: boolean
  keyless: boolean
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** "Literature providers" settings section: key management for search/lookup. */
function LitProvidersSection(): JSX.Element {
  const [providers, setProviders] = useState<LitProviderStatus[]>([])
  const [drafts, setDrafts] = useState<Partial<Record<LitProviderId, string>>>({})
  const [busy, setBusy] = useState<LitProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      const res = await window.suna.invoke('lit:providers', {})
      setProviders(res.providers)
    } catch (err) {
      setError(errMessage(err))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const setKey = async (id: LitProviderId, key: string): Promise<void> => {
    setBusy(id)
    setError(null)
    try {
      await window.suna.invoke('lit:set-key', { provider: id, key })
      setDrafts((d) => ({ ...d, [id]: '' }))
      await refresh()
    } catch (err) {
      setError(errMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {error !== null && <div className="settings-tab__error">{error}</div>}
      {LIT_PROVIDER_IDS.map((id) => {
        const meta = LIT_PROVIDER_META[id]
        const status = providers.find((p) => p.id === id)
        const statusText =
          status === undefined
            ? '…'
            : status.hasKey
              ? 'Key saved.'
              : status.keyless
                ? 'No key needed.'
                : 'No key set.'
        return (
          <div className="settings-tab__row" key={id}>
            <label htmlFor={KEY_CAPABLE_PROVIDERS.has(id) ? `lit-key-${id}` : undefined}>
              {meta.label}
              <span className="settings-tab__hint">
                {meta.note}{' '}
                <span
                  className={
                    status?.hasKey === true
                      ? 'settings-tab__status settings-tab__status--ok'
                      : status?.keyless === false
                        ? 'settings-tab__status settings-tab__status--warn'
                        : 'settings-tab__status'
                  }
                >
                  {statusText}
                </span>
              </span>
            </label>
            {KEY_CAPABLE_PROVIDERS.has(id) && (
              <div className="settings-tab__keyrow">
                <input
                  id={`lit-key-${id}`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={status?.hasKey === true ? '••••••••' : 'API key'}
                  value={drafts[id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (drafts[id] ?? '') !== '') void setKey(id, drafts[id] ?? '')
                  }}
                />
                <button
                  disabled={busy === id || (drafts[id] ?? '') === ''}
                  onClick={() => void setKey(id, drafts[id] ?? '')}
                >
                  Save
                </button>
                <button disabled={busy === id || status?.hasKey !== true} onClick={() => void setKey(id, '')}>
                  Clear
                </button>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

const CLI_PREFERENCE_LABELS: Record<LitCliPreference, string> = {
  auto: 'Automatic (Claude Code, then Codex)',
  claude: 'Claude Code',
  codex: 'Codex'
}

function cliDisplayName(id: LitCliId): string {
  return id === 'claude' ? 'Claude Code' : 'Codex'
}

/** "AI CLI preference": which agent CLI the 'ai-cli' literature provider spawns. */
function AiCliSection(): JSX.Element {
  const cliPreference = useSettingsStore((s) => s.settings['lit.cli'])
  const update = useSettingsStore((s) => s.update)
  const [available, setAvailable] = useState<LitCliId[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.suna
      .invoke('lit:cli-status', {})
      .then((res) => setAvailable(res.available))
      .catch((err) => setError(errMessage(err)))
  }, [])

  const statusText =
    available === null
      ? 'Checking…'
      : available.length === 0
        ? 'Neither was found on PATH — literature search falls back to Crossref.'
        : `Detected: ${available.map(cliDisplayName).join(', ')}.`

  return (
    <div className="settings-tab__row">
      <label htmlFor="set-lit-cli">
        AI CLI preference
        <span className="settings-tab__hint">
          Which agent CLI the &quot;AI search&quot; literature provider spawns — billed to your
          existing subscription, not an API key. {statusText}
          {error !== null && ` (status check failed: ${error})`}
        </span>
      </label>
      <select
        id="set-lit-cli"
        value={cliPreference}
        onChange={(e) => void update('lit.cli', e.target.value as LitCliPreference)}
      >
        {LIT_CLI_PREFERENCE_IDS.map((id) => (
          <option key={id} value={id}>
            {CLI_PREFERENCE_LABELS[id]}
          </option>
        ))}
      </select>
    </div>
  )
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
  const [mailtoDraft, setMailtoDraft] = useState(settings['lit.mailto'])

  useEffect(() => {
    void load()
  }, [load])

  // adopt the persisted value once it arrives (or after another writer changes it)
  useEffect(() => {
    setShellDraft(settings['terminal.shell'])
    setMailtoDraft(settings['lit.mailto'])
  }, [settings])

  const commitShell = (): void => {
    const value = shellDraft.trim()
    if (value !== settings['terminal.shell']) void update('terminal.shell', value)
  }

  const commitMailto = (): void => {
    const value = mailtoDraft.trim()
    if (value !== settings['lit.mailto']) void update('lit.mailto', value)
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

        <h2 className="settings-tab__section">Literature providers</h2>
        <div className="settings-tab__row">
          <label htmlFor="set-lit-mailto">
            Contact email
            <span className="settings-tab__hint">
              Sent to Crossref/OpenAlex as a polite-pool contact (their preferred practice, not a
              login). Falls back to none if empty.
            </span>
          </label>
          <input
            id="set-lit-mailto"
            type="text"
            spellCheck={false}
            placeholder="you@university.edu"
            value={mailtoDraft}
            onChange={(e) => setMailtoDraft(e.target.value)}
            onBlur={commitMailto}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMailto()
            }}
          />
        </div>
        <AiCliSection />
        <LitProvidersSection />

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
