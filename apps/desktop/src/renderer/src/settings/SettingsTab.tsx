import { useEffect, useState, type JSX } from 'react'
import {
  AI_CLI_LABEL,
  AI_MODES,
  EDITOR_FONT_FAMILIES,
  EDITOR_THEME_IDS,
  EDITOR_VIEW_MODES,
  FIGURE_WIDTH_PRESETS,
  LIT_CLI_PREFERENCE_IDS,
  LIT_PROVIDER_IDS,
  LIT_PROVIDER_META,
  SETTINGS_LIMITS,
  UI_LIT_PROVIDER_IDS,
  type AiMode,
  type EditorFontFamily,
  type FigureWidthPreset,
  type LitCliId,
  type LitCliPreference,
  type LitProviderId,
  type ResolvedSettings,
  type UiLitProviderId
} from '@suna/core'
import { BUNDLED_PROFILE_IDS, type BundledProfileId } from '@suna/formatter'
import { openFileTab } from '../state/dock'
import { profileLabel } from '../state/renderProfile'
import { useProjectStore } from '../state/project'
import {
  UI_SCALE_CHOICES,
  useResolved,
  useSettingsStore,
  type EditorModeSetting,
  type EditorThemeSetting
} from '../state/settings'
import { sourceLabel } from './sourceLabel'
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

const FONT_FAMILY_LABELS: Record<EditorFontFamily, string> = {
  serif: 'Serif',
  sans: 'Sans',
  mono: 'Mono'
}

const FIGURE_WIDTH_LABELS: Record<FigureWidthPreset, string> = {
  single: 'Single column',
  onehalf: '1.5 column',
  double: 'Double column'
}

const AI_MODE_LABELS: Record<AiMode, string> = {
  cli: 'Agent CLI (uses your subscription)',
  api: 'API key',
  none: 'Off'
}

function isBundledProfile(id: string): id is BundledProfileId {
  return (BUNDLED_PROFILE_IDS as readonly string[]).includes(id)
}

function litProviderLabel(id: UiLitProviderId): string {
  return id === 'ai-cli' ? AI_CLI_LABEL : LIT_PROVIDER_META[id].label
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

/* --------------------------------------------------------------------------
   Two-level hierarchy (feature-plan-5 §4): generic row builders shared by the
   "This project" scope. Every row here reads via useResolved (reactive to
   external suna.json edits through watchProjectSettings, already wired in
   state/settings.ts) and writes via setProject/clearProject — never
   setGlobal, so a project row can never cross into userData/settings.json.
   -------------------------------------------------------------------------- */

type NumberSettingKey = 'editor.contentWidthCh' | 'editor.fontSizePx' | 'editor.lineHeight'

type ProjectSelectKey =
  | 'editor.defaultMode'
  | 'editor.editorTheme'
  | 'editor.fontFamily'
  | 'figures.defaultWidthPreset'
  | 'ai.mode'

type ProjectNullableKey = 'previewProfileId' | 'literature.provider'

function SourceBadge({ source }: { source: 'project' | 'global' | 'default' }): JSX.Element {
  return <span className={`settings__source settings__source--${source}`}>{sourceLabel(source)}</span>
}

function ResetButton({
  source,
  onReset
}: {
  source: 'project' | 'global' | 'default'
  onReset: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="settings__reset"
      disabled={source !== 'project'}
      title="Remove the project override so this falls back to global/default"
      onClick={onReset}
    >
      Reset to global
    </button>
  )
}

function ProjectNumberRow(props: {
  settingKey: NumberSettingKey
  id: string
  label: string
  hint: string
  min: number
  max: number
  step: number
}): JSX.Element {
  const { settingKey, id, label, hint, min, max, step } = props
  const { value, source } = useResolved(settingKey)
  const setProject = useSettingsStore((s) => s.setProject)
  const clearProject = useSettingsStore((s) => s.clearProject)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const num = Number(draft)
    if (Number.isFinite(num) && num >= min && num <= max) {
      if (num !== value) void setProject(settingKey, num)
    } else {
      setDraft(String(value))
    }
  }

  return (
    <div className="settings-tab__row settings__project-row">
      <label htmlFor={id}>
        {label}
        <span className="settings-tab__hint">{hint}</span>
      </label>
      <div className="settings__control">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
        <SourceBadge source={source} />
        <ResetButton source={source} onReset={() => void clearProject(settingKey)} />
      </div>
    </div>
  )
}

