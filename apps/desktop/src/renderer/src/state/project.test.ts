import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DockviewApi } from 'dockview'
import type { MigrationOutcome, SunaProjectManifest } from '@suna/core'
import { openProjectAt, useProjectStore } from './project'
import { setDockApi } from './dock'
import { useCommentsStore } from './comments'
import { useUiStore } from './ui'

const invoke = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: { suna: { invoke } },
  writable: true,
  configurable: true
})

const manifest = {
  schemaVersion: 1,
  name: 'my-paper',
  activeProfileId: 'nature',
  directories: {
    manuscript: 'manuscript',
    figures: 'figures',
    code: 'code',
    data: 'data',
    analysis: 'analysis',
    results: 'results',
    output: 'output'
  },
  createdAt: '2026-08-13T09:30:00.000Z'
} satisfies SunaProjectManifest

const CLEAN_MIGRATION: MigrationOutcome = { migrated: false, notes: [], error: null }

interface FakePanel {
  id: string
  params: Record<string, unknown>
  view: { contentComponent: string }
}

/** A dock exposing only what closeProjectTabs/openManuscriptTab touch. */
function fakeDock(panels: FakePanel[]): { api: DockviewApi; removePanel: ReturnType<typeof vi.fn>; addPanel: ReturnType<typeof vi.fn> } {
  const removePanel = vi.fn()
  const addPanel = vi.fn()
  const api = {
    panels,
    removePanel,
    addPanel,
    getPanel: () => undefined
  }
  return { api: api as unknown as DockviewApi, removePanel, addPanel }
}

function resetStores(): void {
  invoke.mockReset()
  useProjectStore.setState({ rootDir: null, manifest: null, tree: null, saveBump: 0 })
  useCommentsStore.setState({
    rootDir: null,
    comments: [],
    loaded: false,
    loading: false,
    error: null,
    draft: null,
    revealRequest: null,
    activeId: null,
    composing: false
  })
  useUiStore.setState({ statusNote: null })
  setDockApi(fakeDock([]).api)
}

/** Route the shared `invoke` mock by channel, defaulting unlisted channels to an empty object. */
function mockChannels(map: Record<string, unknown>): void {
  invoke.mockImplementation(async (channel: string) => map[channel] ?? {})
}

describe('openProjectAt', () => {
  beforeEach(() => {
    resetStores()
  })

  it('sets rootDir/manifest, refreshes the tree, and starts a comments reload for the new root', async () => {
    const tree = { kind: 'dir' as const, name: 'paper', path: '/work/paper', children: [] }
    mockChannels({
      'project:open': { manifest, manuscriptPresent: true, migration: CLEAN_MIGRATION },
      'fs:list': { root: tree },
      'comments:read': { file: { schemaVersion: 1, comments: [] } }
    })

    const result = await openProjectAt('/work/paper')

    expect(result).toEqual(manifest)
    expect(useProjectStore.getState().rootDir).toBe('/work/paper')
    expect(useProjectStore.getState().manifest).toEqual(manifest)
    expect(useProjectStore.getState().tree).toEqual(tree)
    // load() sets rootDir + loading synchronously before its own await, so this
    // proves the reload was kicked off for the right project without racing
    // the (unawaited, by design) comments:read round trip.
    expect(useCommentsStore.getState().rootDir).toBe('/work/paper')
    await vi.waitFor(() => expect(useCommentsStore.getState().loaded).toBe(true))
    expect(invoke).toHaveBeenCalledWith('comments:read', { dir: '/work/paper' })
  })

  it('closes tabs scoped to the project that was open before switching, and leaves others alone', async () => {
    const stale = { id: '/old/manuscript.md', params: { path: '/old/manuscript.md' }, view: { contentComponent: 'editor' } }
    const untouched = { id: 'settings', params: {}, view: { contentComponent: 'settings' } }
    const dock = fakeDock([stale, untouched])
    setDockApi(dock.api)
    useProjectStore.setState({ rootDir: '/old', manifest, tree: null, saveBump: 0 })
    mockChannels({
      'project:open': { manifest, manuscriptPresent: true, migration: CLEAN_MIGRATION }
    })

    await openProjectAt('/new')

    expect(dock.removePanel).toHaveBeenCalledWith(stale)
    expect(dock.removePanel).not.toHaveBeenCalledWith(untouched)
  })

  it('does not touch tabs when re-opening the project that is already open', async () => {
    const dock = fakeDock([{ id: '/work/paper/manuscript.md', params: { path: '/work/paper/manuscript.md' }, view: { contentComponent: 'editor' } }])
    setDockApi(dock.api)
    useProjectStore.setState({ rootDir: '/work/paper', manifest, tree: null, saveBump: 0 })
    mockChannels({
      'project:open': { manifest, manuscriptPresent: true, migration: CLEAN_MIGRATION }
    })

    await openProjectAt('/work/paper')

    expect(dock.removePanel).not.toHaveBeenCalled()
  })

  it('leaves a status note naming the project when nothing needed migrating', async () => {
    mockChannels({
      'project:open': { manifest, manuscriptPresent: true, migration: CLEAN_MIGRATION }
    })
    await openProjectAt('/work/paper')
    expect(useUiStore.getState().statusNote).toBe('Opened project "my-paper"')
  })

  it('calls out a migration that ran', async () => {
    mockChannels({
      'project:open': {
        manifest,
        manuscriptPresent: true,
        migration: { migrated: true, notes: ['concatenated 3 sections'], error: null }
      }
    })
    await openProjectAt('/work/paper')
    expect(useUiStore.getState().statusNote).toMatch(/migrated to the flat manuscript layout/)
  })

  it('calls out a migration that was abandoned, without hiding that the project opened anyway', async () => {
    mockChannels({
      'project:open': {
        manifest,
        manuscriptPresent: true,
        migration: { migrated: false, notes: [], error: 'sections/03-methods.md is unreadable' }
      }
    })
    await openProjectAt('/work/paper')
    const note = useUiStore.getState().statusNote
    expect(note).toMatch(/left untouched/)
    expect(note).toMatch(/sections\/03-methods\.md is unreadable/)
  })

  it('throws and leaves the store untouched when the open itself fails', async () => {
    invoke.mockRejectedValue(new Error('ENOENT'))
    await expect(openProjectAt('/missing')).rejects.toThrow('ENOENT')
    expect(useProjectStore.getState().rootDir).toBeNull()
  })
})

