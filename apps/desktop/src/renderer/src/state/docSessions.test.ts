import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeSet, Text } from '@codemirror/state'
import { mirrorAutosave, resetAutosaveMirror } from './autosave'
import {
  AUTOSAVE_IDLE_MS,
  DocSessionCore,
  acquireDocSession,
  useDocSessionsStore,
  type SessionView
} from './docSessions'

/**
 * A fake attached view: holds its own Text and applies remote ChangeSets the
 * way the real wrapper's dispatch would. Local edits are pushed through
 * core.applyLocal exactly as the update-listener glue does.
 */
class FakeView implements SessionView {
  doc: Text
  composing = false
  remoteApplied = 0

  constructor(initial: string) {
    this.doc = Text.of(initial.split('\n'))
  }

  getDoc(): Text {
    return this.doc
  }

  applyRemote(changes: ChangeSet): void {
    this.doc = changes.apply(this.doc)
    this.remoteApplied += 1
  }

  isComposing(): boolean {
    return this.composing
  }

  text(): string {
    return this.doc.toString()
  }

  /** Simulate a user edit: apply locally, then report to the core. */
  edit(core: DocSessionCore, entry: ReturnType<DocSessionCore['addView']>, spec: { from: number; to?: number; insert?: string }): void {
    const changes = ChangeSet.of(
      { from: spec.from, to: spec.to ?? spec.from, insert: spec.insert ?? '' },
      this.doc.length
    )
    this.doc = changes.apply(this.doc)
    core.applyLocal(entry, changes)
  }
}

