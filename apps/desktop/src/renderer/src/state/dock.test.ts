import { beforeEach, describe, expect, it } from 'vitest'
import type { DockviewApi } from 'dockview'
import {
  activePanelPath,
  closeProjectTabs,
  componentForFile,
  openFileTab,
  openInSplit,
  openManuscriptTab,
  openViewerInSide,
  retargetPanels,
  setDockApi,
  sideGroupId,
  dockDevSeam
} from './dock'
import { useOpenTabsStore } from './openTabs'

/**
 * A fake dockview just big enough for the split logic: groups in creation
 * order, panels inside them, and the placement rules of `addPanel` —
 * `referenceGroup` appends to that group, `referencePanel` + direction makes a
 * new group EXCEPT for direction 'within' which appends to that panel's own
 * group, no position appends to the active group. `index` and `inactive` are
 * honoured because retargetPanels relies on both to put a moved file's tab
 * back exactly where it was without stealing focus. `title` is stored (real
 * dockview keeps it on the panel) so the tab LABEL a move leaves behind is
 * observable — it is derived from the path, not carried over.
 */
interface FakePanel {
  id: string
  title: string | undefined
  params: Record<string, unknown>
  view: { contentComponent: string }
  readonly group: FakeGroup | undefined
  api: { setActive: () => void; close: () => void }
}

interface FakeGroup {
  id: string
  panels: FakePanel[]
}

interface AddOptions {
  id: string
  component: string
  title?: string
  params?: Record<string, unknown>
  inactive?: boolean
  position?: {
    referenceGroup?: FakeGroup | string
    referencePanel?: string
    direction?: string
    index?: number
  }
}

function fakeDock(): {
  api: DockviewApi
  groups: FakeGroup[]
  activeId: () => string | null
} {
  const groups: FakeGroup[] = []
  let active: FakePanel | null = null
  let nextGroup = 1
  // dockview's panel events, which setDockApi subscribes to in order to keep
  // useOpenTabsStore (the explorer's open-tab indicators) in sync.
  const listeners: Array<() => void> = []
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void): { dispose: () => void } => {
    listeners.push(listener)
    return { dispose: () => undefined }
  }

  const groupOf = (panel: FakePanel): FakeGroup | undefined =>
    groups.find((group) => group.panels.includes(panel))

  const makeGroup = (): FakeGroup => {
    const group: FakeGroup = { id: `group-${nextGroup++}`, panels: [] }
    groups.push(group)
    return group
  }

  const api = {
    onDidAddPanel: subscribe,
    onDidRemovePanel: subscribe,
    onDidActivePanelChange: subscribe,
    // Real dockview fires this after the outermost structural change; the
    // fake's operations are all single mutations, so `emit` matches it.
    onDidMutateLayout: subscribe,
    get groups() {
      return groups
    },
    get panels() {
      return groups.flatMap((group) => group.panels)
    },
    get activePanel() {
      return active
    },
    getPanel(id: string) {
      return groups.flatMap((g) => g.panels).find((panel) => panel.id === id)
    },
    removePanel(panel: FakePanel) {
      panel.api.close()
    },
    clear() {
      for (const panel of groups.flatMap((g) => g.panels)) panel.api.close()
    },
    addPanel(options: AddOptions) {
      const panel: FakePanel = {
        id: options.id,
        title: options.title,
        params: options.params ?? {},
        view: { contentComponent: options.component },
        get group() {
          return groupOf(panel)
        },
        api: {
          setActive: () => {
            active = panel
            emit()
          },
          close: () => {
            const group = groupOf(panel)
            if (!group) return
            group.panels = group.panels.filter((p) => p !== panel)
            if (group.panels.length === 0) groups.splice(groups.indexOf(group), 1)
            if (active === panel) active = null
            emit()
          }
        }
      }
      const reference = options.position?.referenceGroup
      const referencePanel = options.position?.referencePanel
      let group: FakeGroup | undefined
      if (reference !== undefined) {
        group =
          typeof reference === 'string' ? groups.find((g) => g.id === reference) : reference
      } else if (referencePanel !== undefined) {
        group =
          options.position?.direction === 'within'
            ? groups.find((g) => g.panels.some((p) => p.id === referencePanel))
            : makeGroup()
      } else {
        group = (active !== null ? groupOf(active) : undefined) ?? groups[0] ?? makeGroup()
      }
      if (!group) group = makeGroup()
      const index = options.position?.index
      if (index === undefined) group.panels.push(panel)
      else group.panels.splice(index, 0, panel)
      if (options.inactive !== true) active = panel
      emit()
      return panel
    }
  }

  return {
    api: api as unknown as DockviewApi,
    groups,
    activeId: () => active?.id ?? null
  }
}

