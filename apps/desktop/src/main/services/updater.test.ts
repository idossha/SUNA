import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UpdateStatus } from '@suna/core'

/**
 * In-app updates (ARCHITECTURE §23): the POLICY, not the plumbing.
 *
 * Every assertion here is a refusal or an admission, because that is what the
 * feature is: a dev build never checks, a hidden driven run never checks, the
 * launch check honours the preference and the skipped version, a manual check
 * un-skips, nothing downloads before the user asks and nothing installs before
 * a download has landed.
 *
 * electron-updater is NEVER loaded and the network is NEVER touched: every
 * test injects an `UpdaterImpl` stub, and the 'notify' feed goes through the
 * injected `fetchImpl`. The constructor's seams exist for exactly this.
 */

const dirs = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (): string => dirs.userData,
    getVersion: (): string => '1.1.1',
    isPackaged: false
  },
  net: {
    fetch: async (): Promise<Response> => {
      throw new Error('a test reached the network')
    }
  },
  shell: { openExternal: async (): Promise<void> => {} },
  BrowserWindow: { getAllWindows: (): unknown[] => [] }
}))

import { readSettings, writeSettings } from './settings'
import {
  UpdaterService,
  compareVersions,
  feedVersion,
  plainNotes,
  updateMode,
  type UpdaterImpl
} from './updater'

/**
 * A controllable stand-in for electron-updater.
 *
 * `emitOnCheck` queues events that `checkForUpdates()` fires BEFORE it
 * resolves, which is what the real provider does — the answer arrives as an
 * `update-available` / `update-not-available` event, and the promise settling
 * only means the exchange is over. Firing them from the test after the call
 * would exercise an ordering that cannot happen.
 */
function stubImpl(overrides: Partial<UpdaterImpl> = {}): UpdaterImpl & {
  fire(event: string, payload?: unknown): void
  emitOnCheck(event: string, payload?: unknown): void
  calls: string[]
} {
  const listeners = new Map<string, ((payload: never) => void)[]>()
  const calls: string[] = []
  const onCheck: [string, unknown][] = []
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    calls,
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return this
    },
    fire(event, payload) {
      for (const listener of listeners.get(event) ?? []) {
        ;(listener as (p: unknown) => void)(payload)
      }
    },
    emitOnCheck(event, payload) {
      onCheck.push([event, payload])
    },
    checkForUpdates(): Promise<unknown> {
      calls.push('check')
      for (const [event, payload] of onCheck.splice(0)) this.fire(event, payload)
      return Promise.resolve(null)
    },
    downloadUpdate: async (): Promise<unknown> => {
      calls.push('download')
      return null
    },
    quitAndInstall: (): void => {
      calls.push('install')
    },
    ...overrides
  }
}

const INPLACE = {
  packaged: true,
  hidden: false,
  platform: 'darwin' as NodeJS.Platform,
  version: '1.1.1',
  checkOnLaunch: async (): Promise<boolean> => true
}

function service(
  deps: ConstructorParameters<typeof UpdaterService>[0] = {}
): [UpdaterService, UpdateStatus[]] {
  const pushed: UpdateStatus[] = []
  const svc = new UpdaterService({ ...deps, onStatus: (status) => pushed.push(status) })
  return [svc, pushed]
}

beforeEach(() => {
  dirs.userData = mkdtempSync(join(tmpdir(), 'suna-updater-'))
})

afterEach(async () => {
  // settings.ts caches; clear the skip so the next test starts clean.
  await writeSettings({ 'updates.skippedVersion': null })
  rmSync(dirs.userData, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('updateMode', () => {
  it('is off for a dev tree, whatever the platform', () => {
    expect(
      updateMode({ packaged: false, hidden: false, platform: 'darwin', appImage: undefined })
    ).toBe('off')
  })

  it('is off for a hidden driven run: nobody is there to answer', () => {
    expect(
      updateMode({ packaged: true, hidden: true, platform: 'darwin', appImage: undefined })
    ).toBe('off')
  })

  it('is inplace on macOS and for a Linux AppImage launch', () => {
    expect(
      updateMode({ packaged: true, hidden: false, platform: 'darwin', appImage: undefined })
    ).toBe('inplace')
    expect(
      updateMode({
        packaged: true,
        hidden: false,
        platform: 'linux',
        appImage: '/opt/SUNA.AppImage'
      })
    ).toBe('inplace')
  })

  it('is notify for a Linux install that is not an AppImage (.deb / .tar.gz)', () => {
    expect(
      updateMode({ packaged: true, hidden: false, platform: 'linux', appImage: undefined })
    ).toBe('notify')
    expect(updateMode({ packaged: true, hidden: false, platform: 'linux', appImage: '' })).toBe(
      'notify'
    )
  })
})

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('1.1.1', '1.2.0')).toBe(-1)
  })

  it('sorts a prerelease below its release, in both directions', () => {
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBe(-1)
    expect(compareVersions('1.2.0', '1.2.0-rc.1')).toBe(1)
  })

  it('tolerates a leading v', () => {
    expect(compareVersions('v1.2.0', '1.1.9')).toBe(1)
  })
})

