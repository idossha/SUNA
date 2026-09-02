import { useEffect, useState, type JSX } from 'react'
import {
  AI_CLI_LABEL,
  AI_EFFORTS,
  AI_MODELS,
  AI_MODES,
  DOWNLOAD_POLICIES,
  EDITOR_FONT_FAMILIES,
  EDITOR_VIEW_MODES,
  type EditorViewMode,
  REVIEW_AI_DIFF_MODES,
  FIGURE_WIDTH_PRESETS,
  LIT_CLI_PREFERENCE_IDS,
  LIT_PROVIDER_IDS,
  LIT_PROVIDER_META,
  SETTINGS_LIMITS,
  UI_LIMITS,
  TRASH_LIMITS,
  UI_LIT_PROVIDER_IDS,
  type AiEffort,
  type AiMode,
  type AiModel,
  type DownloadPolicy,
  type EditorFontFamily,
  type FigureWidthPreset,
  type LibraryConfig,
  type LibraryConfigState,
  type LitCliId,
  type LitCliPreference,
  type LitProviderId,
  type ResolvedSettings,
  type ReviewAiDiffs,
  type ResponseOf,
  type UiLitProviderId,
  type UpdateStatus
} from '@suna/core'
import { BUNDLED_PROFILE_IDS, type BundledProfileId } from '@suna/formatter'
import { AI_EFFORT_LABELS, AI_MODEL_LABELS } from './aiChoice'
import { GitHubAccount } from '../views/GitHubAccount'
import { openFileTab, openTrashTab } from '../state/dock'
import { profileLabel } from '../state/renderProfile'
import { useProjectStore } from '../state/project'
import { useResolved, useSettingsStore } from '../state/settings'

/** Whole-window zoom steps the picker offers. */
const UI_SCALE_CHOICES = [0.9, 1, 1.1, 1.25] as const
import { sourceLabel } from './sourceLabel'
import type { SettingSource } from '@suna/core'
import './settings.css'

