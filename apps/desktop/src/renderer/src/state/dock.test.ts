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
  setDockApi,
  sideGroupId,
  dockDevSeam
} from './dock'

/**
 * A fake dockview just big enough for the split logic: groups in creation
 * order, panels inside them, and the placement rules of `addPanel` —
 * `referenceGroup` appends to that group, `referencePanel` + direction makes a
 * new group, no position appends to the active group.
 */
interface FakePanel {
  id: string
  params: Record<string, unknown>
  view: { contentComponent: string }
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
  position?: {
    referenceGroup?: FakeGroup | string
    referencePanel?: string
    direction?: string
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

  const groupOf = (panel: FakePanel): FakeGroup | undefined =>
    groups.find((group) => group.panels.includes(panel))

  const makeGroup = (): FakeGroup => {
    const group: FakeGroup = { id: `group-${nextGroup++}`, panels: [] }
    groups.push(group)
    return group
  }

  const api = {
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
    addPanel(options: AddOptions) {
      const panel: FakePanel = {
        id: options.id,
        params: options.params ?? {},
        view: { contentComponent: options.component },
        api: {
          setActive: () => {
            active = panel
          },
          close: () => {
            const group = groupOf(panel)
            if (!group) return
            group.panels = group.panels.filter((p) => p !== panel)
            if (group.panels.length === 0) groups.splice(groups.indexOf(group), 1)
            if (active === panel) active = null
          }
        }
      }
      const reference = options.position?.referenceGroup
      let group: FakeGroup | undefined
      if (reference !== undefined) {
        group =
          typeof reference === 'string' ? groups.find((g) => g.id === reference) : reference
      } else if (options.position?.referencePanel !== undefined) {
        group = makeGroup()
      } else {
        group = (active !== null ? groupOf(active) : undefined) ?? groups[0] ?? makeGroup()
      }
      if (!group) group = makeGroup()
      group.panels.push(panel)
      active = panel
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
