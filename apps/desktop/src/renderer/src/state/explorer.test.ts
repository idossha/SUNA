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

// The dock is real everywhere except the two entry points this store calls:
// there is no dockview instance here, so retargetPanels would silently no-op
// and the WIRING (does a rename/move tell the tabs?) would go untested.
// retargetPanels' own behaviour is covered in dock.test.ts.
const { openFileTabMock, retargetPanelsMock } = vi.hoisted(() => ({
  openFileTabMock: vi.fn(),
  retargetPanelsMock: vi.fn(() => 0)
}))
vi.mock('./dock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dock')>()),
  openFileTab: openFileTabMock,
  retargetPanels: retargetPanelsMock
}))

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
  openFileTabMock.mockClear()
  retargetPanelsMock.mockClear()
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

describe('moveInto', () => {
  it('sends one batched fs:move and leaves the moved rows selected at their NEW paths', async () => {
    invoke.mockResolvedValue({
      moved: [
        { from: '/p/a.md', to: '/p/data/a.md' },
        { from: '/p/b.md', to: '/p/data/b.md' }
      ],
      failed: []
    })

    await useExplorerStore.getState().moveInto(['/p/a.md', '/p/b.md'], '/p/data')

    const moves = invoke.mock.calls.filter(([channel]) => channel === 'fs:move')
    expect(moves).toHaveLength(1)
    expect(moves[0]?.[1]).toEqual({ paths: ['/p/a.md', '/p/b.md'], targetDir: '/p/data' })
    expect(useExplorerStore.getState().selection).toEqual(['/p/data/a.md', '/p/data/b.md'])
    expect(useExplorerStore.getState().focusPath).toBe('/p/data/b.md')
    // …and the folder they landed in is revealed, or the selection is invisible
    expect(useExplorerStore.getState().expanded.has('/p/data')).toBe(true)
    expect(useUiStore.getState().statusNote).toBe('Moved 2 items to data/')
    // every moved path drags its open tab along with it
    expect(retargetPanelsMock.mock.calls).toEqual([
      ['/p/a.md', '/p/data/a.md'],
      ['/p/b.md', '/p/data/b.md']
    ])
  })

  it('reports a partial batch without losing what did move', async () => {
    invoke.mockResolvedValue({
      moved: [{ from: '/p/a.md', to: '/p/data/a.md' }],
      failed: [{ path: '/p/fig.svg', reason: 'already exists' }]
    })

    await useExplorerStore.getState().moveInto(['/p/a.md', '/p/fig.svg'], '/p/data')

    expect(useExplorerStore.getState().selection).toEqual(['/p/data/a.md'])
    const note = useUiStore.getState().statusNote ?? ''
    expect(note).toContain('Moved 1 item to data/')
    expect(note).toContain('1 could not move')
    expect(note).toContain('fig.svg')
  })

  it('keeps the selection where it was when the whole batch failed', async () => {
    invoke.mockResolvedValue({
      moved: [],
      failed: [{ path: '/p/a.md', reason: 'already exists' }]
    })
    useExplorerStore.getState().selectRow('/p/a.md', ROWS, {})

    await useExplorerStore.getState().moveInto(['/p/a.md'], '/p/data')

    expect(useExplorerStore.getState().selection).toEqual(['/p/a.md'])
    expect(useUiStore.getState().statusNote).toContain('Could not move a.md')
  })

  it('reports a thrown channel error rather than swallowing it', async () => {
    invoke.mockRejectedValue(new Error('outside the project'))
    await useExplorerStore.getState().moveInto(['/p/a.md'], '/p/data')
    expect(useUiStore.getState().statusNote).toContain('outside the project')
  })

  it('does not call the channel at all for an empty drop', async () => {
    await useExplorerStore.getState().moveInto([], '/p/data')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'fs:move')).toHaveLength(0)
    expect(useUiStore.getState().statusNote).toBeNull()
  })
})

describe('commitEdit (rename)', () => {
  it('retargets the open tab instead of orphaning it at the old path', async () => {
    invoke.mockResolvedValue({ path: '/p/intro.md' })
    useExplorerStore.getState().startRename(file('/p/a.md'))

    await useExplorerStore.getState().commitEdit('intro.md')

    expect(retargetPanelsMock).toHaveBeenCalledWith('/p/a.md', '/p/intro.md')
    expect(useExplorerStore.getState().selection).toEqual(['/p/intro.md'])
  })

  it('retargets a renamed DIRECTORY too, and opens no tab for it', async () => {
    invoke.mockResolvedValue({ path: '/p/measurements' })
    useExplorerStore.getState().startRename(dir('/p/data'))

    await useExplorerStore.getState().commitEdit('measurements')

    expect(retargetPanelsMock).toHaveBeenCalledWith('/p/data', '/p/measurements')
    expect(openFileTabMock).not.toHaveBeenCalled()
  })

  it('leaves the tabs alone when the name did not change', async () => {
    useExplorerStore.getState().startRename(file('/p/a.md'))
    await useExplorerStore.getState().commitEdit('a.md')
    expect(retargetPanelsMock).not.toHaveBeenCalled()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'fs:rename')).toHaveLength(0)
  })
})

describe('startCreate', () => {
  it('reveals the target directory, so the input row is never hidden', () => {
    useExplorerStore.getState().startCreate('/p/data', 'create-file')
    expect(useExplorerStore.getState().expanded.has('/p/data')).toBe(true)
    expect(useExplorerStore.getState().editing).toEqual({ kind: 'create-file', parentPath: '/p/data' })
  })
})