const MODE_LABELS: Record<EditorViewMode, string> = {
  reading: 'Reading (live preview)',
  source: 'Source (plain markdown)'
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
const KEY_CAPABLE_PROVIDERS = new Set<LitProviderId>(['openalex'])

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
  const cliPreference = useSettingsStore((s) => s.settings['literature.cli'])
  const setSetting = useSettingsStore((s) => s.set)
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
        onChange={(e) => void setSetting('literature.cli', e.target.value as LitCliPreference)}
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

/** Short enough for the 220px select; what each one actually reaches is in
 *  the row's hint, where there is room to say it honestly. */
const DOWNLOAD_POLICY_LABELS: Record<DownloadPolicy, string> = {
  off: 'Off — never download',
  'open-access': 'Open access only',
  publisher: 'Open access + publisher'
}

/**
 * "Reference library" (ARCHITECTURE §15.5): which folders on THIS
 * machine may be searched for a paper's PDF, whether Spotlight helps, and how
 * far a download may reach.
 *
 * The non-obvious part: unlike every other row on this page, these three do
 * NOT live in userData/settings.json and never go through useSettingsStore.
 * They are read and written with 'library:read-config'/'library:write-config',
 * which put them in `~/SunaConfig/library.json` — because the standalone MCP
 * server has no userData and must search exactly the folders this pane names.
 * A second copy of them in the settings store would drift the moment either
 * host changed one, and the two hosts have to agree about which directories
 * may be read at all, which is not a thing to let drift.
 *
 * So the pane keeps no draft of its own: every write answers with the whole
 * config — including, when the write was refused, the UNCHANGED config plus a
 * sentence saying why — and that answer simply becomes the state.
 */
/**
 * Version control, machine-wide.
 *
 * The GitHub sign-in belongs here rather than only in Source Control because
 * it is a property of this computer, not of one manuscript: sign in once and
 * every project on the machine can create and push its own repository. The
 * git identity sits beside it for the same reason — it is global config, and
 * a missing one is the single most common reason a first commit fails.
 */
function VersionControlSection(): JSX.Element {
  const [ssh, setSsh] = useState<ResponseOf<'git:ssh-status'> | null>(null)

  const loadSsh = async (): Promise<void> => {
    setSsh(await window.suna.invoke('git:ssh-status', { probe: false }).catch(() => null))
  }

  useEffect(() => {
    void loadSsh()
  }, [])

  const name = ssh?.identity.name ?? null
  const email = ssh?.identity.email ?? null
  const identityOk = name !== null && email !== null
  const keyCount = ssh?.keys.length ?? 0

  return (
    <>
      <div className="settings__vcs">
        <GitHubAccount onChanged={loadSsh} setStatusNote={() => undefined} />
      </div>

      <div className="settings-tab__row">
        <label>
          Commit identity
          <span className="settings-tab__hint">
            The name and email git records on every commit you make, from git&apos;s own global
            config. Without both, committing fails.
          </span>
        </label>
        <div className="settings__vcs-status">
          {ssh === null ? (
            <span className="settings-tab__hint">Checking…</span>
          ) : identityOk ? (
            <span className="git__ok">
              {name} &lt;{email}&gt;
            </span>
          ) : (
            <span className="settings__vcs-warn">
              Not set — run{' '}
              <code>git config --global user.name &quot;Your Name&quot;</code> and{' '}
              <code>git config --global user.email &quot;you@example.com&quot;</code> in a terminal.
            </span>
          )}
        </div>
      </div>

      <div className="settings-tab__row">
        <label>
          SSH keys
          <span className="settings-tab__hint">
            An alternative to signing in: a key on this machine can push without a GitHub session.
            Either one is enough.
          </span>
        </label>
        <div className="settings__vcs-status">
          {ssh === null ? (
            <span className="settings-tab__hint">Checking…</span>
          ) : keyCount === 0 ? (
            <span className="settings-tab__hint">
              None in {ssh.sshDir}. Source Control walks through creating one.
            </span>
          ) : (
            <span className="git__ok">
              {keyCount} {keyCount === 1 ? 'key' : 'keys'} in {ssh.sshDir}
            </span>
          )}
        </div>
      </div>
    </>
  )
}

function ReferenceLibrarySection(): JSX.Element {
  const [state, setState] = useState<LibraryConfigState | null>(null)
  const [busy, setBusy] = useState(false)
  /** An IPC call that never landed, as distinct from `state.error`, which is
   *  main telling us why a config it DID read or write is unusable. */
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void window.suna
      .invoke('library:read-config', {})
      .then(setState)
      .catch((err) => setFailure(errMessage(err)))
  }, [])

  const write = async (patch: Partial<Omit<LibraryConfig, 'schemaVersion'>>): Promise<void> => {
    setBusy(true)
    setFailure(null)
    setNotice(null)
    try {
      setState(await window.suna.invoke('library:write-config', { patch }))
    } catch (err) {
      setFailure(errMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** The same native directory dialog the project pickers use — main opens it,
   *  so the renderer never touches the filesystem to offer a folder.
   *
   *  A picked folder is stored ABSOLUTE. library.json prefers portable `~/…`
   *  roots and `expandRoots` accepts either, but nothing on the preload
   *  surface tells the renderer where home is, and folding a path against a
   *  guessed one would write a root that resolves somewhere else on the next
   *  machine. An absolute root is at least honest about being this machine's;
   *  a user who syncs the file can shorten it by hand. */
  const addRoot = async (): Promise<void> => {
    if (state === null) return
    setFailure(null)
    setNotice(null)
    let picked: string | null
    try {
      const res = await window.suna.invoke('dialog:pick-directory', {
        title: 'Add a folder to search for reference PDFs',
        allowCreate: false
      })
      picked = res.path
    } catch (err) {
      setFailure(errMessage(err))
      return
    }
    if (picked === null) return
    if (state.config.roots.includes(picked)) {
      setNotice(`${picked} is already in the list — it is searched once, not twice.`)
      return
    }
    await write({ roots: [...state.config.roots, picked] })
  }

  const removeRoot = async (root: string): Promise<void> => {
    if (state === null) return
    await write({ roots: state.config.roots.filter((configured) => configured !== root) })
  }

  if (state === null) {
    return (
      <>
        {failure !== null && <div className="settings-tab__error">{failure}</div>}
        <p className="settings__empty">
          {failure === null ? 'Reading library.json…' : 'These settings could not be read.'}
        </p>
      </>
    )
  }

  const missing = new Set(state.expanded.missing)

  return (
    <>
      {failure !== null && <div className="settings-tab__error">{failure}</div>}
      {state.error !== null && <div className="settings-tab__error">{state.error}</div>}

      <div className="settings-tab__row">
        <label>
          Folders to search
          <span className="settings-tab__hint">
            Searched read-only for a reference&apos;s PDF; a file found here is copied into the
            project, never moved. Stored in <code>{state.path}</code> — not the app&apos;s settings
            file — so the agent searches exactly these folders.{' '}
            {state.config.roots.length === 0
              ? 'Nothing is configured, so nothing on this machine will be searched.'
              : `${state.expanded.roots.length} of ${state.config.roots.length} searchable right now.`}
          </span>
        </label>
        <div className="settings-tab__keyrow">
          <button disabled={busy} onClick={() => void addRoot()}>
            Add folder…
          </button>
        </div>
      </div>

      {state.config.roots.map((root, index) => (
        <div className="settings-tab__row" key={`${index}:${root}`}>
          <label>
            <code>{root}</code>
            <span
              className={
                missing.has(root)
                  ? 'settings-tab__hint settings-tab__status settings-tab__status--warn'
                  : 'settings-tab__hint settings-tab__status settings-tab__status--ok'
              }
            >
              {missing.has(root) ? 'not on this machine — skipped' : 'searchable'}
            </span>
          </label>
          <div className="settings-tab__keyrow">
            <button disabled={busy} onClick={() => void removeRoot(root)}>
              Remove
            </button>
          </div>
        </div>
      ))}

      {/* Every root that was dropped or collapsed into another, verbatim from
          the expansion — "searched 3 of 4" is only useful with the reason. */}
      {state.expanded.notes.map((note) => (
        <p className="settings-tab__hint" key={note}>
          {note}
        </p>
      ))}
      {notice !== null && <p className="settings-tab__hint">{notice}</p>}

      {/* Spotlight is macOS's own index, reached through `mdfind`. The stored
          setting stays portable (a synced library.json keeps working); it is
          the CONTROL that is hidden off darwin, because a toggle that does
          nothing on this machine is worse than no toggle. */}
      {window.suna.platform === 'darwin' && (
        <div className="settings-tab__row">
          <label htmlFor="set-library-spotlight">
            Use Spotlight
            <span className="settings-tab__hint">
              Ask <code>mdfind</code> for PDFs whose text contains the DOI or title before walking
              the folders above. It honours your own Spotlight privacy exclusions.
            </span>
          </label>
          <input
            id="set-library-spotlight"
            type="checkbox"
            disabled={busy}
            checked={state.config.useSpotlight}
            onChange={(e) => void write({ useSpotlight: e.target.checked })}
          />
        </div>
      )}

      <div className="settings-tab__row">
        <label htmlFor="set-library-download">
          Download policy
          <span className="settings-tab__hint">
            How far &quot;Find PDF&quot; may reach when no copy is on this machine. Open access
            covers arXiv, bioRxiv and Unpaywall; publisher additionally follows the DOI and reads
            the article page&apos;s PDF link. No setting ever tries to get past a paywall — a 403
            is reported as a 403.
          </span>
        </label>
        <select
          id="set-library-download"
          disabled={busy}
          value={state.config.download}
          onChange={(e) => void write({ download: e.target.value as DownloadPolicy })}
        >
          {DOWNLOAD_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {DOWNLOAD_POLICY_LABELS[policy]}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}

/* --------------------------------------------------------------------------
   Generic row builders. Every row reads through useResolved — reactive to an
   external edit of ~/.suna/config.yml, which main watches — and writes through
   the store's set/reset, which edit that same file in place, comments and all.
   There is no second level for a row to cross into.
   -------------------------------------------------------------------------- */

type NumberSettingKey =
  | 'editor.contentWidthCh'
  | 'editor.fontSizePx'
  | 'editor.lineHeight'
  | 'ui.textScale'
  | 'ui.radiusPx'
  | 'ui.titleBarHeightPx'
  | 'ui.activityBarWidthPx'
  | 'ui.statusBarHeightPx'

type ConfigSelectKey =
  | 'editor.defaultMode'
  | 'editor.editorTheme'
  | 'editor.fontFamily'
  | 'figures.defaultWidthPreset'
  | 'ai.mode'
  | 'ai.model'
  | 'ai.effort'
  | 'review.aiDiffs'

type ConfigNullableKey = 'previewProfileId' | 'literature.provider'

type ConfigToggleKey =
  | 'editor.vimMotions'
  | 'editor.autosave'
  | 'editor.lineNumbers'
  | 'export.doubleSpacing'
  | 'export.lineNumbers'
  | 'export.pageNumbers'
  | 'references.autoOpenPdf'
  | 'updates.checkOnLaunch'

const AI_DIFF_LABELS: Record<ReviewAiDiffs, string> = {
  inline: 'Show inline',
  off: 'Hidden'
}

function SourceBadge({ source }: { source: SettingSource }): JSX.Element {
  return <span className={`settings__source settings__source--${source}`}>{sourceLabel(source)}</span>
}

function ResetButton({
  source,
  onReset
}: {
  source: SettingSource
  onReset: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="settings__reset"
      disabled={source !== 'config'}
      title="Remove this key from config.yml so it falls back to the shipped default"
      onClick={onReset}
    >
      Reset to default
    </button>
  )
}

function ConfigNumberRow(props: {
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
  const setSetting = useSettingsStore((s) => s.set)
  const resetSetting = useSettingsStore((s) => s.reset)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const num = Number(draft)
    if (Number.isFinite(num) && num >= min && num <= max) {
      if (num !== value) void setSetting(settingKey, num)
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
        <ResetButton source={source} onReset={() => void resetSetting(settingKey)} />
      </div>
    </div>
  )
}

function ConfigSelectRow<K extends ConfigSelectKey>(props: {
  settingKey: K
  id: string
  label: string
  hint: string
  options: readonly ResolvedSettings[K][]
  labelFor: (value: ResolvedSettings[K]) => string
}): JSX.Element {
  const { settingKey, id, label, hint, options, labelFor } = props
  const { value, source } = useResolved(settingKey)
  const setSetting = useSettingsStore((s) => s.set)
  const resetSetting = useSettingsStore((s) => s.reset)

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
            if (found !== undefined) void setSetting(settingKey, found)
          }}
        >
          {options.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {labelFor(opt)}
            </option>
          ))}
        </select>
        <SourceBadge source={source} />
        <ResetButton source={source} onReset={() => void resetSetting(settingKey)} />
      </div>
    </div>
  )
}