function ProjectSelectRow<K extends ProjectSelectKey>(props: {
  settingKey: K
  id: string
  label: string
  hint: string
  options: readonly ResolvedSettings[K][]
  labelFor: (value: ResolvedSettings[K]) => string
}): JSX.Element {
  const { settingKey, id, label, hint, options, labelFor } = props
  const { value, source } = useResolved(settingKey)
  const setProject = useSettingsStore((s) => s.setProject)
  const clearProject = useSettingsStore((s) => s.clearProject)

  return (
    <div className="settings-tab__row settings__project-row">
      <label htmlFor={id}>
        {label}
        <span className="settings-tab__hint">{hint}</span>
      </label>
      <div className="settings__control">
        <select
          id={id}
          value={String(value)}
          onChange={(e) => {
            const found = options.find((opt) => String(opt) === e.target.value)
            if (found !== undefined) void setProject(settingKey, found)
          }}
        >
          {options.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {labelFor(opt)}
            </option>
          ))}
        </select>
        <SourceBadge source={source} />
        <ResetButton source={source} onReset={() => void clearProject(settingKey)} />
      </div>
    </div>
  )
}

function ProjectNullableSelectRow<K extends ProjectNullableKey>(props: {
  settingKey: K
  id: string
  label: string
  hint: string
  autoLabel: string
  options: readonly NonNullable<ResolvedSettings[K]>[]
  labelFor: (value: NonNullable<ResolvedSettings[K]>) => string
}): JSX.Element {
  const { settingKey, id, label, hint, autoLabel, options, labelFor } = props
  const { value, source } = useResolved(settingKey)
  const setProject = useSettingsStore((s) => s.setProject)
  const clearProject = useSettingsStore((s) => s.clearProject)

  return (
    <div className="settings-tab__row settings__project-row">
      <label htmlFor={id}>
        {label}
        <span className="settings-tab__hint">{hint}</span>
      </label>
      <div className="settings__control">
        <select
          id={id}
          value={value === null ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              void clearProject(settingKey)
              return
            }
            const found = options.find((opt) => String(opt) === raw)
            if (found !== undefined) void setProject(settingKey, found)
          }}
        >
          <option value="">{autoLabel}</option>
          {options.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {labelFor(opt)}
            </option>
          ))}
        </select>
        <SourceBadge source={source} />
        <ResetButton source={source} onReset={() => void clearProject(settingKey)} />
      </div>
    </div>
  )
}

function ProjectVimRow(): JSX.Element {
  const { value, source } = useResolved('editor.vimMotions')
  const setProject = useSettingsStore((s) => s.setProject)
  const clearProject = useSettingsStore((s) => s.clearProject)

  return (
    <div className="settings-tab__row settings__project-row">
      <label htmlFor="proj-vim">
        Vim motions
        <span className="settings-tab__hint">Vim keybindings in the source editor, for this project only.</span>
      </label>
      <div className="settings__control">
        <input
          id="proj-vim"
          type="checkbox"
          checked={value}
          onChange={(e) => void setProject('editor.vimMotions', e.target.checked)}
        />
        <SourceBadge source={source} />
        <ResetButton source={source} onReset={() => void clearProject('editor.vimMotions')} />
      </div>
    </div>
  )
}

function ProjectPythonEnvRow(): JSX.Element {
  const { value, source } = useResolved('python.envPath')
  const setProject = useSettingsStore((s) => s.setProject)
  const clearProject = useSettingsStore((s) => s.clearProject)
  const [draft, setDraft] = useState(value ?? '')

  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === (value ?? '')) return
    if (trimmed === '') void clearProject('python.envPath')
    else void setProject('python.envPath', trimmed)
  }

  return (
    <div className="settings-tab__row settings__project-row">
      <label htmlFor="proj-python-env">
        Python environment
        <span className="settings-tab__hint">
          Absolute interpreter/venv path this project&apos;s figure scripts run in. Empty follows
          the per-machine pick.
        </span>
      </label>
      <div className="settings__control">
        <input
          id="proj-python-env"
          type="text"
          spellCheck={false}
          placeholder="e.g. /usr/local/envs/paper/bin/python"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
        <SourceBadge source={source} />
        <ResetButton source={source} onReset={() => void clearProject('python.envPath')} />
      </div>
    </div>
  )
}