describe('useProjectStore.openProject', () => {
  beforeEach(() => {
    resetStores()
  })

  it('picks a folder, switches to it, and opens the manuscript tab', async () => {
    const dock = fakeDock([])
    setDockApi(dock.api)
    mockChannels({
      'dialog:pick-directory': { path: '/work/paper' },
      'project:open': { manifest, manuscriptPresent: true, migration: CLEAN_MIGRATION }
    })

    await useProjectStore.getState().openProject()

    expect(useProjectStore.getState().rootDir).toBe('/work/paper')
    expect(dock.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'manuscript:/work/paper', component: 'manuscript' })
    )
  })

  it('does nothing when the folder picker is cancelled', async () => {
    mockChannels({ 'dialog:pick-directory': { path: null } })
    await useProjectStore.getState().openProject()
    expect(useProjectStore.getState().rootDir).toBeNull()
    expect(invoke).not.toHaveBeenCalledWith('project:open', expect.anything())
  })

  it('reports a picker/open failure as a status note instead of throwing', async () => {
    invoke.mockRejectedValue(new Error('permission denied'))
    await expect(useProjectStore.getState().openProject()).resolves.toBeUndefined()
    expect(useUiStore.getState().statusNote).toMatch(/Could not open project: permission denied/)
  })
})

describe('useProjectStore.createProject', () => {
  beforeEach(() => {
    resetStores()
  })

  it('creates the project, switches to it, and opens the manuscript tab', async () => {
    const dock = fakeDock([])
    setDockApi(dock.api)
    mockChannels({
      'dialog:pick-directory': { path: '/work/new-paper' },
      'project:create': manifest
    })

    await useProjectStore.getState().createProject()

    expect(useProjectStore.getState().rootDir).toBe('/work/new-paper')
    expect(useUiStore.getState().statusNote).toBe('Created project "my-paper"')
    expect(dock.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'manuscript:/work/new-paper', component: 'manuscript' })
    )
  })
})

describe('useProjectStore.openExampleProject', () => {
  beforeEach(() => {
    resetStores()
  })

  it('opens the example project at its returned dir and opens the manuscript tab', async () => {
    const dock = fakeDock([])
    setDockApi(dock.api)
    mockChannels({
      'project:open-example': { dir: '/work/demo-paper', manifest, migration: CLEAN_MIGRATION }
    })

    await useProjectStore.getState().openExampleProject()

    expect(useProjectStore.getState().rootDir).toBe('/work/demo-paper')
    expect(useUiStore.getState().statusNote).toMatch(/\(example\)$/)
    expect(dock.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'manuscript:/work/demo-paper', component: 'manuscript' })
    )
  })
})