function ConfigNullableSelectRow<K extends ConfigNullableKey>(props: {
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
  const setSetting = useSettingsStore((s) => s.set)
  const resetSetting = useSettingsStore((s) => s.reset)

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
              void resetSetting(settingKey)
              return
            }
            const found = options.find((opt) => String(opt) === raw)
            if (found !== undefined) void setSetting(settingKey, found)
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
        <ResetButton source={source} onReset={() => void resetSetting(settingKey)} />
      </div>
    </div>
  )
}

/** Any boolean setting, with its source badge and reset. */
function ConfigToggleRow(props: {
  settingKey: ConfigToggleKey
  id: string
  label: string
  hint: string
}): JSX.Element {
  const { settingKey, id, label, hint } = props
  const { value, source } = useResolved(settingKey)
  const setSetting = useSettingsStore((s) => s.set)
  const resetSetting = useSettingsStore((s) => s.reset)

  return (
    <div className="settings-tab__row settings__project-row">
      <label htmlFor={id}>
        {label}
        <span className="settings-tab__hint">{hint}</span>
      </label>
      <div className="settings__control">
        <input
          id={id}
          type="checkbox"
          checked={value}
          onChange={(e) => void setSetting(settingKey, e.target.checked)}
        />
        <SourceBadge source={source} />
        <ResetButton source={source} onReset={() => void resetSetting(settingKey)} />
      </div>
    </div>
  )
}