function PreviewProfileRow(): JSX.Element {
  const activeProfileId = useProjectStore((s) => s.manifest?.activeProfileId ?? null)
  const activeLabel =
    activeProfileId === null
      ? 'project default'
      : isBundledProfile(activeProfileId)
        ? profileLabel(activeProfileId)
        : activeProfileId

  return (
    <ProjectNullableSelectRow
      settingKey="previewProfileId"
      id="proj-preview-profile"
      label="Preview / render profile"
      hint="Which publisher profile the References view and the combined manuscript preview render as."
      autoLabel={`Auto (${activeLabel})`}
      options={BUNDLED_PROFILE_IDS}
      labelFor={(id) => (isBundledProfile(id) ? profileLabel(id) : id)}
    />
  )
}

function ProjectLiteratureProviderRow(): JSX.Element {
  return (
    <ProjectNullableSelectRow
      settingKey="literature.provider"
      id="proj-lit-provider"
      label="Literature provider"
      hint="Which search provider the References panel defaults to in this project."
      autoLabel="Auto (prefers a detected agent CLI)"
      options={UI_LIT_PROVIDER_IDS}
      labelFor={litProviderLabel}
    />
  )
}

/**
 * "This project" scope — only meaningful controls when a project is open.
 * Every row here writes suna.json's `settings` block through
 * project:update-settings and never touches userData/settings.json.
 */
