import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FSWatcher } from 'node:fs'
import {
  GIT_DEBOUNCE_MS,
  isRelevantGitEvent,
  stopWatchingGit,
  watchGitDir,
  watchedGitDir
} from './gitWatch'

interface FakeWatcher {
  fire: (filename: string | null) => void
  closed: () => boolean
  recursive: boolean
  dir: string
}

/** A watch factory that captures the listener so a test can fire events. */
function fakeFactory(options: { failRecursive?: boolean } = {}): {
  factory: Parameters<typeof watchGitDir>[2]
  made: FakeWatcher[]
} {
  const made: FakeWatcher[] = []
  const factory: Parameters<typeof watchGitDir>[2] = (dir, recursive, listener) => {
    if (recursive && options.failRecursive === true) {
      throw new Error('recursive watch not supported')
    }
    let closed = false
    const watcher = {
      close: () => {
        closed = true
      },
      on: () => watcher
    } as unknown as FSWatcher
    made.push({
      dir,
      recursive,
      fire: (filename) => listener('change', filename),
      closed: () => closed
    })
    return watcher
  }
  return { factory, made }
}

afterEach(() => {
  stopWatchingGit()
  vi.useRealTimers()
})

describe('isRelevantGitEvent', () => {
  it('accepts the files that change what Source Control shows', () => {
    expect(isRelevantGitEvent('index')).toBe(true)
    expect(isRelevantGitEvent('HEAD')).toBe(true)
    expect(isRelevantGitEvent('refs/heads/main')).toBe(true)
    expect(isRelevantGitEvent('packed-refs')).toBe(true)
    expect(isRelevantGitEvent('MERGE_HEAD')).toBe(true)
    expect(isRelevantGitEvent('rebase-merge/done')).toBe(true)
  })

  /**
   * `git remote add` and `git branch -u` write config and touch nothing else.
   * Without this the panel would show "no remote" — and keep Fetch, Pull and
   * Push greyed out — for as long as the window stayed focused.
   */
  it('accepts config, which is all a new remote changes', () => {
    expect(isRelevantGitEvent('config')).toBe(true)
    expect(isRelevantGitEvent('config.lock')).toBe(false)
  })

  it('ignores the object churn a single commit produces', () => {
    expect(isRelevantGitEvent('objects/ab/cdef0123')).toBe(false)
    expect(isRelevantGitEvent('logs/HEAD')).toBe(false)
    expect(isRelevantGitEvent('COMMIT_EDITMSG')).toBe(false)
  })

  it('ignores lock files, which exist only mid-write', () => {
    expect(isRelevantGitEvent('index.lock')).toBe(false)
    expect(isRelevantGitEvent('refs/heads/main.lock')).toBe(false)
  })

  it('treats a null filename as "something moved"', () => {
    expect(isRelevantGitEvent(null)).toBe(true)
  })

  it('does not match a name that merely starts with a relevant prefix', () => {
    expect(isRelevantGitEvent('index-pack-output')).toBe(false)
    expect(isRelevantGitEvent('HEADER')).toBe(false)
  })
})

describe('watchGitDir', () => {
  it('watches the .git directory of the project it is given', () => {
    const { factory, made } = fakeFactory()
    expect(watchGitDir('/work/paper', vi.fn(), factory)).toBe(true)
    expect(made[0]?.dir).toBe('/work/paper/.git')
    expect(watchedGitDir()).toBe('/work/paper')
  })

  it('notifies once per burst, with the PROJECT dir, not the .git dir', () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const { factory, made } = fakeFactory()
    watchGitDir('/work/paper', notify, factory)

    // one `git commit` rewrites the index, HEAD's ref and packed-refs
    made[0]?.fire('index')
    made[0]?.fire('refs/heads/main')
    made[0]?.fire('index')
    expect(notify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(GIT_DEBOUNCE_MS)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('/work/paper')
  })

  it('stays asleep for object writes', () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const { factory, made } = fakeFactory()
    watchGitDir('/work/paper', notify, factory)

    made[0]?.fire('objects/pack/pack-1.pack')
    vi.advanceTimersByTime(GIT_DEBOUNCE_MS * 2)
    expect(notify).not.toHaveBeenCalled()
  })

  it('prefers a recursive watch and falls back to a flat one', () => {
    const { factory, made } = fakeFactory()
    watchGitDir('/work/paper', vi.fn(), factory)
    expect(made[0]?.recursive).toBe(true)

    stopWatchingGit()
    const flat = fakeFactory({ failRecursive: true })
    expect(watchGitDir('/work/paper', vi.fn(), flat.factory)).toBe(true)
    expect(flat.made[0]?.recursive).toBe(false)
  })

  it('watches one project at a time, closing the previous watcher', () => {
    const { factory, made } = fakeFactory()
    watchGitDir('/work/one', vi.fn(), factory)
    watchGitDir('/work/two', vi.fn(), factory)
    expect(made[0]?.closed()).toBe(true)
    expect(watchedGitDir()).toBe('/work/two')
  })

  it('stops entirely for a null dir, and reports no watch', () => {
    const { factory, made } = fakeFactory()
    watchGitDir('/work/one', vi.fn(), factory)
    expect(watchGitDir(null, vi.fn(), factory)).toBe(false)
    expect(made[0]?.closed()).toBe(true)
    expect(watchedGitDir()).toBeNull()
  })

  it('reports failure rather than throwing when there is no .git to watch', () => {
    const factory: Parameters<typeof watchGitDir>[2] = () => {
      throw new Error('ENOENT')
    }
    expect(watchGitDir('/work/not-a-repo', vi.fn(), factory)).toBe(false)
    expect(watchedGitDir()).toBeNull()
  })

  it('drops a debounced notification queued for a project that was replaced', () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const { factory, made } = fakeFactory()
    watchGitDir('/work/one', first, factory)
    made[0]?.fire('index')
    watchGitDir('/work/two', vi.fn(), factory)
    vi.advanceTimersByTime(GIT_DEBOUNCE_MS * 2)
    expect(first).not.toHaveBeenCalled()
  })
})
