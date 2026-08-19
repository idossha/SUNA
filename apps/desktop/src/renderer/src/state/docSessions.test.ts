import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeSet, Text } from '@codemirror/state'
import { mirrorAutosave, resetAutosaveMirror } from './autosave'
import {
  AUTOSAVE_IDLE_MS,
  DocSessionCore,
  acquireDocSession,
  flushDirtySessions,
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

  it('applies a two-place external edit as two changes, not one big one', () => {
    // The regression this guards: a single-span diff would have run from the
    // first difference to the last, deleting and reinserting every paragraph
    // between them — which collapses the comment anchors living in there and
    // throws the caret to the end of the replaced region.
    const paras = Array.from({ length: 9 }, (_, i) => `Paragraph ${i} of the section.`)
    const core = new DocSessionCore(paras.join('\n\n'))
    const a = new FakeView(core.text())
    core.addView(a)
    let applied: ChangeSet | null = null
    const original = a.applyRemote.bind(a)
    a.applyRemote = (changes) => {
      applied = changes
      original(changes)
    }

    const edited = [...paras]
    edited[1] = 'Paragraph 1 of the section, revised.'
    edited[7] = 'Paragraph 7 of the appendix.'
    core.applyExternal(edited.join('\n\n'))

    expect(a.text()).toBe(edited.join('\n\n'))
    expect(applied).not.toBeNull()

    let changeCount = 0
    applied!.iterChanges(() => {
      changeCount += 1
    })
    expect(changeCount).toBe(2)

    // A comment anchor sitting on paragraph 4 is untouched and keeps its text.
    const before = paras.join('\n\n')
    const from = before.indexOf('Paragraph 4')
    const to = from + 'Paragraph 4 of the section.'.length
    expect(applied!.touchesRange(from, to)).toBe(false)
    const mappedFrom = applied!.mapPos(from, 1)
    const mappedTo = applied!.mapPos(to, -1)
    expect(mappedTo).toBeGreaterThan(mappedFrom)
    expect(a.text().slice(mappedFrom, mappedTo)).toBe('Paragraph 4 of the section.')
  })

  it('keeps an external edit down to the words that changed', () => {
    const core = new DocSessionCore('The result was significant at the 3-sigma level.')
    const a = new FakeView(core.text())
    core.addView(a)
    let applied: ChangeSet | null = null
    const original = a.applyRemote.bind(a)
    a.applyRemote = (changes) => {
      applied = changes
      original(changes)
    }
    core.applyExternal('The result was marginal at the 3-sigma level.')

    const touched: { from: number; to: number; insert: string }[] = []
    applied!.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      touched.push({ from: fromA, to: toA, insert: inserted.toString() })
    })
    expect(touched).toEqual([{ from: 15, to: 26, insert: 'marginal' }])
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

  /**
   * The case the merge exists for, and the one that happens constantly during
   * an AI run: the agent rewrites a paragraph the human is nowhere near. That
   * used to raise the banner, where "reload" discarded the human's typing and
   * "keep mine" discarded the agent's work. It must now be a non-event.
   */
  it('merges an agent edit elsewhere into a dirty buffer with no banner', async () => {
    const disk = bridge('P1\n\nP2\n\nP3')
    const { core, checkDisk, view, entry, release } = await liveSession('/p/m.md', 'P1\n\nP2\n\nP3')

    view.edit(core, entry, { from: 0, to: 2, insert: 'MINE' })
    disk.disk = 'P1\n\nP2\n\nTHEIRS'
    await checkDisk()

    const meta = useDocSessionsStore.getState().meta.get('/p/m.md')
    expect(meta?.diverged).toBe(false)
    expect(meta?.conflicts).toBe(0)
    // both edits are live in the one buffer
    expect(core.text()).toBe('MINE\n\nP2\n\nTHEIRS')
    expect(view.text()).toBe('MINE\n\nP2\n\nTHEIRS')

    // and the merged result gets written, rather than sitting apart from disk
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS)
    expect(disk.writes).toEqual(['MINE\n\nP2\n\nTHEIRS'])
    release()
  })

  it('flags only the paragraph both sides changed, and keeps ours in the buffer', async () => {
    const disk = bridge('P1\n\nP2\n\nP3')
    const { core, checkDisk, view, entry, release } = await liveSession('/p/c.md', 'P1\n\nP2\n\nP3')

    view.edit(core, entry, { from: 0, to: 2, insert: 'MINE' })
    disk.disk = 'OURCLASH\n\nP2\n\nTHEIRS'
    await checkDisk()

    const meta = useDocSessionsStore.getState().meta.get('/p/c.md')
    expect(meta?.diverged).toBe(true)
    expect(meta?.conflicts).toBe(1)
    // ours survives the clash; their untouched-by-us edit still lands
    expect(core.text()).toBe('MINE\n\nP2\n\nTHEIRS')
    // nothing is written while the human has not answered
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS * 3)
    expect(disk.writes).toEqual([])
    release()
  })

  it('takeTheirs yields the clashing paragraph without dropping our other edits', async () => {
    const disk = bridge('P1\n\nP2\n\nP3')
    const { session, core, checkDisk, view, entry, release } = await liveSession(
      '/p/t.md',
      'P1\n\nP2\n\nP3'
    )

    // two of our edits: one that clashes (P1) and one that does not (P2)
    view.edit(core, entry, { from: 0, to: 2, insert: 'MINE' })
    view.edit(core, entry, { from: 6, to: 8, insert: 'ALSOMINE' })
    disk.disk = 'THEIRCLASH\n\nP2\n\nP3'
    await checkDisk()
    expect(useDocSessionsStore.getState().meta.get('/p/t.md')?.conflicts).toBe(1)

    session.resolveDivergence('takeTheirs')
    // their version of P1 wins; our untouched-by-them edit to P2 is kept
    expect(core.text()).toBe('THEIRCLASH\n\nALSOMINE\n\nP3')
    const meta = useDocSessionsStore.getState().meta.get('/p/t.md')
    expect(meta?.diverged).toBe(false)
    expect(meta?.conflicts).toBe(0)

    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS)
    expect(disk.writes).toEqual(['THEIRCLASH\n\nALSOMINE\n\nP3'])
    release()
  })

  it('flushDirtySessions writes unsaved buffers before an agent reads the project', async () => {
    const disk = bridge('base')
    const { core, view, entry, release } = await liveSession('/p/proj/a.md', 'base')
    view.edit(core, entry, { from: 0, insert: 'unsaved ' })
    expect(disk.writes).toEqual([])

    await flushDirtySessions('/p/proj')
    expect(disk.writes).toEqual(['unsaved base'])
    release()
  })

  it('flushDirtySessions leaves a conflicted session for the human to answer', async () => {
    const disk = bridge('P1\n\nP2')
    const { checkDisk, core, view, entry, release } = await liveSession('/p/proj/b.md', 'P1\n\nP2')
    view.edit(core, entry, { from: 0, to: 2, insert: 'MINE' })
    disk.disk = 'THEIRS\n\nP2'
    await checkDisk()
    expect(useDocSessionsStore.getState().meta.get('/p/proj/b.md')?.conflicts).toBe(1)

    // Saving here would answer the banner "mine" on the author's behalf.
    await flushDirtySessions('/p/proj')
    expect(disk.writes).toEqual([])
    release()
  })

  it('flushDirtySessions ignores buffers outside the directory it was given', async () => {
    const disk = bridge('base')
    const { core, view, entry, release } = await liveSession('/p/other/c.md', 'base')
    view.edit(core, entry, { from: 0, insert: 'x' })
    await flushDirtySessions('/p/proj')
    expect(disk.writes).toEqual([])
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