const SECTION = '/work/paper/manuscript/sections/01-introduction.md'
const PDF_A = '/work/paper/references/gunn1972.pdf'
const PDF_B = '/work/paper/references/jachym2019.pdf'
const PNG = '/work/paper/output/fig-spectrum.png'

describe('componentForFile', () => {
  it('routes PDFs to the pdf component', () => {
    expect(componentForFile(PDF_A)).toBe('pdf')
    expect(componentForFile('/work/paper/REPORT.PDF')).toBe('pdf')
  })

  it('routes raster images to the image component', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) {
      expect(componentForFile(`/work/paper/output/fig.${ext}`)).toBe('image')
    }
    expect(componentForFile('/work/paper/output/FIG.PNG')).toBe('image')
  })

  it('routes exported web pages and Word files to their viewers', () => {
    expect(componentForFile('/work/paper/output/manuscript.html')).toBe('html')
    expect(componentForFile('/work/paper/output/MANUSCRIPT.HTM')).toBe('html')
    expect(componentForFile('/work/paper/output/manuscript.docx')).toBe('docx')
    expect(componentForFile('/work/paper/output/MANUSCRIPT.DOCX')).toBe('docx')
  })

  it('leaves the existing routes alone', () => {
    expect(componentForFile('/work/paper/figures/f/figure.svg')).toBe('canvas')
    expect(componentForFile('/work/paper/data/table.csv')).toBe('dataview')
    expect(componentForFile('/work/paper/data/table.tsv')).toBe('dataview')
    expect(componentForFile(SECTION)).toBe('editor')
  })
})

describe('openInSplit', () => {
  let dock: ReturnType<typeof fakeDock>

  beforeEach(() => {
    dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
  })

  it('splits the active tab into a second group showing the same file', () => {
    openInSplit(SECTION, 'right')
    expect(dock.groups).toHaveLength(2)
    expect(dock.groups[0]?.panels).toHaveLength(1)
    expect(dock.groups[1]?.panels).toHaveLength(1)
    expect(dock.groups[1]?.panels[0]?.params['path']).toBe(SECTION)
    // panel ids are unique per dock, so the copy gets a derived id
    expect(dock.groups[1]?.panels[0]?.id).not.toBe(SECTION)
  })

  it('reuses the second group instead of splitting again', () => {
    openInSplit(SECTION, 'right')
    openInSplit(SECTION, 'right')
    openInSplit(SECTION, 'below')
    expect(dock.groups).toHaveLength(2)
    expect(dock.groups[1]?.panels).toHaveLength(1)
    expect(dock.activeId()).toBe(dock.groups[1]?.panels[0]?.id)
  })

  it('adds a different file to the existing side group as a new tab', () => {
    openInSplit(SECTION, 'right')
    openInSplit(PDF_A, 'right')
    expect(dock.groups).toHaveLength(2)
    expect(dock.groups[1]?.panels.map((p) => p.view.contentComponent)).toEqual(['editor', 'pdf'])
  })

  it('opens a plain tab when there is nothing to split from', () => {
    const empty = fakeDock()
    setDockApi(empty.api)
    openInSplit(PDF_A, 'right')
    expect(empty.groups).toHaveLength(1)
    expect(empty.groups[0]?.panels[0]?.id).toBe(PDF_A)
  })
})

describe('sideGroupId', () => {
  it('is null with a single group and names the second one after a split', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    expect(sideGroupId()).toBeNull()
    openInSplit(SECTION, 'right')
    expect(sideGroupId()).toBe(dock.groups[1]?.id)
  })
})