describe('DocSessionCore', () => {
  it('keeps two views in lockstep through local edits in both', () => {
    const core = new DocSessionCore('hello world')
    const a = new FakeView(core.text())
    const b = new FakeView(core.text())
    const ea = core.addView(a)
    const eb = core.addView(b)

    a.edit(core, ea, { from: 5, insert: ',' })
    expect(b.text()).toBe('hello, world')
    b.edit(core, eb, { from: 12, insert: '!' })
    expect(a.text()).toBe('hello, world!')
    expect(core.text()).toBe('hello, world!')
  })

  it('supports three views (the split case)', () => {
    const core = new DocSessionCore('abc')
    const views = [new FakeView('abc'), new FakeView('abc'), new FakeView('abc')]
    const entries = views.map((v) => core.addView(v))
    views[0]!.edit(core, entries[0]!, { from: 3, insert: 'd' })
    for (const v of views) expect(v.text()).toBe('abcd')
    expect(core.text()).toBe('abcd')
  })

  it('converges a stale view at attach time', () => {
    const core = new DocSessionCore('one two')
    const a = new FakeView('one two')
    const ea = core.addView(a)
    a.edit(core, ea, { from: 7, insert: ' three' })
    // b was created from the pre-edit snapshot (the ready()/attach race)
    const b = new FakeView('one two')
    core.addView(b)
    expect(b.text()).toBe('one two three')
  })

  it('external content applies to every view as one mapped change', () => {
    const core = new DocSessionCore('alpha beta gamma')
    const a = new FakeView(core.text())
    const b = new FakeView(core.text())
    core.addView(a)
    core.addView(b)
    core.applyExternal('alpha beta (edited) gamma')
    expect(a.text()).toBe('alpha beta (edited) gamma')
    expect(b.text()).toBe('alpha beta (edited) gamma')
    expect(core.text()).toBe('alpha beta (edited) gamma')
  })

  it('external reload maps positions instead of replacing the document', () => {
    const core = new DocSessionCore('start middle end')
    const a = new FakeView(core.text())
    core.addView(a)
    let applied: ChangeSet | null = null
    const original = a.applyRemote.bind(a)
    a.applyRemote = (changes) => {
      applied = changes
      original(changes)
    }
    core.applyExternal('start middle (RPS) end')
    expect(applied).not.toBeNull()
    // a caret parked at the end of the doc maps forward by the insert length
    const caretBefore = 'start middle end'.length
    const caretAfter = applied!.mapPos(caretBefore)
    expect(caretAfter).toBe('start middle (RPS) end'.length)
  })

  it('queues remote changes for a composing view and flushes on compositionend', () => {
    const core = new DocSessionCore('shared text')
    const a = new FakeView(core.text())
    const b = new FakeView(core.text())
    const ea = core.addView(a)
    const eb = core.addView(b)

    b.composing = true
    a.edit(core, ea, { from: 0, insert: 'A: ' })
    // b did not receive the change mid-composition
    expect(b.text()).toBe('shared text')
    expect(core.text()).toBe('A: shared text')

    b.composing = false
    core.flushPending(eb)
    expect(b.text()).toBe('A: shared text')
  })

  it('rebases a composing view\'s own edits over queued remote changes', () => {
    const core = new DocSessionCore('shared')
    const a = new FakeView(core.text())
    const b = new FakeView(core.text())
    const ea = core.addView(a)
    const eb = core.addView(b)

    b.composing = true
    a.edit(core, ea, { from: 0, insert: 'X' }) // queued for b
    // b types at ITS OWN end-of-doc (offset against its stale doc)
    b.edit(core, eb, { from: 6, insert: 'Y' })
    // the session sees both, in a consistent order
    expect(core.text()).toBe('Xshared' + 'Y')
    expect(a.text()).toBe('XsharedY')

    b.composing = false
    core.flushPending(eb)
    expect(b.text()).toBe('XsharedY')
  })

  it('preserves ordering when multiple remote changes queue during composition', () => {
    const core = new DocSessionCore('base')
    const a = new FakeView(core.text())
    const b = new FakeView(core.text())
    const ea = core.addView(a)
    const eb = core.addView(b)

    b.composing = true
    a.edit(core, ea, { from: 4, insert: '1' })
    a.edit(core, ea, { from: 5, insert: '2' })
    a.edit(core, ea, { from: 6, insert: '3' })
    expect(b.remoteApplied).toBe(0)
    b.composing = false
    core.flushPending(eb)
    expect(b.text()).toBe('base123')
    expect(b.remoteApplied).toBe(1) // one composed flush, not three dispatches
  })

  it('a removed view receives nothing', () => {
    const core = new DocSessionCore('doc')
    const a = new FakeView('doc')
    const b = new FakeView('doc')
    const ea = core.addView(a)
    const eb = core.addView(b)
    core.removeView(eb)
    a.edit(core, ea, { from: 3, insert: '!' })
    expect(b.text()).toBe('doc')
    expect(core.text()).toBe('doc!')
  })

  it('reports local edits (the dirty hook) for user changes only', () => {
    const core = new DocSessionCore('x')
    let localEdits = 0
    core.onLocalEdit = () => {
      localEdits += 1
    }
    const a = new FakeView('x')
    const ea = core.addView(a)
    a.edit(core, ea, { from: 1, insert: 'y' })
    expect(localEdits).toBe(1)
    core.applyExternal('external')
    expect(localEdits).toBe(1) // external reload is not a user edit
  })
})

/* ---------------------------------------------------------------------------
   Autosave. Drives a REAL DocSession through acquireDocSession, with a stubbed
   `window.suna` bridge and fake timers, because the behaviour under test is
   "which writes reach disk, and when" — the one thing the pure core cannot
   answer.
   ------------------------------------------------------------------------- */

const invoke = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: {
    suna: { invoke },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) => clearTimeout(id as Parameters<typeof clearTimeout>[0])
  },
  writable: true,
  configurable: true
})

/** Reads answer with `disk`; writes record and become the new `disk`. */
function bridge(initial: string): { disk: string; writes: string[] } {
  const state = { disk: initial, writes: [] as string[] }
  invoke.mockImplementation(async (channel: string, args: Record<string, unknown>) => {
    if (channel === 'fs:read-text') return { content: state.disk }
    if (channel === 'fs:write-text') {
      const content = args['content'] as string
      state.writes.push(content)
      state.disk = content
      return {}
    }
    return {}
  })
  return state
}