function ConfigPythonEnvRow(): JSX.Element {
  const { value, source } = useResolved('python.envPath')
  const setSetting = useSettingsStore((s) => s.set)
  const resetSetting = useSettingsStore((s) => s.reset)
  const [draft, setDraft] = useState(value ?? '')

  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === (value ?? '')) return
    if (trimmed === '') void resetSetting('python.envPath')
    else void setSetting('python.envPath', trimmed)
  }

  return (
    <div className="settings-tab__row settings__project-row">
      <label htmlFor="cfg-python-env">
        Python environment
        <span className="settings-tab__hint">
          Absolute interpreter/venv path this project&apos;s figure scripts run in. Empty follows
          the per-machine pick.
        </span>
      </label>
      <div className="settings__control">
        <input
          id="cfg-python-env"
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
        <ResetButton source={source} onReset={() => void resetSetting('python.envPath')} />
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
    <ConfigNullableSelectRow
      settingKey="previewProfileId"
      id="cfg-preview-profile"
      label="Preview / render profile"
      hint="Which publisher profile the References view and the combined manuscript preview render as."
      autoLabel={`Auto (${activeLabel})`}
      options={BUNDLED_PROFILE_IDS}
      labelFor={(id) => (isBundledProfile(id) ? profileLabel(id) : id)}
    />
  )
}

function ConfigLiteratureProviderRow(): JSX.Element {
  return (
    <ConfigNullableSelectRow
      settingKey="literature.provider"
      id="cfg-lit-provider"
      label="Literature provider"
      hint="Which search provider the References panel defaults to in this project."
      autoLabel="Auto (prefers a detected agent CLI)"
      options={UI_LIT_PROVIDER_IDS}
      labelFor={litProviderLabel}
    />
  )
}

/**
 * The theme picker. Its options come from the loaded config, NOT from a
 * compile-time list: a theme dropped into ~/.suna/themes/ appears here the
 * moment the file is saved, beside the built-ins and indistinguishable from
 * them, which is the whole point of the theme file.
 */
function ConfigThemeRow(): JSX.Element {
  const { value, source } = useResolved('editor.editorTheme')
  const themes = useSettingsStore((s) => s.themes)
  const setSetting = useSettingsStore((s) => s.set)
  const resetSetting = useSettingsStore((s) => s.reset)
  const known = themes.some((theme) => theme.id === value)

  return (
    <div className="settings-tab__row">
      <label htmlFor="cfg-editor-theme">
        Theme
        <span className="settings-tab__hint">
          Editor surface and app chrome. Add your own as ~/.suna/themes/&lt;name&gt;.yml.
        </span>
      </label>
      <div className="settings__control">
        <select
          id="cfg-editor-theme"
          value={known ? value : ''}
          onChange={(e) => void setSetting('editor.editorTheme', e.target.value)}
        >
          {/* A theme id the config names but nothing defines still shows, so
              the picker reflects the file rather than silently disagreeing. */}
          {!known && <option value="">{value} (not found)</option>}
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.builtin ? theme.name : `${theme.name} · yours`}
            </option>
          ))}
        </select>
        <SourceBadge source={source} />
        <ResetButton source={source} onReset={() => void resetSetting('editor.editorTheme')} />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------------
   Category panes. The page shows ONE of these at a time behind a left rail,
   so a setting is found by picking its category rather than by scrolling the
   whole file. Every row still writes ~/.suna/config.yml — the split is
   navigation, not a second store.
   -------------------------------------------------------------------------- */

function AppearancePane(): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const setSetting = useSettingsStore((s) => s.set)

  return (
    <>
      <h3 className="settings-tab__section">Interface</h3>
      <div className="settings-tab__row">
        <label htmlFor="set-ui-scale">
          Interface scale
          <span className="settings-tab__hint">Zoom applied to the whole window.</span>
        </label>
        <select
          id="set-ui-scale"
          value={String(settings['ui.scale'])}
          onChange={(e) => void setSetting('ui.scale', Number(e.target.value))}
        >
          {UI_SCALE_CHOICES.map((scale) => (
            <option key={scale} value={String(scale)}>
              {Math.round(scale * 100)}%
            </option>
          ))}
        </select>
      </div>
      <ConfigNumberRow
        settingKey="ui.textScale"
        id="set-ui-text-scale"
        label="Interface text"
        hint="Multiplies the chrome type scale — labels, tabs, the status bar. Unlike Interface scale this leaves geometry alone."
        min={UI_LIMITS.textScale.min}
        max={UI_LIMITS.textScale.max}
        step={0.05}
      />
      <ConfigThemeRow />

      <h3 className="settings-tab__section">Window chrome</h3>
      <ConfigNumberRow
        settingKey="ui.radiusPx"
        id="set-ui-radius"
        label="Corner radius"
        hint="Rounding on buttons, inputs and popovers, in px. 0 for square corners."
        min={UI_LIMITS.radiusPx.min}
        max={UI_LIMITS.radiusPx.max}
        step={1}
      />
      <ConfigNumberRow
        settingKey="ui.titleBarHeightPx"
        id="set-ui-titlebar"
        label="Title bar height"
        hint="In px."
        min={UI_LIMITS.titleBarHeightPx.min}
        max={UI_LIMITS.titleBarHeightPx.max}
        step={1}
      />
      <ConfigNumberRow
        settingKey="ui.activityBarWidthPx"
        id="set-ui-activitybar"
        label="Activity bar width"
        hint="In px. 0 hides the icon rail's width entirely."
        min={UI_LIMITS.activityBarWidthPx.min}
        max={UI_LIMITS.activityBarWidthPx.max}
        step={1}
      />
      <ConfigNumberRow
        settingKey="ui.statusBarHeightPx"
        id="set-ui-statusbar"
        label="Status bar height"
        hint="In px."
        min={UI_LIMITS.statusBarHeightPx.min}
        max={UI_LIMITS.statusBarHeightPx.max}
        step={1}
      />
    </>
  )
}