describe('openViewerInSide', () => {
  let dock: ReturnType<typeof fakeDock>

  beforeEach(() => {
    dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
  })

  it('creates the side group on the first call', () => {
    openViewerInSide(PDF_A)
    expect(dock.groups).toHaveLength(2)
    expect(dock.groups[1]?.panels[0]?.params['path']).toBe(PDF_A)
  })

  it('replaces the viewer instead of stacking tabs', () => {
    openViewerInSide(PDF_A)
    openViewerInSide(PDF_B)
    openViewerInSide(PNG)
    expect(dock.groups).toHaveLength(2)
    expect(dock.groups[1]?.panels).toHaveLength(1)
    expect(dock.groups[1]?.panels[0]?.params['path']).toBe(PNG)
    expect(dock.groups[1]?.panels[0]?.view.contentComponent).toBe('image')
    // the manuscript group is untouched
    expect(dock.groups[0]?.panels.map((p) => p.id)).toEqual([SECTION])
  })

  it('re-activates a viewer already showing that file', () => {
    openViewerInSide(PDF_A)
    const id = dock.groups[1]?.panels[0]?.id
    openFileTab(SECTION)
    openViewerInSide(PDF_A)
    expect(dock.groups[1]?.panels).toHaveLength(1)
    expect(dock.activeId()).toBe(id)
  })

  it('leaves a non-viewer tab parked in the side group alone', () => {
    openInSplit(SECTION, 'right')
    openViewerInSide(PDF_A)
    openViewerInSide(PDF_B)
    const side = dock.groups[1]?.panels ?? []
    expect(side).toHaveLength(2)
    expect(side.map((p) => p.view.contentComponent)).toEqual(['editor', 'pdf'])
    expect(side[1]?.params['path']).toBe(PDF_B)
  })
})

describe('activePanelPath', () => {
  it('is null with no dock, no active panel, and a special tab with no path param', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    expect(activePanelPath()).toBeNull()
    dock.api.addPanel({ id: 'settings', component: 'settings', title: 'Settings' })
    expect(activePanelPath()).toBeNull()
  })

  it('reads the active panel\'s params.path, tracking focus across the split', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    expect(activePanelPath()).toBe(SECTION)
    openInSplit(PDF_A, 'right')
    expect(activePanelPath()).toBe(PDF_A)
  })
})

describe('closeProjectTabs', () => {
  const OTHER_SECTION = '/work/other/manuscript/sections/01-introduction.md'
  const OTHER_PDF = '/work/other/references/gunn1972.pdf'

  it('closes editor/pdf/image tabs and the manuscript tab scoped to the old root, leaving the rest', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    openFileTab(OTHER_SECTION)
    openManuscriptTab('/work/paper')
    openManuscriptTab('/work/other')
    dock.api.addPanel({ id: 'settings', component: 'settings', title: 'Settings' })

    closeProjectTabs('/work/paper')

    const remainingIds = dock.groups.flatMap((g) => g.panels.map((p) => p.id))
    expect(remainingIds).toEqual(
      expect.arrayContaining([OTHER_SECTION, 'manuscript:/work/other', 'settings'])
    )
    expect(remainingIds).not.toContain(SECTION)
    expect(remainingIds).not.toContain('manuscript:/work/paper')
  })

  it('closes a side-group viewer scoped to the old root', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    openViewerInSide(PDF_A)
    openViewerInSide(OTHER_PDF)

    closeProjectTabs('/work/paper')

    const remainingIds = dock.groups.flatMap((g) => g.panels.map((p) => p.id))
    expect(remainingIds).toEqual([OTHER_PDF])
  })

  it('is a no-op with no dock attached', () => {
    setDockApi(null as unknown as DockviewApi)
    expect(() => closeProjectTabs('/work/paper')).not.toThrow()
  })
})

describe('welcome tab on an empty dock', () => {
  it('reopens the welcome tab when the user closes the last one', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    openFileTab(PDF_A)

    dock.api.getPanel(PDF_A)?.api.close()
    expect(dock.groups.flatMap((g) => g.panels.map((p) => p.id))).toEqual([SECTION])

    dock.api.getPanel(SECTION)?.api.close()
    expect(dock.groups.flatMap((g) => g.panels.map((p) => p.id))).toEqual(['welcome'])
  })

  it('leaves a project switch alone — the empty dock there is a transition', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    openManuscriptTab('/work/paper')

    closeProjectTabs('/work/paper')

    expect(dock.groups.flatMap((g) => g.panels)).toEqual([])
  })

  it('leaves clearDock alone — a driver asked for an empty dock', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)

    dockDevSeam.clearDock()

    expect(dock.groups.flatMap((g) => g.panels)).toEqual([])
  })
})

