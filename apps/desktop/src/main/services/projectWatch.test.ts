import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FSWatcher } from 'node:fs'
import {
  MANIFEST_DEBOUNCE_MS,
  isManifestEvent,
  stopWatchingProjectManifest,
  watchProjectManifest,
  watchedProjectDir,
  type WatchFactory
} from './projectWatch'

/** A stand-in for fs.FSWatcher that records what it was asked to watch. */
function fakeWatcher(): {
  factory: WatchFactory
  watchedDirs: string[]
  closed: number
  fire: (filename: string | null) => void
} {
  const state = {
    watchedDirs: [] as string[],
    closed: 0,
    listener: null as ((event: string, filename: string | null) => void) | null
  }
  const factory: WatchFactory = (dir, listener) => {
    state.watchedDirs.push(dir)
    state.listener = listener
    return {
      close: () => {
        state.closed += 1
      },
      on: () => undefined
    } as unknown as FSWatcher
  }
  return {
    factory,
    get watchedDirs() {
      return state.watchedDirs
    },
    get closed() {
      return state.closed
    },
    fire: (filename) => state.listener?.('change', filename)
  }
}

afterEach(() => {
  stopWatchingProjectManifest()
  vi.useRealTimers()
})

describe('isManifestEvent', () => {
  it('matches the manifest basename', () => {
    expect(isManifestEvent('/p/suna.json', 'suna.json')).toBe(true)
  })

  it('ignores other files in the project root', () => {
    expect(isManifestEvent('/p/suna.json', 'manuscript.json')).toBe(false)
    expect(isManifestEvent('/p/suna.json', 'references.bib')).toBe(false)
  })

  it('treats a null filename as "might be the manifest"', () => {
    // Some platforms report no filename; a spurious re-read is harmless
    // (the renderer only re-reads and re-resolves) and missing one is not.
    expect(isManifestEvent('/p/suna.json', null)).toBe(true)
  })
})

describe('watchProjectManifest', () => {
  it('watches the project DIRECTORY, not the manifest file', () => {
    // Every writer here is temp-file + rename, which replaces the inode: a
    // watch bound to the file would go silent after the first atomic write.
    const fake = fakeWatcher()
    expect(watchProjectManifest('/proj', () => undefined, fake.factory)).toBe(true)
    expect(fake.watchedDirs).toEqual(['/proj'])
    expect(watchedProjectDir()).toBe('/proj')
  })

  it('notifies with the project dir after the debounce', () => {
    vi.useFakeTimers()
    const fake = fakeWatcher()
    const notify = vi.fn()
    watchProjectManifest('/proj', notify, fake.factory)
    fake.fire('suna.json')
    expect(notify).not.toHaveBeenCalled()
    vi.advanceTimersByTime(MANIFEST_DEBOUNCE_MS + 1)
    expect(notify).toHaveBeenCalledExactlyOnceWith('/proj')
  })

  it('coalesces the burst an atomic write produces into one notification', () => {
    vi.useFakeTimers()
    const fake = fakeWatcher()
    const notify = vi.fn()
    watchProjectManifest('/proj', notify, fake.factory)
    fake.fire('suna.json')
    fake.fire('suna.json')
    fake.fire('suna.json')
    vi.advanceTimersByTime(MANIFEST_DEBOUNCE_MS + 1)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not notify for an unrelated file', () => {
    vi.useFakeTimers()
    const fake = fakeWatcher()
    const notify = vi.fn()
    watchProjectManifest('/proj', notify, fake.factory)
    fake.fire('manuscript.json')
    vi.advanceTimersByTime(MANIFEST_DEBOUNCE_MS + 1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('replaces the previous watch when the open project changes', () => {
    const fake = fakeWatcher()
    watchProjectManifest('/one', () => undefined, fake.factory)
    watchProjectManifest('/two', () => undefined, fake.factory)
    expect(fake.watchedDirs).toEqual(['/one', '/two'])
    expect(fake.closed).toBe(1)
    expect(watchedProjectDir()).toBe('/two')
  })

  it('re-watching the same project is a no-op', () => {
    const fake = fakeWatcher()
    watchProjectManifest('/one', () => undefined, fake.factory)
    watchProjectManifest('/one', () => undefined, fake.factory)
    expect(fake.watchedDirs).toEqual(['/one'])
    expect(fake.closed).toBe(0)
  })

  it('stops watching on null', () => {
    const fake = fakeWatcher()
    watchProjectManifest('/one', () => undefined, fake.factory)
    expect(watchProjectManifest(null, () => undefined, fake.factory)).toBe(false)
    expect(fake.closed).toBe(1)
    expect(watchedProjectDir()).toBe(null)
  })

  it('reports failure instead of throwing when the directory cannot be watched', () => {
    const throwing: WatchFactory = () => {
      throw new Error('ENOENT')
    }
    // A project must still open without a watcher — best effort by design.
    expect(watchProjectManifest('/gone', () => undefined, throwing)).toBe(false)
    expect(watchedProjectDir()).toBe(null)
  })

  it('drops a notification queued for a project that was replaced', () => {
    vi.useFakeTimers()
    const fake = fakeWatcher()
    const notify = vi.fn()
    watchProjectManifest('/one', notify, fake.factory)
    fake.fire('suna.json')
    watchProjectManifest('/two', notify, fake.factory)
    vi.advanceTimersByTime(MANIFEST_DEBOUNCE_MS + 1)
    expect(notify).not.toHaveBeenCalled()
  })
})