function ProjectSettingsSection(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const manifest = useProjectStore((s) => s.manifest)
  const projectError = useSettingsStore((s) => s.projectError)

  if (rootDir === null) {
    return (
      <section className="settings__scope" data-scope="project">
        <h2 className="settings-tab__scope-title">This project</h2>
        <p className="settings__empty">Open a project to see and override its settings here.</p>
      </section>
    )
  }

  return (
    <section className="settings__scope" data-scope="project">
      <h2 className="settings-tab__scope-title">
        This project <span>· {manifest?.name ?? rootDir}</span>
      </h2>
      {projectError !== null && <div className="settings-tab__error">{projectError}</div>}

      <h3 className="settings-tab__section">Preview</h3>
      <PreviewProfileRow />

      <h3 className="settings-tab__section">Editor</h3>
      <ProjectSelectRow
        settingKey="editor.defaultMode"
        id="proj-editor-mode"
        label="Default editor mode"
        hint="How markdown files in this project open."
        options={EDITOR_VIEW_MODES}
        labelFor={(mode) => MODE_LABELS[mode]}
      />
      <ProjectNumberRow
        settingKey="editor.contentWidthCh"
        id="proj-content-width"
        label="Content width"
        hint="Reading-mode column width, in characters."
        min={SETTINGS_LIMITS.contentWidthCh.min}
        max={SETTINGS_LIMITS.contentWidthCh.max}
        step={1}
      />
      <ProjectNumberRow
        settingKey="editor.fontSizePx"
        id="proj-font-size"
        label="Font size"
        hint="Base editor font size, in px."
        min={SETTINGS_LIMITS.fontSizePx.min}
        max={SETTINGS_LIMITS.fontSizePx.max}
        step={1}
      />
      <ProjectNumberRow
        settingKey="editor.lineHeight"
        id="proj-line-height"
        label="Line height"
        hint="Line spacing for both modes."
        min={SETTINGS_LIMITS.lineHeight.min}
        max={SETTINGS_LIMITS.lineHeight.max}
        step={0.1}
      />
      <ProjectSelectRow
        settingKey="editor.fontFamily"
        id="proj-font-family"
        label="Body font"
        hint="Reading-mode body font; source view stays monospace."
        options={EDITOR_FONT_FAMILIES}
        labelFor={(family) => FONT_FAMILY_LABELS[family]}
      />
      <ProjectSelectRow
        settingKey="editor.editorTheme"
        id="proj-editor-theme"
        label="Editor theme"
        hint="Editor-surface theme for this project."
        options={EDITOR_THEME_IDS}
        labelFor={(theme) => THEME_LABELS[theme]}
      />
      <ProjectVimRow />

      <h3 className="settings-tab__section">Figures</h3>
      <ProjectSelectRow
        settingKey="figures.defaultWidthPreset"
        id="proj-figure-width"
        label="Default figure width"
        hint="Width preset new figures are inserted at."
        options={FIGURE_WIDTH_PRESETS}
        labelFor={(preset) => FIGURE_WIDTH_LABELS[preset]}
      />

      <h3 className="settings-tab__section">Python</h3>
      <ProjectPythonEnvRow />

      <h3 className="settings-tab__section">Literature</h3>
      <ProjectLiteratureProviderRow />

      <h3 className="settings-tab__section">AI</h3>
      <ProjectSelectRow
        settingKey="ai.mode"
        id="proj-ai-mode"
        label="AI mode"
        hint="How this project talks to an AI: an agent CLI, an API key, or not at all."
        options={AI_MODES}
        labelFor={(mode) => AI_MODE_LABELS[mode]}
      />

      <div className="settings__footer">
        <p className="settings__footer-note">
          Project settings live in <code>suna.json</code> — you can edit it directly.
        </p>
        <button type="button" className="btn" onClick={() => openFileTab(`${rootDir}/suna.json`)}>
          Open suna.json
        </button>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------------
   "Global (all projects)" — a couple of new typography rows live through the
   same resolver (useResolved + setGlobal) so the Settings page can show the
   feature-plan-5 §2 defaults (14px / 1.6); everything else here is the
   pre-existing settings:set flow via useSettingsStore.update, unchanged.
   -------------------------------------------------------------------------- */

function GlobalNumberField(props: {
  settingKey: NumberSettingKey
  id: string
  label: string
  hint: string
  min: number
  max: number
  step: number
}): JSX.Element {
  const { settingKey, id, label, hint, min, max, step } = props
  const { value } = useResolved(settingKey)
  const setGlobal = useSettingsStore((s) => s.setGlobal)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const num = Number(draft)
    if (Number.isFinite(num) && num >= min && num <= max) {
      if (num !== value) void setGlobal(settingKey, num)
    } else {
      setDraft(String(value))
    }
  }

  return (
    <div className="settings-tab__row">
      <label htmlFor={id}>
        {label}
        <span className="settings-tab__hint">{hint}</span>
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </div>
  )
}

function GlobalFontFamilyField(): JSX.Element {
  const { value } = useResolved('editor.fontFamily')
  const setGlobal = useSettingsStore((s) => s.setGlobal)

  return (
    <div className="settings-tab__row">
      <label htmlFor="set-body-font">
        Body font
        <span className="settings-tab__hint">Reading-mode body font; source view stays monospace.</span>
      </label>
      <select
        id="set-body-font"
        value={value}
        onChange={(e) => void setGlobal('editor.fontFamily', e.target.value as EditorFontFamily)}
      >
        {EDITOR_FONT_FAMILIES.map((family) => (
          <option key={family} value={family}>
            {FONT_FAMILY_LABELS[family]}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Global Settings dock tab, persisted app-wide via settings:get / settings:set. */
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
          Two levels: Global applies everywhere; This project overrides it in suna.json
          {!loaded && ' — loading…'}
        </p>
        {error !== null && <div className="settings-tab__error">{error}</div>}

        <section className="settings__scope" data-scope="global">
          <h2 className="settings-tab__scope-title">
            Global <span>· all projects</span>
          </h2>

          <h3 className="settings-tab__section">General</h3>
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

          <h3 className="settings-tab__section">Appearance</h3>
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
          <GlobalNumberField
            settingKey="editor.fontSizePx"
            id="set-font-size"
            label="Font size"
            hint="Base editor font size, in px. Default 14."
            min={SETTINGS_LIMITS.fontSizePx.min}
            max={SETTINGS_LIMITS.fontSizePx.max}
            step={1}
          />
          <GlobalNumberField
            settingKey="editor.lineHeight"
            id="set-line-height"
            label="Line height"
            hint="Line spacing for both modes. Default 1.6."
            min={SETTINGS_LIMITS.lineHeight.min}
            max={SETTINGS_LIMITS.lineHeight.max}
            step={0.1}
          />
          <GlobalNumberField
            settingKey="editor.contentWidthCh"
            id="set-content-width"
            label="Content width"
            hint="Reading-mode column width, in characters."
            min={SETTINGS_LIMITS.contentWidthCh.min}
            max={SETTINGS_LIMITS.contentWidthCh.max}
            step={1}
          />
          <GlobalFontFamilyField />

          <h3 className="settings-tab__section">Terminal</h3>
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

          <h3 className="settings-tab__section">References</h3>
          <div className="settings-tab__row">
            <label htmlFor="set-refs-auto-open">
              Auto-open reference PDF
              <span className="settings-tab__hint">
                Selecting a reference with a PDF opens it beside the list. Off leaves selection silent
                — use the PDF badge or &quot;Attach PDF…&quot; to open/attach manually.
              </span>
            </label>
            <input
              id="set-refs-auto-open"
              type="checkbox"
              checked={settings['references.autoOpenPdf']}
              onChange={(e) => void update('references.autoOpenPdf', e.target.checked)}
            />
          </div>

          <h3 className="settings-tab__section">Literature providers</h3>
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
        </section>

        <ProjectSettingsSection />

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