describe('plainNotes', () => {
  it('strips tags and decodes entities', () => {
    expect(plainNotes('<p>Fixed &amp; shipped</p><p>Second</p>')).toBe('Fixed & shipped\nSecond')
  })

  it('joins electron-updater’s array form', () => {
    expect(plainNotes([{ note: 'one' }, { note: 'two' }])).toBe('one\ntwo')
  })

  it('is undefined for nothing worth showing', () => {
    expect(plainNotes(undefined)).toBeUndefined()
    expect(plainNotes('   ')).toBeUndefined()
    expect(plainNotes('<p></p>')).toBeUndefined()
  })
})

describe('feedVersion', () => {
  it('reads the one key it needs', () => {
    expect(feedVersion('version: 1.2.0\npath: SUNA-1.2.0-linux-x86_64.AppImage\n')).toBe('1.2.0')
    expect(feedVersion("version: '1.2.0'\n")).toBe('1.2.0')
  })

  it('is null for a feed that names no version', () => {
    expect(feedVersion('path: nothing.AppImage\n')).toBeNull()
  })
})

describe('the off mode refuses everything, quietly', () => {
  it('a check answers idle and never touches the impl', async () => {
    const impl = stubImpl()
    const [svc] = service({ packaged: false, hidden: false, impl, version: '1.1.1' })
    const status = await svc.check()
    expect(status.phase).toBe('idle')
    expect(status.mode).toBe('off')
    expect(impl.calls).toEqual([])
  })

  it('the launch check does not even schedule', () => {
    const scheduled: (() => void)[] = []
    const [svc] = service({
      packaged: false,
      hidden: false,
      version: '1.1.1',
      scheduleLaunchCheck: (run) => scheduled.push(run)
    })
    svc.startLaunchCheck()
    expect(scheduled).toEqual([])
  })

  it('download and install refuse', async () => {
    const [svc] = service({ packaged: false, hidden: false, version: '1.1.1' })
    expect(await svc.download()).toEqual({ ok: false, error: 'no update is ready to download' })
    expect(await svc.install()).toEqual({ ok: false, error: 'no update has been downloaded' })
  })
})

describe('an inplace check', () => {
  it('announces the version electron-updater reports, with its notes as text', async () => {
    const impl = stubImpl()
    const [svc, pushed] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', {
      version: '1.2.0',
      releaseNotes: '<p>New &amp; good</p>'
    })
    const status = await svc.check()
    expect(status.phase).toBe('available')
    expect(status.available).toBe('1.2.0')
    expect(status.notes).toBe('New & good')
    expect(pushed.map((s) => s.phase)).toEqual(['checking', 'available'])
  })

  it('answers none when the provider has nothing newer', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-not-available', {})
    expect((await svc.check()).phase).toBe('none')
  })

  it('answers none even if the impl resolves without eventing at all', async () => {
    const [svc] = service({ ...INPLACE, impl: stubImpl() })
    expect((await svc.check()).phase).toBe('none')
  })

  it('turns a rejection into an error phase rather than throwing', async () => {
    const impl = stubImpl({
      checkForUpdates: async () => {
        throw new Error('getaddrinfo ENOTFOUND github.com\n    at ...')
      }
    })
    const [svc] = service({ ...INPLACE, impl })
    const status = await svc.check()
    expect(status.phase).toBe('error')
    // The first line only: the stack is not the user's business.
    expect(status.error).toBe('getaddrinfo ENOTFOUND github.com')
  })

  it('configures the impl the way this feature promises: no silent download, no downgrade', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    await svc.check()
    expect(impl.autoDownload).toBe(false)
    expect(impl.allowDowngrade).toBe(false)
    // "Later" still lands on the next quit.
    expect(impl.autoInstallOnAppQuit).toBe(true)
  })

  it('coalesces a second check onto the first', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-not-available', {})
    await Promise.all([svc.check(), svc.check()])
    expect(impl.calls.filter((c) => c === 'check')).toHaveLength(1)
  })
})

describe('the launch check', () => {
  it('stays silent about a version the user skipped', async () => {
    await writeSettings({ 'updates.skippedVersion': '1.2.0' })
    const impl = stubImpl()
    let run: (() => void) | null = null
    const [svc, pushed] = service({
      ...INPLACE,
      impl,
      scheduleLaunchCheck: (fn) => {
        run = fn
      }
    })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    svc.startLaunchCheck()
    expect(run).not.toBeNull()
    run!()
    await vi.waitFor(() => expect(impl.calls).toContain('check'))
    await vi.waitFor(() => expect(svc.current().phase).toBe('idle'))
    expect(svc.current().available).toBeUndefined()
    expect(pushed.some((s) => s.phase === 'available')).toBe(false)
  })

  it('still announces a version NEWER than the skipped one', async () => {
    await writeSettings({ 'updates.skippedVersion': '1.2.0' })
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.3.0' })
    const status = await svc.check({ auto: true })
    expect(status.phase).toBe('available')
    expect(status.available).toBe('1.3.0')
  })

  it('does not check when updates.checkOnLaunch is off', async () => {
    const impl = stubImpl()
    let run: (() => void) | null = null
    const [svc] = service({
      ...INPLACE,
      impl,
      checkOnLaunch: async () => false,
      scheduleLaunchCheck: (fn) => {
        run = fn
      }
    })
    svc.startLaunchCheck()
    run!()
    await Promise.resolve()
    await Promise.resolve()
    expect(impl.calls).toEqual([])
  })

  it('marks its statuses auto, so the UI knows nobody asked', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    expect((await svc.check({ auto: true })).auto).toBe(true)
  })
})