describe('retargetPanels', () => {
  const DATA_CSV = '/work/paper/data/table.csv'
  const DATA2_CSV = '/work/paper/data2/table.csv'

  it('follows a renamed/moved file, keeping its id, params and title in step', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)

    const moved = '/work/paper/manuscript/sections/01-intro.md'
    expect(retargetPanels(SECTION, moved)).toBe(1)

    const panels = dock.groups.flatMap((g) => g.panels)
    expect(panels).toHaveLength(1)
    expect(panels[0]?.id).toBe(moved)
    expect(panels[0]?.params['path']).toBe(moved)
    // The label is re-derived from the new path: carrying the old panel's
    // title over would leave the tab reading 01-introduction.md for a file
    // that no longer exists under that name.
    expect(panels[0]?.title).toBe('01-intro.md')
    expect(useOpenTabsStore.getState().paths.has(SECTION)).toBe(false)
    expect(useOpenTabsStore.getState().paths.has(moved)).toBe(true)
  })

  it('re-routes the tab when the new extension belongs to another component', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab('/work/paper/figures/f/draft.md')
    retargetPanels('/work/paper/figures/f/draft.md', '/work/paper/figures/f/draft.svg')
    expect(dock.groups[0]?.panels[0]?.view.contentComponent).toBe('canvas')
  })

  it('follows every tab inside a renamed directory', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(DATA_CSV)
    openFileTab('/work/paper/data/raw/notes.md')

    expect(retargetPanels('/work/paper/data', '/work/paper/measurements')).toBe(2)

    expect(dock.groups[0]?.panels.map((p) => p.id)).toEqual([
      '/work/paper/measurements/table.csv',
      '/work/paper/measurements/raw/notes.md'
    ])
  })

  it('leaves /work/paper/data2 alone when /work/paper/data moves', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(DATA_CSV)
    openFileTab(DATA2_CSV)

    expect(retargetPanels('/work/paper/data', '/work/paper/measurements')).toBe(1)

    expect(dock.groups[0]?.panels.map((p) => p.id)).toEqual([
      '/work/paper/measurements/table.csv',
      DATA2_CSV
    ])
  })

  it('rewrites nothing for a path no tab is showing, or for a no-op move', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    expect(retargetPanels('/work/paper/data/table.csv', '/work/paper/t.csv')).toBe(0)
    expect(retargetPanels(SECTION, SECTION)).toBe(0)
    expect(dock.groups[0]?.panels.map((p) => p.id)).toEqual([SECTION])
  })

  it('keeps the tab at its own index in its own group, without stealing focus', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    openFileTab(DATA_CSV)
    openViewerInSide(PDF_A)
    // the side viewer is frontmost; retargeting a background tab must not
    // pull the focus over to it
    expect(dock.activeId()).toBe(PDF_A)

    retargetPanels(SECTION, '/work/paper/manuscript/sections/01-intro.md')

    expect(dock.groups[0]?.panels.map((p) => p.id)).toEqual([
      '/work/paper/manuscript/sections/01-intro.md',
      DATA_CSV
    ])
    expect(dock.groups).toHaveLength(2)
    expect(dock.activeId()).toBe(PDF_A)
  })

  it('keeps the frontmost tab frontmost when it is the one that moved', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    retargetPanels(SECTION, '/work/paper/intro.md')
    expect(dock.activeId()).toBe('/work/paper/intro.md')
    expect(useOpenTabsStore.getState().activePath).toBe('/work/paper/intro.md')
  })

  it('is a no-op with no dock attached', () => {
    setDockApi(null as unknown as DockviewApi)
    expect(retargetPanels('/work/paper/a.md', '/work/paper/b.md')).toBe(0)
  })
})

describe('dockDevSeam', () => {
  it('reports group and panel structure for the split acceptance checks', () => {
    const dock = fakeDock()
    setDockApi(dock.api)
    openFileTab(SECTION)
    expect(dockDevSeam.groupCount()).toBe(1)
    openViewerInSide(PDF_A)
    expect(dockDevSeam.groupCount()).toBe(2)
    expect(dockDevSeam.groupPanelIds()).toEqual([[SECTION], [PDF_A]])
    expect(dockDevSeam.sideGroupId()).toBe(dock.groups[1]?.id)
  })
})
