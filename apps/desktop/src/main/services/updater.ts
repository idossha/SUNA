import { BrowserWindow, app, net, shell } from 'electron'
import { EVENT_CHANNELS, type UpdateMode, type UpdateStatus } from '@suna/core'
import { readSettings, writeSettings } from './settings'
import { currentConfig } from './userconfig'

/**
 * IN-APP UPDATES (ARCHITECTURE §23) — notice a published GitHub Release, say
 * so, and act only when the user says so.
 *
 * The split every other service here keeps: **main owns the network and the
 * installer, the renderer sees small JSON** — a phase, two version strings, a
 * progress pair, an error message. Nothing pushes bytes over IPC, and nothing
 * installs without an `update:install` call carrying a click.
 *
 * Three postures, decided once per launch by {@link updateMode}:
 *
 *  * `'inplace'` — electron-updater can replace this install: macOS (the
 *    signed `.zip` beside every `.dmg` is the update artifact) and a Linux
 *    AppImage. `downloadUpdate` streams it, `quitAndInstall` applies it, and
 *    `autoInstallOnAppQuit` means even "Later" lands on the next quit.
 *  * `'notify'` — a `.deb` or `.tar.gz` belongs to the package manager (or to
 *    whoever unpacked it), so SUNA only checks and offers the Releases page.
 *    The check reads the same `latest-linux.yml` electron-updater would, over
 *    `net.fetch`, so the two paths can never disagree about what is newest.
 *  * `'off'` — a dev tree (`!app.isPackaged`) or a driven test run
 *    (`SUNA_HIDDEN=1`) has nothing to replace and nobody to answer. It does
 *    not check, and it says so rather than pretending.
 *
 * Everything else is refusal: the launch check honours `updates.checkOnLaunch`
 * and stays silent about a version the user skipped; a manual check ignores
 * the skip, because asking again *is* un-skipping.
 *
 * electron-updater arrives by dynamic import inside {@link realImpl}, so the
 * unit tests inject an {@link UpdaterImpl} and never load it — and therefore
 * never reach the network.
 */

/** Where a `'notify'` check reads, and where its button lands. One repo, said once. */
const RELEASES_URL = 'https://github.com/idossha/SUNA/releases'
const FEED_LATEST_LINUX =
  'https://github.com/idossha/SUNA/releases/latest/download/latest-linux.yml'

/** settings.json (machine state, not configuration): the one version to stay quiet about. */
const SKIPPED_KEY = 'updates.skippedVersion'