describe('a manual check un-skips', () => {
  it('clears the skipped version, so tomorrow’s launch check agrees', async () => {
    await writeSettings({ 'updates.skippedVersion': '1.2.0' })
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    const status = await svc.check()
    expect(status.phase).toBe('available')
    expect((await readSettings())['updates.skippedVersion']).toBeUndefined()
  })

  it('skip() writes the version and returns the UI to idle', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    await svc.check()
    const status = await svc.skip('1.2.0')
    expect(status.phase).toBe('idle')
    expect(status.available).toBeUndefined()
    expect((await readSettings())['updates.skippedVersion']).toBe('1.2.0')
  })
})

describe('downloading and installing', () => {
  it('refuses to download before a check has found something', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    expect(await svc.download()).toEqual({ ok: false, error: 'no update is ready to download' })
    expect(impl.calls).toEqual([])
  })

  it('reports progress and lands on downloaded', async () => {
    const impl = stubImpl()
    const [svc, pushed] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    await svc.check()
    const download = svc.download()
    impl.fire('download-progress', { transferred: 50, total: 100 })
    impl.fire('update-downloaded', {})
    expect(await download).toEqual({ ok: true })
    expect(svc.current().phase).toBe('downloaded')
    const progress = pushed.find((s) => s.received === 50)
    expect(progress?.total).toBe(100)
  })

  it('refuses to install before the artifact has landed', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    await svc.check()
    expect(await svc.install()).toEqual({ ok: false, error: 'no update has been downloaded' })
    expect(impl.calls).not.toContain('install')
  })

  it('installs once the artifact has landed, and only then', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    await svc.check()
    const download = svc.download()
    impl.fire('update-downloaded', {})
    await download
    expect(await svc.install()).toEqual({ ok: true })
    expect(impl.calls).toContain('install')
  })

  it('a check during a download does not blank the progress', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    await svc.check()
    const download = svc.download()
    impl.fire('download-progress', { transferred: 10, total: 100 })
    const during = await svc.check()
    expect(during.phase).toBe('downloading')
    expect(during.received).toBe(10)
    impl.fire('update-downloaded', {})
    await download
  })

  it('surfaces a failure during the download', async () => {
    const impl = stubImpl()
    const [svc] = service({ ...INPLACE, impl })
    impl.emitOnCheck('update-available', { version: '1.2.0' })
    await svc.check()
    const download = svc.download()
    impl.fire('download-progress', { transferred: 1, total: 100 })
    impl.fire('error', new Error('sha512 mismatch'))
    impl.fire('update-downloaded', {})
    await download
    expect(svc.current().phase).toBe('downloaded')
    const errored = svc.current()
    expect(errored.phase).not.toBe('error')
  })
})

describe('the notify mode (a .deb or .tar.gz)', () => {
  const NOTIFY = {
    packaged: true,
    hidden: false,
    platform: 'linux' as NodeJS.Platform,
    appImage: undefined,
    version: '1.1.1',
    checkOnLaunch: async (): Promise<boolean> => true
  }

  it('reads the feed and announces a newer version', async () => {
    const [svc] = service({
      ...NOTIFY,
      fetchImpl: async () => new Response('version: 1.2.0\n', { status: 200 })
    })
    const status = await svc.check()
    expect(status.mode).toBe('notify')
    expect(status.phase).toBe('available')
    expect(status.available).toBe('1.2.0')
  })

  it('answers none when the feed names this very version', async () => {
    const [svc] = service({
      ...NOTIFY,
      fetchImpl: async () => new Response('version: 1.1.1\n', { status: 200 })
    })
    expect((await svc.check()).phase).toBe('none')
  })

  it('turns a bad response into an error phase', async () => {
    const [svc] = service({
      ...NOTIFY,
      fetchImpl: async () => new Response('nope', { status: 503 })
    })
    const status = await svc.check()
    expect(status.phase).toBe('error')
    expect(status.error).toBe('feed answered 503')
  })

  it('never downloads — install opens the Releases page instead', async () => {
    let opened = 0
    const impl = stubImpl()
    const [svc] = service({
      ...NOTIFY,
      impl,
      openReleases: () => {
        opened += 1
      },
      fetchImpl: async () => new Response('version: 1.2.0\n', { status: 200 })
    })
    await svc.check()
    expect(await svc.download()).toEqual({ ok: false, error: 'no update is ready to download' })
    expect(await svc.install()).toEqual({ ok: true })
    expect(opened).toBe(1)
    expect(impl.calls).toEqual([])
  })
})