function EditorPane(): JSX.Element {
  return (
    <>
      <h3 className="settings-tab__section">Editor</h3>
      <ConfigSelectRow
        settingKey="editor.defaultMode"
        id="cfg-editor-mode"
        label="Default editor mode"
        hint="How Markdown files open. Reading is the editable live preview."
        options={EDITOR_VIEW_MODES}
        labelFor={(mode) => MODE_LABELS[mode]}
      />
      <ConfigNumberRow
        settingKey="editor.contentWidthCh"
        id="cfg-content-width"
        label="Content width"
        hint="Reading-mode column width, in characters."
        min={SETTINGS_LIMITS.contentWidthCh.min}
        max={SETTINGS_LIMITS.contentWidthCh.max}
        step={1}
      />
      <ConfigNumberRow
        settingKey="editor.fontSizePx"
        id="cfg-font-size"
        label="Font size"
        hint="Base editor font size, in px."
        min={SETTINGS_LIMITS.fontSizePx.min}
        max={SETTINGS_LIMITS.fontSizePx.max}
        step={1}
      />
      <ConfigNumberRow
        settingKey="editor.lineHeight"
        id="cfg-line-height"
        label="Line height"
        hint="Line spacing for both modes."
        min={SETTINGS_LIMITS.lineHeight.min}
        max={SETTINGS_LIMITS.lineHeight.max}
        step={0.1}
      />
      <ConfigSelectRow
        settingKey="editor.fontFamily"
        id="cfg-font-family"
        label="Body font"
        hint="Reading-mode body font; source view stays monospace."
        options={EDITOR_FONT_FAMILIES}
        labelFor={(family) => FONT_FAMILY_LABELS[family]}
      />

      <h3 className="settings-tab__section">Behaviour</h3>
      <ConfigSelectRow
        settingKey="review.aiDiffs"
        id="cfg-ai-diffs"
        label="AI changes"
        hint="Show what the AI changed, removals in red and additions in green, until you accept or reject them."
        options={REVIEW_AI_DIFF_MODES}
        labelFor={(mode) => AI_DIFF_LABELS[mode]}
      />
      <ConfigToggleRow
        settingKey="editor.vimMotions"
        id="cfg-vim"
        label="Vim motions"
        hint="Vim keybindings in the source editor."
      />
      <ConfigToggleRow
        settingKey="editor.lineNumbers"
        id="cfg-line-numbers"
        label="Line numbers"
        hint="Line numbers in the source view's gutter."
      />
      <ConfigToggleRow
        settingKey="editor.autosave"
        id="cfg-autosave"
        label="Autosave"
        hint="Save editors and the figure canvas a second after you stop editing. ⌘S still works."
      />
    </>
  )
}

function FiguresPane(): JSX.Element {
  return (
    <>
      <h3 className="settings-tab__section">Preview</h3>
      <PreviewProfileRow />

      <h3 className="settings-tab__section">Figures</h3>
      <ConfigSelectRow
        settingKey="figures.defaultWidthPreset"
        id="cfg-figure-width"
        label="Default figure width"
        hint="Width preset new figures are inserted at."
        options={FIGURE_WIDTH_PRESETS}
        labelFor={(preset) => FIGURE_WIDTH_LABELS[preset]}
      />
    </>
  )
}

function ExportPane(): JSX.Element {
  return (
    <>
      <h3 className="settings-tab__section">Export</h3>
      <ConfigToggleRow
        settingKey="export.doubleSpacing"
        id="set-export-double"
        label="Double-space manuscripts"
        hint="The default for a new export. A journal profile that states its own requirement still overrides it in the export dialog."
      />
      <ConfigToggleRow
        settingKey="export.lineNumbers"
        id="set-export-lines"
        label="Line numbers"
        hint="Continuous line numbers down the exported manuscript's margin."
      />
      <ConfigToggleRow
        settingKey="export.pageNumbers"
        id="set-export-pages"
        label="Page numbers"
        hint="Page numbers in the exported manuscript."
      />
    </>
  )
}

function AiPane(): JSX.Element {
  return (
    <>
      <h3 className="settings-tab__section">AI</h3>
      <ConfigSelectRow
        settingKey="ai.mode"
        id="cfg-ai-mode"
        label="AI mode"
        hint="How this project talks to an AI: an agent CLI, an API key, or not at all."
        options={AI_MODES}
        labelFor={(mode) => AI_MODE_LABELS[mode]}
      />
      <ConfigSelectRow
        settingKey="ai.model"
        id="cfg-ai-model"
        label="Model"
        hint="Model tier every AI call in this project runs at."
        options={AI_MODELS}
        labelFor={(model) => AI_MODEL_LABELS[model]}
      />
      <ConfigSelectRow
        settingKey="ai.effort"
        id="cfg-ai-effort"
        label="Effort"
        hint="How hard it thinks before answering. Higher costs more and takes longer."
        options={AI_EFFORTS}
        labelFor={(effort) => AI_EFFORT_LABELS[effort]}
      />
      <AiCliSection />
    </>
  )
}

