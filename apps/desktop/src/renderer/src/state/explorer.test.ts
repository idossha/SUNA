import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsNode } from '@suna/core'
import { useExplorerStore, type ExplorerRow } from './explorer'
import { useUiStore } from './ui'

const invoke = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: { suna: { invoke } },
  writable: true,
  configurable: true
})

const file = (path: string): FsNode => ({
  kind: 'file',
  name: path.split('/').pop() ?? path,
  path
})
const dir = (path: string): FsNode => ({
  kind: 'dir',
  name: path.split('/').pop() ?? path,
  path,
  children: []
})

/** A flat five-row list, which is all the selection logic needs. */
const ROWS: ExplorerRow[] = [
  { node: dir('/p/data'), depth: 0 },
  { node: file('/p/a.md'), depth: 0 },
  { node: file('/p/b.md'), depth: 0 },
  { node: file('/p/c.md'), depth: 0 },
  { node: file('/p/d.md'), depth: 0 }
]

const reset = (): void => {
  useExplorerStore.setState({
    menu: null,
    editing: null,
    expanded: new Set<string>(),
    seededFor: null,
    selection: [],
    anchor: null,
    focusPath: null
  })
  useUiStore.setState({ statusNote: null })
  invoke.mockReset()
  invoke.mockResolvedValue({})
}

beforeEach(reset)

describe('selectRow', () => {
  it('a plain click selects exactly one row and moves the anchor', () => {
    const store = useExplorerStore.getState()
    store.selectRow('/p/b.md', ROWS, {})
    expect(useExplorerStore.getState().selection).toEqual(['/p/b.md'])

    store.selectRow('/p/d.md', ROWS, {})
    expect(useExplorerStore.getState().selection).toEqual(['/p/d.md'])
    expect(useExplorerStore.getState().anchor).toBe('/p/d.md')
  })

  it('⌘-click adds to the selection, and clicking again removes that row', () => {
    const store = useExplorerStore.getState()
    store.selectRow('/p/a.md', ROWS, {})
    store.selectRow('/p/c.md', ROWS, { additive: true })
    expect(useExplorerStore.getState().selection).toEqual(['/p/a.md', '/p/c.md'])

    useExplorerStore.getState().selectRow('/p/a.md', ROWS, { additive: true })
    expect(useExplorerStore.getState().selection).toEqual(['/p/c.md'])
  })

  it('shift-click selects the whole range from the anchor, in visible order', () => {
    const store = useExplorerStore.getState()
    store.selectRow('/p/a.md', ROWS, {})
    useExplorerStore.getState().selectRow('/p/d.md', ROWS, { range: true })
    expect(useExplorerStore.getState().selection).toEqual(['/p/a.md', '/p/b.md', '/p/c.md', '/p/d.md'])
  })

  it('shift-clicking BACKWARDS gives the same range, still in visible order', () => {
    const store = useExplorerStore.getState()
    store.selectRow('/p/d.md', ROWS, {})
    useExplorerStore.getState().selectRow('/p/b.md', ROWS, { range: true })
    expect(useExplorerStore.getState().selection).toEqual(['/p/b.md', '/p/c.md', '/p/d.md'])
  })

  it('re-shift-clicking replaces the range rather than growing it', () => {
    const store = useExplorerStore.getState()
    store.selectRow('/p/a.md', ROWS, {})
    useExplorerStore.getState().selectRow('/p/d.md', ROWS, { range: true })
    useExplorerStore.getState().selectRow('/p/b.md', ROWS, { range: true })
    expect(useExplorerStore.getState().selection).toEqual(['/p/a.md', '/p/b.md'])
  })

  it('shift with no anchor yet just selects the row', () => {
    useExplorerStore.getState().selectRow('/p/c.md', ROWS, { range: true })
    expect(useExplorerStore.getState().selection).toEqual(['/p/c.md'])
  })
})

describe('selectAll / clearSelection', () => {
  it('⌘A selects every visible row', () => {
    useExplorerStore.getState().selectAll(ROWS)
    expect(useExplorerStore.getState().selection).toHaveLength(ROWS.length)
  })

  it('Escape clears the selection and the anchor', () => {
    useExplorerStore.getState().selectAll(ROWS)
    useExplorerStore.getState().clearSelection()
    expect(useExplorerStore.getState().selection).toEqual([])
    expect(useExplorerStore.getState().anchor).toBeNull()
  })
})

