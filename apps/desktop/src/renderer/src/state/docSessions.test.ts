import { describe, expect, it } from 'vitest'
import { ChangeSet, Text } from '@codemirror/state'
import { DocSessionCore, type SessionView } from './docSessions'

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