function ReferencesPane(): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const setSetting = useSettingsStore((s) => s.set)
  const [mailtoDraft, setMailtoDraft] = useState(settings['literature.mailto'])

  useEffect(() => {
    setMailtoDraft(settings['literature.mailto'])
  }, [settings])

  const commitMailto = (): void => {
    const value = mailtoDraft.trim()
    if (value !== settings['literature.mailto']) void setSetting('literature.mailto', value)
  }

  return (
    <>
      <h3 className="settings-tab__section">References</h3>
      <ConfigToggleRow
        settingKey="references.autoOpenPdf"
        id="set-refs-auto-open"
        label="Auto-open reference PDF"
        hint="Selecting a reference with a PDF opens it beside the list. Off leaves selection silent — use the PDF badge or “Attach PDF…” to open it by hand."
      />

      <h3 className="settings-tab__section">Literature providers</h3>
      <ConfigLiteratureProviderRow />
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
      <LitProvidersSection />

      <h3 className="settings-tab__section">Reference library</h3>
      <ReferenceLibrarySection />
    </>
  )
}

function ToolsPane(): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const setSetting = useSettingsStore((s) => s.set)
  const [shellDraft, setShellDraft] = useState(settings['terminal.shell'])

  useEffect(() => {
    setShellDraft(settings['terminal.shell'])
  }, [settings])

  const commitShell = (): void => {
    const value = shellDraft.trim()
    if (value !== settings['terminal.shell']) void setSetting('terminal.shell', value)
  }

  return (
    <>
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

      <h3 className="settings-tab__section">Python</h3>
      <ConfigPythonEnvRow />
    </>
  )
}

function VersionControlPane(): JSX.Element {
  return (
    <>
      <h3 className="settings-tab__section">Version control</h3>
      <VersionControlSection />
    </>
  )
}

function TrashPane(): JSX.Element {
  return (
    <>
      <h3 className="settings-tab__section">Trash</h3>
      <TrashSection />
    </>
  )
}

/**
 * "Updates" (ARCHITECTURE §23). The renderer never sees an artifact and never
 * decides anything: it paints the status the main process pushes and sends
 * back four clicks. `mode` decides which buttons exist, so the page cannot
 * offer a restart to a `.deb` install that has no business restarting.
 */
function UpdatesSection(): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.suna
      .invoke('update:state', {})
      .then((next) => {
        if (live) setStatus(next)
      })
      .catch((err: unknown) => {
        if (live) setError(errMessage(err))
      })
    // The launch check answers on its own schedule, and a download reports
    // progress; both arrive here rather than by polling.
    const stop = window.suna.onUpdateStatus((next) => {
      if (live) setStatus(next)
    })
    return () => {
      live = false
      stop()
    }
  }, [])

  const act = async (run: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      if (!result.ok) setError(result.error ?? 'the update could not be applied')
    } catch (err) {
      setError(errMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const version = status?.current ?? '…'
  const phase = status?.phase ?? 'idle'
  const mode = status?.mode ?? 'off'
  const available = status?.available

  const line = ((): string => {
    if (mode === 'off') {
      return 'This build cannot update itself — a development tree has nothing to replace.'
    }
    if (phase === 'checking') return 'Checking…'
    if (phase === 'none') return `SUNA ${version} is the newest release.`
    if (phase === 'available' && available !== undefined) {
      return mode === 'inplace'
        ? `SUNA ${available} is available.`
        : `SUNA ${available} is available. This install came from a package, so update it the way you installed it.`
    }
    if (phase === 'downloading') {
      const received = status?.received ?? 0
      const total = status?.total ?? 0
      const percent = total > 0 ? Math.round((received / total) * 100) : 0
      return `Downloading ${available ?? ''}… ${percent}%`
    }
    if (phase === 'downloaded') return `SUNA ${available ?? ''} is ready. Restart to install it.`
    if (phase === 'error') return status?.error ?? 'The check failed.'
    return `SUNA ${version}.`
  })()

  return (
    <>
      <h3 className="settings-tab__section">Updates</h3>
      <ConfigToggleRow
        settingKey="updates.checkOnLaunch"
        id="set-updates-check"
        label="Check on launch"
        hint="Ask GitHub once, a few seconds after SUNA starts. Off means SUNA never reaches the network unless you press Check now."
      />
      <div className="settings-tab__keyrow">
        <span className="settings-tab__hint">{line}</span>
        <div className="settings-tab__keyrow-actions">
          <button
            type="button"
            disabled={busy || mode === 'off' || phase === 'checking' || phase === 'downloading'}
            onClick={() =>
              void act(async () => {
                const next = await window.suna.invoke('update:check', {})
                setStatus(next)
                return { ok: next.phase !== 'error', ...(next.error ? { error: next.error } : {}) }
              })
            }
          >
            Check now
          </button>
          {phase === 'available' && mode === 'inplace' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => window.suna.invoke('update:download', {}))}
            >
              Download
            </button>
          )}
          {phase === 'available' && mode === 'notify' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => window.suna.invoke('update:install', {}))}
            >
              Open Releases
            </button>
          )}
          {phase === 'downloaded' && mode === 'inplace' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => window.suna.invoke('update:install', {}))}
            >
              Restart and install
            </button>
          )}
          {phase === 'available' && available !== undefined && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const next = await window.suna.invoke('update:skip', { version: available })
                  setStatus(next)
                  return { ok: true }
                })
              }
            >
              Skip this version
            </button>
          )}
        </div>
      </div>
      {status?.notes !== undefined && status.notes !== '' && phase === 'available' && (
        <pre className="settings-tab__notes">{status.notes}</pre>
      )}
      {error !== null && <div className="settings-tab__error">{error}</div>}
    </>
  )
}