describe('toggleExpanded', () => {
  it('toggles, and honours an explicit open/closed request', () => {
    const store = useExplorerStore.getState()
    store.toggleExpanded('/p/data')
    expect(useExplorerStore.getState().expanded.has('/p/data')).toBe(true)

    useExplorerStore.getState().toggleExpanded('/p/data')
    expect(useExplorerStore.getState().expanded.has('/p/data')).toBe(false)

    useExplorerStore.getState().toggleExpanded('/p/data', true)
    useExplorerStore.getState().toggleExpanded('/p/data', true)
    expect(useExplorerStore.getState().expanded.has('/p/data')).toBe(true)
  })
})

describe('openMenu targets', () => {
  it('acts on the whole selection when the right-clicked row is inside it', () => {
    const store = useExplorerStore.getState()
    store.selectRow('/p/a.md', ROWS, {})
    useExplorerStore.getState().selectRow('/p/c.md', ROWS, { additive: true })

    useExplorerStore.getState().openMenu(file('/p/c.md'), 10, 10)
    expect(useExplorerStore.getState().menu?.targets).toEqual(['/p/a.md', '/p/c.md'])
  })

  it('collapses to the one row when right-clicking OUTSIDE the selection', () => {
    const store = useExplorerStore.getState()
    store.selectRow('/p/a.md', ROWS, {})

    useExplorerStore.getState().openMenu(file('/p/d.md'), 10, 10)
    expect(useExplorerStore.getState().menu?.targets).toEqual(['/p/d.md'])
    // and the selection follows, so the menu never acts on unseen rows
    expect(useExplorerStore.getState().selection).toEqual(['/p/d.md'])
  })
})

describe('confirmDelete', () => {
  it('deletes every target and reports the count', async () => {
    const store = useExplorerStore.getState()
    store.selectRow('/p/a.md', ROWS, {})
    useExplorerStore.getState().selectRow('/p/c.md', ROWS, { additive: true })
    useExplorerStore.getState().openMenu(file('/p/c.md'), 0, 0)

    await useExplorerStore.getState().confirmDelete()

    const deleted = invoke.mock.calls
      .filter(([channel]) => channel === 'fs:delete')
      .map(([, payload]) => (payload as { path: string }).path)
    expect(deleted).toEqual(['/p/a.md', '/p/c.md'])
    expect(useUiStore.getState().statusNote).toContain('2 items')
    expect(useExplorerStore.getState().selection).toEqual([])
  })

  it('names a single file rather than counting it', async () => {
    useExplorerStore.getState().selectRow('/p/a.md', ROWS, {})
    useExplorerStore.getState().openMenu(file('/p/a.md'), 0, 0)

    await useExplorerStore.getState().confirmDelete()
    expect(useUiStore.getState().statusNote).toContain('a.md')
  })

  it('deletes what it can and names what it could not, rather than stopping at the first failure', async () => {
    invoke.mockImplementation((channel: string, payload: { path: string }) => {
      if (channel === 'fs:delete' && payload.path === '/p/b.md') {
        return Promise.reject(new Error('permission denied'))
      }
      return Promise.resolve({})
    })
    useExplorerStore.getState().selectRow('/p/a.md', ROWS, {})
    useExplorerStore.getState().selectRow('/p/c.md', ROWS, { range: true })
    useExplorerStore.getState().openMenu(file('/p/b.md'), 0, 0)

    await useExplorerStore.getState().confirmDelete()

    const deleted = invoke.mock.calls
      .filter(([channel]) => channel === 'fs:delete')
      .map(([, payload]) => (payload as { path: string }).path)
    expect(deleted).toEqual(['/p/a.md', '/p/b.md', '/p/c.md'])
    const note = useUiStore.getState().statusNote ?? ''
    expect(note).toContain('Moved 2')
    expect(note).toContain('b.md')
  })
})

describe('startCreate', () => {
  it('reveals the target directory, so the input row is never hidden', () => {
    useExplorerStore.getState().startCreate('/p/data', 'create-file')
    expect(useExplorerStore.getState().expanded.has('/p/data')).toBe(true)
    expect(useExplorerStore.getState().editing).toEqual({ kind: 'create-file', parentPath: '/p/data' })
  })
})