/**
 * A live session with one attached fake view, ready to edit. Reaches past the
 * public DocSession for two internals the behaviour under test needs: `core`
 * (to drive edits the way the CodeMirror glue does, with no DOM) and
 * `checkDisk` (the watcher's entry point, which is how a divergence arises).
 */
interface SessionInternals {
  core: DocSessionCore
  checkDisk: () => Promise<void>
}

async function liveSession(path: string, initial: string) {
  const handle = acquireDocSession(path)
  await handle.session.ready()
  const internals = handle.session as unknown as SessionInternals
  const view = new FakeView(internals.core.text())
  const entry = internals.core.addView(view)
  return { ...handle, core: internals.core, checkDisk: internals.checkDisk.bind(internals), view, entry }
}

describe('autosave', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetAutosaveMirror()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the buffer once, an idle after the last edit', async () => {
    const disk = bridge('one')
    const { core, view, entry, release } = await liveSession('/p/a.md', 'one')

    view.edit(core, entry, { from: 3, insert: ' two' })
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS - 1)
    expect(disk.writes).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(disk.writes).toEqual(['one two'])
    release()
  })

  it('coalesces a burst of typing into one write at the end of it', async () => {
    const disk = bridge('')
    const { core, view, entry, release } = await liveSession('/p/b.md', '')

    for (let i = 0; i < 5; i++) {
      view.edit(core, entry, { from: view.text().length, insert: 'x' })
      await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS / 2)
    }
    expect(disk.writes).toEqual([])
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS)
    expect(disk.writes).toEqual(['xxxxx'])
    release()
  })

  it('leaves the session clean, so the tab loses its dirty dot', async () => {
    bridge('one')
    const { session, core, view, entry, release } = await liveSession('/p/c.md', 'one')

    view.edit(core, entry, { from: 0, insert: 'a' })
    expect(session.isDirty()).toBe(true)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS)
    expect(session.isDirty()).toBe(false)
    release()
  })

  it('does nothing at all when the setting is off', async () => {
    const disk = bridge('one')
    mirrorAutosave(false)
    const { core, view, entry, release } = await liveSession('/p/d.md', 'one')

    view.edit(core, entry, { from: 0, insert: 'a' })
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS * 3)
    expect(disk.writes).toEqual([])
    release()
  })

  it('stops a save already scheduled when the setting is turned off mid-pause', async () => {
    const disk = bridge('one')
    const { core, view, entry, release } = await liveSession('/p/e.md', 'one')

    view.edit(core, entry, { from: 0, insert: 'a' })
    mirrorAutosave(false)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS * 3)
    expect(disk.writes).toEqual([])
    release()
  })

  /**
   * The case that would lose someone's work: the file changed on disk while
   * the buffer was dirty. The divergence banner is waiting on an answer, and
   * an autosave would answer it "mine" without asking.
   */
  it('refuses to overwrite a divergence the user has not resolved', async () => {
    const disk = bridge('one')
    const { session, core, checkDisk, view, entry, release } = await liveSession('/p/f.md', 'one')

    view.edit(core, entry, { from: 0, insert: 'mine ' })
    disk.disk = 'theirs'
    await checkDisk()
    expect(useDocSessionsStore.getState().meta.get('/p/f.md')?.diverged).toBe(true)

    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS * 3)
    expect(disk.writes).toEqual([])

    // resolving it "keep mine" is what lets the save through
    session.resolveDivergence('keepMine')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS)
    expect(disk.writes).toEqual(['mine one'])
    release()
  })

  it('does not re-save an edit an explicit ⌘S already wrote', async () => {
    const disk = bridge('one')
    const { session, core, view, entry, release } = await liveSession('/p/g.md', 'one')

    view.edit(core, entry, { from: 0, insert: 'a' })
    await session.save()
    expect(disk.writes).toEqual(['aone'])

    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS * 3)
    expect(disk.writes).toEqual(['aone'])
    release()
  })
})