/** The slice of electron-updater's `AppUpdater` this module drives; injected whole by the tests. */
export interface UpdaterImpl {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  on(event: string, listener: (payload: never) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

/** How a `'notify'` check fetches — injectable so the tests need no server. */
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>

export interface UpdaterDeps {
  /** `null` means "load the real electron-updater on first use". */
  impl?: UpdaterImpl | null
  fetchImpl?: FetchLike
  platform?: NodeJS.Platform
  /** Linux only: set for an AppImage launch, absent for `.deb`/`.tar.gz`. */
  appImage?: string | undefined
  packaged?: boolean
  /** A hidden, driven run (SUNA_HIDDEN=1): no human, so no check. */
  hidden?: boolean
  version?: string
  onStatus?: (status: UpdateStatus) => void
  /** `updates.checkOnLaunch`; injectable so a test needs no ~/.suna. */
  checkOnLaunch?: () => Promise<boolean>
  /** The launch check's grace delay, injectable so the tests need no clock. */
  scheduleLaunchCheck?: (run: () => void) => void
  openReleases?: () => void
}

/** `{ ok, error? }`, like every other action result on the bridge; it never throws. */
export interface UpdateActionResult {
  ok: boolean
  error?: string
}

/**
 * Which posture this launch takes. Decided from facts, never from preference:
 * `updates.checkOnLaunch` gates the AUTOMATIC check only, so a user who
 * switched it off can still ask by hand.
 *
 * Deliberately NOT a signing check. A packaged-but-unsigned contributor build
 * is `'inplace'` and will check; on macOS Squirrel then refuses the swap at
 * install time, which surfaces honestly as an 'error' phase.
 */
export function updateMode(opts: {
  packaged: boolean
  hidden: boolean
  platform: NodeJS.Platform
  appImage: string | undefined
}): UpdateMode {
  if (!opts.packaged || opts.hidden) return 'off'
  if (opts.platform === 'linux' && (opts.appImage === undefined || opts.appImage === '')) {
    return 'notify'
  }
  return 'inplace'
}

/**
 * Compare two semver-ish versions. Numeric segments numerically, and a
 * prerelease (`1.2.0-rc.1`) sorts BELOW its release — so a user on the rc is
 * offered 1.2.0, and a user on 1.2.0 is never offered the rc back.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): { nums: number[]; pre: string } => {
    const [core = '', ...rest] = v.replace(/^v/, '').split('-')
    return {
      nums: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre: rest.join('-')
    }
  }
  const left = split(a)
  const right = split(b)
  for (let i = 0; i < Math.max(left.nums.length, right.nums.length); i += 1) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  if (left.pre === right.pre) return 0
  if (left.pre === '') return 1
  if (right.pre === '') return -1
  return left.pre < right.pre ? -1 : 1
}

/**
 * Release notes, reduced to plain text. The GitHub provider hands the release
 * body back as HTML; the UI renders text, because nothing renderer-side may
 * interpret markup that came off the network. Tags out, entities back,
 * whitespace collapsed to the paragraph breaks that survive.
 */
export function plainNotes(raw: unknown): string | undefined {
  const text = Array.isArray(raw)
    ? raw
        .map((note) =>
          typeof note === 'object' && note !== null
            ? String((note as { note?: unknown }).note ?? '')
            : String(note)
        )
        .join('\n')
    : typeof raw === 'string'
      ? raw
      : undefined
  if (text === undefined || text === '') return undefined
  const out = text
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out === '' ? undefined : out.slice(0, 16 * 1024)
}

/**
 * The version a `latest-linux.yml` names. A one-key read rather than a YAML
 * dependency: the file is electron-builder's own and its `version:` line is a
 * bare semver.
 */
export function feedVersion(yml: string): string | null {
  const match = /^version:\s*['"]?([0-9][^'"\s]*)/m.exec(yml)
  return match?.[1] ?? null
}

const defaultFetch: FetchLike = (url, init) => net.fetch(url, init)

export class UpdaterService {
  private readonly deps: UpdaterDeps
  readonly mode: UpdateMode
  private status: UpdateStatus
  private impl: UpdaterImpl | null
  private implWired = false
  private checking: Promise<UpdateStatus> | null = null
  /** What the in-flight or last check was: only the launch check honours a skip. */
  private auto = false
  /**
   * The skipped version, read ONCE at the top of each check.
   *
   * Not read inside `announce`: electron-updater's `update-available` fires
   * while `checkForUpdates()` is still running, so an async read there would
   * settle after `checkInPlace` had already concluded "nothing newer" and the
   * announcement would be lost.
   */
  private skipped = ''

  constructor(deps: UpdaterDeps = {}) {
    this.deps = deps
    this.mode = updateMode({
      packaged: deps.packaged ?? app.isPackaged,
      hidden: deps.hidden ?? process.env['SUNA_HIDDEN'] === '1',
      platform: deps.platform ?? process.platform,
      appImage: deps.appImage ?? process.env['APPIMAGE']
    })
    this.impl = deps.impl ?? null
    this.status = {
      phase: 'idle',
      current: deps.version ?? app.getVersion(),
      mode: this.mode
    }
  }

  /** The renderer's pull — on mount, and on every open of the Settings tab. */
  current(): UpdateStatus {
    return this.status
  }

  /**
   * The launch check. Scheduled, not awaited: a network round trip has no
   * business gating first paint, and the renderer subscribes long before an
   * answer could arrive.
   */
  startLaunchCheck(): void {
    if (this.mode === 'off') return
    const run = (): void => {
      void this.launchPreference().then((allowed) => {
        // Both conditions are re-read at fire time: six seconds is long enough
        // for the user to have opened Settings, checked by hand and pressed
        // Download, and a scheduled check must not stomp on any of that.
        if (allowed && this.status.phase === 'idle') void this.check({ auto: true })
      })
    }
    ;(this.deps.scheduleLaunchCheck ?? ((fn: () => void) => setTimeout(fn, 6000).unref?.()))(run)
  }

  /**
   * Ask the feed. `auto` is the launch check: it says nothing about a version
   * the user skipped, and its errors stay in the status. A manual check
   * reports everything and clears the skip, so tomorrow's launch check agrees.
   */
  check(opts: { auto?: boolean } = {}): Promise<UpdateStatus> {
    if (this.mode === 'off') return Promise.resolve(this.push({ phase: 'idle' }))
    // Never over a download: a 'checking' push would blank the progress the
    // user is watching, and nothing a check could learn beats the artifact
    // already arriving. Same for 'downloaded' — the verified file is the answer.
    if (this.status.phase === 'downloading' || this.status.phase === 'downloaded') {
      return Promise.resolve(this.status)
    }
    if (this.checking !== null) {
      // A manual ask joining an in-flight launch check UPGRADES it: a skip must
      // not silence an answer the user just requested by hand.
      if (opts.auto !== true && this.auto) {
        this.auto = false
        this.skipped = ''
        void this.clearSkip()
      }
      return this.checking
    }
    // `this.checking` is assigned SYNCHRONOUSLY, before the first await: the
    // settings read below is I/O, and two clicks a millisecond apart would
    // otherwise both get past this guard and run two checks.
    this.auto = opts.auto === true
    this.push({ phase: 'checking', error: undefined })
    this.checking = this.runCheck().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async runCheck(): Promise<UpdateStatus> {
    // A manual check clears the skip: asking again IS un-skipping, and
    // tomorrow's launch check must agree with what the user just did.
    this.skipped = this.auto ? await this.skippedVersion() : ''
    if (!this.auto) await this.clearSkip()
    return this.mode === 'inplace' ? this.checkInPlace() : this.checkNotify()
  }

  /** The user's click on Download. `'inplace'` only — `'notify'` opens the page instead. */
  async download(): Promise<UpdateActionResult> {
    if (this.mode !== 'inplace' || this.status.phase !== 'available') {
      return { ok: false, error: 'no update is ready to download' }
    }
    try {
      const impl = await this.wiredImpl()
      this.push({ phase: 'downloading', received: 0, total: this.status.total })
      await impl.downloadUpdate()
      // 'update-downloaded' has normally pushed 'downloaded' already; this
      // covers an impl that resolves without eventing. `current()`, not
      // `this.status`: the guard's narrowing does not know the await moved it.
      if (this.current().phase === 'downloading') this.push({ phase: 'downloaded' })
      return { ok: true }
    } catch (error) {
      this.push({ phase: 'error', error: errorText(error) })
      return { ok: false, error: errorText(error) }
    }
  }

  /** Restart into the update — or, in `'notify'` mode, open the Releases page. */
  async install(): Promise<UpdateActionResult> {
    if (this.mode === 'notify') {
      ;(this.deps.openReleases ?? (() => void shell.openExternal(RELEASES_URL)))()
      return { ok: true }
    }
    if (this.status.phase !== 'downloaded') {
      return { ok: false, error: 'no update has been downloaded' }
    }
    try {
      const impl = await this.wiredImpl()
      impl.quitAndInstall()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  }

  /**
   * "Skip this version": the launch check stays quiet about exactly this one.
   * A newer release announces itself again.
   */
  async skip(version: string): Promise<UpdateStatus> {
    if (version !== '') await writeSettings({ [SKIPPED_KEY]: version })
    return this.push({ phase: 'idle', available: undefined, notes: undefined })
  }

  // ---------------------------------------------------------------------------

  private async checkInPlace(): Promise<UpdateStatus> {
    try {
      const impl = await this.wiredImpl()
      await impl.checkForUpdates()
      // The events pushed 'available'/'none' already; a resolve with neither
      // means the provider answered with nothing newer.
      if (this.status.phase === 'checking') return this.push({ phase: 'none' })
      return this.status
    } catch (error) {
      return this.push({ phase: 'error', error: errorText(error) })
    }
  }

  /** `.deb`/`.tar.gz`: read the feed, compare, and only ever *say*. */
  private async checkNotify(): Promise<UpdateStatus> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      let text: string
      try {
        const response = await (this.deps.fetchImpl ?? defaultFetch)(FEED_LATEST_LINUX, {
          signal: controller.signal
        })
        if (!response.ok) throw new Error(`feed answered ${response.status}`)
        // The timer stays armed across the body read: net.fetch resolves at the
        // HEADERS, and a body that stalls after them would otherwise hang this
        // promise — and with it `checking`, which every later check coalesces on.
        text = await response.text()
      } finally {
        clearTimeout(timer)
      }
      const version = feedVersion(text)
      if (version === null) throw new Error('the feed carried no version')
      if (compareVersions(version, this.status.current) > 0) {
        return this.announce(version, undefined)
      }
      return this.push({ phase: 'none', available: version })
    } catch (error) {
      return this.push({ phase: 'error', error: errorText(error) })
    }
  }

  /** One gate for both feeds: the launch check drops a skipped version, silently. */
  private announce(version: string, notes: string | undefined): UpdateStatus {
    if (this.auto && this.skipped === version) {
      return this.push({ phase: 'idle', available: undefined, notes: undefined })
    }
    return this.push({ phase: 'available', available: version, notes })
  }

  private async launchPreference(): Promise<boolean> {
    if (this.deps.checkOnLaunch !== undefined) return this.deps.checkOnLaunch()
    try {
      const { settings } = await currentConfig()
      return settings['updates.checkOnLaunch']
    } catch {
      // An unreadable config is not permission to reach the network.
      return false
    }
  }

  private async skippedVersion(): Promise<string> {
    const value = (await readSettings())[SKIPPED_KEY]
    return typeof value === 'string' ? value : ''
  }

  private async clearSkip(): Promise<void> {
    if ((await this.skippedVersion()) !== '') await writeSettings({ [SKIPPED_KEY]: null })
  }

  private async wiredImpl(): Promise<UpdaterImpl> {
    const impl = this.impl ?? (this.impl = await realImpl())
    if (!this.implWired) {
      this.implWired = true
      impl.autoDownload = false
      // "Later" still lands the update on the next quit — the least surprising
      // meaning of having pressed Download and then gone back to work.
      impl.autoInstallOnAppQuit = true
      impl.allowDowngrade = false
      impl.on('update-available', (info: { version?: string; releaseNotes?: unknown }) => {
        this.announce(String(info?.version ?? ''), plainNotes(info?.releaseNotes))
      })
      impl.on('update-not-available', () => void this.push({ phase: 'none' }))
      impl.on('download-progress', (progress: { transferred?: number; total?: number }) => {
        this.push({
          phase: 'downloading',
          received: typeof progress?.transferred === 'number' ? progress.transferred : 0,
          total: typeof progress?.total === 'number' ? progress.total : 0
        })
      })
      impl.on('update-downloaded', () => void this.push({ phase: 'downloaded' }))
      impl.on('error', (error: unknown) => {
        // A failure during a CHECK already becomes that check's own 'error'
        // status when the promise rejects; reporting it here too would say it
        // twice. Only a download failure has nobody else to surface it.
        if (this.status.phase === 'downloading') {
          this.push({ phase: 'error', error: errorText(error) })
        }
      })
    }
    return impl
  }

  private push(patch: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...patch, auto: this.auto }
    this.deps.onStatus?.(this.status)
    return this.status
  }
}

/** The real electron-updater, loaded only when a check actually runs. */
async function realImpl(): Promise<UpdaterImpl> {
  // A CJS package: under ESM the namespace puts `autoUpdater` on the default export.
  const mod = (await import('electron-updater')) as unknown as {
    default?: { autoUpdater?: UpdaterImpl }
    autoUpdater?: UpdaterImpl
  }
  const impl = mod.autoUpdater ?? mod.default?.autoUpdater
  if (impl === undefined) throw new Error('electron-updater did not export autoUpdater')
  return impl
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // The updater's network errors love a stack-shaped paragraph; the first line
  // carries the fact.
  return text.split('\n', 1)[0] ?? text
}

let singleton: UpdaterService | null = null

/**
 * The app's one updater, created on first use and broadcasting every status to
 * every open window (EVENT_CHANNELS.updateStatus). One app, one updater: two
 * would race each other into the same download directory.
 */
export function updaterService(): UpdaterService {
  singleton ??= new UpdaterService({
    onStatus: (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.isDestroyed()) {
          window.webContents.send(EVENT_CHANNELS.updateStatus, status)
        }
      }
    }
  })
  return singleton
}