function AboutPane(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const [version, setVersion] = useState('…')

  // The one place the running version is stated, and it is asked for rather
  // than typed: a hand-written version string is wrong the first release
  // nobody remembers to edit it.
  useEffect(() => {
    let live = true
    void window.suna
      .invoke('update:state', {})
      .then((status) => {
        if (live) setVersion(status.current)
      })
      .catch(() => {
        if (live) setVersion('unknown')
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <>
      <h3 className="settings-tab__section">About</h3>
      <div className="settings-tab__info">
        <div>
          <span>SUNA</span> {version}
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
      <UpdatesSection />
    </>
  )
}

interface SettingsCategory {
  id: string
  label: string
  blurb: string
  Pane: () => JSX.Element
}

const SETTINGS_CATEGORIES: readonly [SettingsCategory, ...SettingsCategory[]] = [
  {
    id: 'appearance',
    label: 'Appearance',
    blurb: 'Theme, scale and the shape of the window chrome.',
    Pane: AppearancePane
  },
  {
    id: 'editor',
    label: 'Editor',
    blurb: 'How Markdown opens, reads and saves.',
    Pane: EditorPane
  },
  {
    id: 'figures',
    label: 'Figures & preview',
    blurb: 'The profile previews render as, and how new figures are sized.',
    Pane: FiguresPane
  },
  {
    id: 'export',
    label: 'Export',
    blurb: 'Defaults a new export starts from; a journal profile still wins.',
    Pane: ExportPane
  },
  { id: 'ai', label: 'AI', blurb: 'Which agent answers, and how hard it thinks.', Pane: AiPane },
  {
    id: 'references',
    label: 'References',
    blurb: 'Literature providers, contact email, and where PDFs may be found.',
    Pane: ReferencesPane
  },
  {
    id: 'tools',
    label: 'Terminal & Python',
    blurb: 'The shell terminals open, and the environment scripts run in.',
    Pane: ToolsPane
  },
  {
    id: 'version-control',
    label: 'Version control',
    blurb: 'GitHub sign-in, the commit identity git will record, and SSH keys.',
    Pane: VersionControlPane
  },
  {
    id: 'trash',
    label: 'Trash',
    blurb: 'Which deletions stay restorable, and for how long.',
    Pane: TrashPane
  },
  { id: 'about', label: 'About', blurb: 'This build, and updates to it.', Pane: AboutPane }
]

/* --------------------------------------------------------------------------
   "Global (all projects)" — a couple of new typography rows live through the
   same resolver (useResolved + setGlobal) so the Settings page can show the
   DECISIONS 2026-08-15 defaults (14px / 1.6); everything else here is the
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
  const setSetting = useSettingsStore((s) => s.set)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const num = Number(draft)
    if (Number.isFinite(num) && num >= min && num <= max) {
      if (num !== value) void setSetting(settingKey, num)
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
  const setSetting = useSettingsStore((s) => s.set)

  return (
    <div className="settings-tab__row">
      <label htmlFor="set-body-font">
        Body font
        <span className="settings-tab__hint">Reading-mode body font; source view stays monospace.</span>
      </label>
      <select
        id="set-body-font"
        value={value}
        onChange={(e) => void setSetting('editor.fontFamily', e.target.value as EditorFontFamily)}
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

/**
 * A global-scope select over one resolved key. Shows the RESOLVED value and
 * writes the GLOBAL level, so a project override makes the control read back
 * the project's value — the badge says which level won, the same honesty the
 * quick-settings popover applies to vim motions.
 */
function GlobalAiChoiceFields(): JSX.Element {
  const { value: model, source: modelSource } = useResolved('ai.model')
  const { value: effort, source: effortSource } = useResolved('ai.effort')
  const setSetting = useSettingsStore((s) => s.set)

  return (
    <>
      <div className="settings-tab__row">
        <label htmlFor="set-ai-model">
          Model
          <span className="settings-tab__hint">
            Model tier for every AI call. A project can override it in suna.json.
          </span>
        </label>
        <div className="settings__control">
          <select
            id="set-ai-model"
            value={model}
            onChange={(e) => void setSetting('ai.model', e.target.value as AiModel)}
          >
            {AI_MODELS.map((id) => (
              <option key={id} value={id}>
                {AI_MODEL_LABELS[id]}
              </option>
            ))}
          </select>
          <SourceBadge source={modelSource} />
        </div>
      </div>
      <div className="settings-tab__row">
        <label htmlFor="set-ai-effort">
          Effort
          <span className="settings-tab__hint">
            How hard it thinks before answering. Higher costs more and takes longer.
          </span>
        </label>
        <div className="settings__control">
          <select
            id="set-ai-effort"
            value={effort}
            onChange={(e) => void setSetting('ai.effort', e.target.value as AiEffort)}
          >
            {AI_EFFORTS.map((id) => (
              <option key={id} value={id}>
                {AI_EFFORT_LABELS[id]}
              </option>
            ))}
          </select>
          <SourceBadge source={effortSource} />
        </div>
      </div>
    </>
  )
}

/**
 * Deleting from the UI has two outcomes, and this section is where the line
 * between them is drawn: a file at or under the size limit goes to the
 * project's own trash and stays restorable for the retention window; a
 * directory, or a file over the limit, goes straight to the system trash.
 * The trash itself is per-project (it lives in `.suna/trash/`); the POLICY is
 * global — a recycle bin whose rules changed per project is a bin nobody
 * trusts.
 */
function TrashSection(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const settings = useSettingsStore((s) => s.settings)
  const setSetting = useSettingsStore((s) => s.set)
  const [sizeDraft, setSizeDraft] = useState(String(settings['trash.maxFileMb']))
  const [daysDraft, setDaysDraft] = useState(String(settings['trash.retentionDays']))

  useEffect(() => {
    setSizeDraft(String(settings['trash.maxFileMb']))
  }, [settings])

  useEffect(() => {
    setDaysDraft(String(settings['trash.retentionDays']))
  }, [settings])

  const commit = (
    key: 'trash.maxFileMb' | 'trash.retentionDays',
    draft: string,
    limits: { min: number; max: number },
    reset: (value: string) => void
  ): void => {
    const num = Number(draft)
    if (Number.isFinite(num) && num >= limits.min && num <= limits.max) {
      if (num !== settings[key]) void setSetting(key, num)
    } else {
      reset(String(settings[key]))
    }
  }

  return (
    <>
      <div className="settings-tab__row">
        <label htmlFor="set-trash-size">
          Keep files under
          <span className="settings-tab__hint">
            Megabytes. Deleted files this size or smaller — Markdown, JSON, BibTeX, LaTeX, SVG —
            go to SUNA&apos;s trash and can be restored. Bigger files and folders go straight to
            the system trash. 0 sends everything to the system trash.
          </span>
        </label>
        <input
          id="set-trash-size"
          type="number"
          min={TRASH_LIMITS.maxFileMb.min}
          max={TRASH_LIMITS.maxFileMb.max}
          step={0.5}
          value={sizeDraft}
          onChange={(e) => setSizeDraft(e.target.value)}
          onBlur={() => commit('trash.maxFileMb', sizeDraft, TRASH_LIMITS.maxFileMb, setSizeDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit('trash.maxFileMb', sizeDraft, TRASH_LIMITS.maxFileMb, setSizeDraft)
            }
          }}
        />
      </div>
      <div className="settings-tab__row">
        <label htmlFor="set-trash-days">
          Keep them for
          <span className="settings-tab__hint">
            Days before a trashed file is passed on to the system trash. Changing this applies to
            files deleted from now on — what is already in the trash keeps the window it was given.
          </span>
        </label>
        <input
          id="set-trash-days"
          type="number"
          min={TRASH_LIMITS.retentionDays.min}
          max={TRASH_LIMITS.retentionDays.max}
          step={1}
          value={daysDraft}
          onChange={(e) => setDaysDraft(e.target.value)}
          onBlur={() =>
            commit('trash.retentionDays', daysDraft, TRASH_LIMITS.retentionDays, setDaysDraft)
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit('trash.retentionDays', daysDraft, TRASH_LIMITS.retentionDays, setDaysDraft)
            }
          }}
        />
      </div>
      <div className="settings-tab__row">
        <label>
          Trash
          <span className="settings-tab__hint">
            Each project keeps its own trash, in <code>.suna/trash/</code> beside its files
            (git-ignored). Restore deleted files, or empty it, from there.
          </span>
        </label>
        <button
          type="button"
          disabled={rootDir === null}
          onClick={() => {
            if (rootDir !== null) openTrashTab(rootDir)
          }}
        >
          Open Trash
        </button>
      </div>
    </>
  )
}

