import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FSWatcher } from 'node:fs'
import {
  TREE_DEBOUNCE_MS,
  isRelevantTreeEvent,
  stopWatchingProjectTree,
  watchProjectTree,
  watchedTreeDir
} from './projectTreeWatch'

interface FakeWatcher {
  watcher: FSWatcher
  fire: (filename: string | null) => void
  closed: () => boolean
  recursive: boolean
}

/** A watch factory that captures the listener so a test can fire events. */
function fakeFactory(options: { failRecursive?: boolean } = {}): {
  factory: Parameters<typeof watchProjectTree>[2]
  made: FakeWatcher[]
} {
  const made: FakeWatcher[] = []
  const factory: Parameters<typeof watchProjectTree>[2] = (_dir, recursive, listener) => {
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
      watcher,
      fire: (filename) => listener('change', filename),
      closed: () => closed,
      recursive
    })
    return watcher
  }
  return { factory, made }
}

afterEach(() => {
  stopWatchingProjectTree()
  vi.useRealTimers()
})

describe('isRelevantTreeEvent', () => {
  it('ignores paths the explorer never shows', () => {
    expect(isRelevantTreeEvent('.git/index')).toBe(false)
    expect(isRelevantTreeEvent('node_modules/foo/index.js')).toBe(false)
    expect(isRelevantTreeEvent('analysis/__pycache__/x.pyc')).toBe(false)
    expect(isRelevantTreeEvent('.DS_Store')).toBe(false)
  })

  it('accepts real project files, including nested ones', () => {
    expect(isRelevantTreeEvent('manuscript/manuscript.md')).toBe(true)
    expect(isRelevantTreeEvent('figures/fig-1/figure.svg')).toBe(true)
  })

  it('treats a null filename as "something moved"', () => {
    // some platforms report no name; a spurious re-list costs one directory walk
    expect(isRelevantTreeEvent(null)).toBe(true)
  })

  it('does not confuse a file merely CONTAINING an ignored name', () => {
    expect(isRelevantTreeEvent('notes-about-git.md')).toBe(true)
    expect(isRelevantTreeEvent('data/node_modules_report.csv')).toBe(true)
  })
})

describe('watchProjectTree', () => {
  it('notifies once per burst, with the project dir', () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const { factory, made } = fakeFactory()
    expect(watchProjectTree('/work/paper', notify, factory)).toBe(true)

    // an export or a git checkout emits a burst of events
    made[0]?.fire('exports/paper.docx')
    made[0]?.fire('exports/paper.docx')
    made[0]?.fire('exports/paper.pdf')
    expect(notify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(TREE_DEBOUNCE_MS)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('/work/paper')
  })

  it('does not wake up for ignored paths', () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const { factory, made } = fakeFactory()
    watchProjectTree('/work/paper', notify, factory)

    made[0]?.fire('.git/objects/ab/cdef')
    vi.advanceTimersByTime(TREE_DEBOUNCE_MS * 2)
    expect(notify).not.toHaveBeenCalled()
  })

  it('prefers a recursive watch and falls back to a flat one', () => {
    const { factory, made } = fakeFactory()
    watchProjectTree('/work/paper', vi.fn(), factory)
    expect(made[0]?.recursive).toBe(true)

    stopWatchingProjectTree()
    const flat = fakeFactory({ failRecursive: true })
    expect(watchProjectTree('/work/paper', vi.fn(), flat.factory)).toBe(true)
    expect(flat.made).toHaveLength(1)
    expect(flat.made[0]?.recursive).toBe(false)
  })

  it('watches one project at a time, closing the previous watcher', () => {
    const { factory, made } = fakeFactory()
    watchProjectTree('/work/one', vi.fn(), factory)
    watchProjectTree('/work/two', vi.fn(), factory)

    expect(made[0]?.closed()).toBe(true)
    expect(watchedTreeDir()).toBe('/work/two')
  })

  it('re-watching the same dir keeps the existing watcher', () => {
    const { factory, made } = fakeFactory()
    watchProjectTree('/work/paper', vi.fn(), factory)
    watchProjectTree('/work/paper', vi.fn(), factory)
    expect(made).toHaveLength(1)
  })

  it('stops watching when the project closes', () => {
    const { factory, made } = fakeFactory()
    watchProjectTree('/work/paper', vi.fn(), factory)
    expect(watchProjectTree(null, vi.fn(), factory)).toBe(false)
    expect(made[0]?.closed()).toBe(true)
    expect(watchedTreeDir()).toBeNull()
  })

  it('never notifies after being stopped mid-debounce', () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const { factory, made } = fakeFactory()
    watchProjectTree('/work/paper', notify, factory)

    made[0]?.fire('manuscript/manuscript.md')
    stopWatchingProjectTree()
    vi.advanceTimersByTime(TREE_DEBOUNCE_MS * 2)
    expect(notify).not.toHaveBeenCalled()
  })
})