/** Global Settings dock tab, persisted app-wide via settings:get / settings:set. */
export function SettingsTab(): JSX.Element {
  const loaded = useSettingsStore((s) => s.loaded)
  const error = useSettingsStore((s) => s.error)
  const load = useSettingsStore((s) => s.load)
  const configPath = useSettingsStore((s) => s.path)
  const [activeId, setActiveId] = useState(SETTINGS_CATEGORIES[0].id)

  useEffect(() => {
    void load()
  }, [load])

  const active = SETTINGS_CATEGORIES.find((c) => c.id === activeId) ?? SETTINGS_CATEGORIES[0]
  const Pane = active.Pane

  return (
    <div className="settings-tab">
      <nav className="settings-tab__nav" aria-label="Settings categories">
        <div className="settings-tab__nav-title">Settings</div>
        {SETTINGS_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            data-category={category.id}
            className={
              category.id === active.id
                ? 'settings-tab__nav-item settings-tab__nav-item--active'
                : 'settings-tab__nav-item'
            }
            aria-current={category.id === active.id}
            onClick={() => setActiveId(category.id)}
          >
            {category.label}
          </button>
        ))}
      </nav>

      <div className="settings-tab__panel">
        <div className="settings-tab__page">
          <h1 className="settings-tab__title">{active.label}</h1>
          <p className="settings-tab__sub">
            {active.blurb} Everything here is stored in <code>~/.suna/config.yml</code>
            {!loaded && ' — loading…'}
          </p>
          {error !== null && <div className="settings-tab__error">{error}</div>}

          <section className="settings__scope" data-scope={active.id}>
            <Pane />
          </section>

          <div className="settings__footer">
            <p className="settings__footer-note">
              Every setting here lives in <code>{configPath}</code>, fully commented. Editing it by
              hand and using these controls are the same thing — the file is watched, and the
              controls write into it without disturbing your comments.
            </p>
            <button
              type="button"
              className="btn"
              disabled={configPath === ''}
              onClick={() => openFileTab(configPath)}
            >
              Open config.yml
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
