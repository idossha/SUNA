import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from 'dockview'

let dockApi: DockviewApi | null = null

export function setDockApi(api: DockviewApi): void {
  dockApi = api
}

/** Split targets we offer: beside the reference group, or under it. */
export type SplitDirection = 'right' | 'below'

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

/**
 * Components openViewerInSide treats as replaceable: opening a second PDF in
 * the side group swaps the first out instead of stacking tabs, while an editor
 * the user parked there is left alone.
 */
const VIEWER_COMPONENTS = new Set(['pdf', 'image'])

/** Which dock component owns a file, by extension. Default: the editor. */
export function componentForFile(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.svg')) return 'canvas'
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'dataview'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'image'
  return 'editor'
}

function titleForFile(path: string): string {
  return path.split('/').pop() ?? path
}

export function openFileTab(path: string): void {
  if (!dockApi) return
  const existing = dockApi.getPanel(path)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id: path,
    component: componentForFile(path),
    title: titleForFile(path),
    params: { path }
  })
}

/** Open (or focus) the global Settings tab. */
export function openSettingsTab(): void {
  if (!dockApi) return
  const existing = dockApi.getPanel('settings')
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({ id: 'settings', component: 'settings', title: 'Settings' })
}

/** Open (or focus) the combined manuscript document tab for a project. */
export function openManuscriptTab(rootDir: string): void {
  if (!dockApi) return
  const id = `manuscript:${rootDir}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'manuscript',
    title: 'Manuscript',
    params: { rootDir }
  })
}

/**
 * The secondary ("side") group, or null while the dock has a single group.
 * `api.groups` is creation-ordered, so the first group is the one the app's
 * own tabs opened into and everything after it is a split the user (or
 * openInSplit) made. Reusing it is what keeps ⌘\ from splitting endlessly.
 */
function sideGroup(): DockviewGroupPanel | null {
  if (!dockApi) return null
  const groups = dockApi.groups
  if (groups.length < 2) return null
  return groups[1] ?? null
}

/** Id of the existing side group, or null when the dock has only one group. */
export function sideGroupId(): string | null {
  return sideGroup()?.id ?? null
}

/**
 * The active panel's file path (its `params.path`), or null when nothing is
 * active or the active panel is a special tab with no `path` param (welcome,
 * settings, the combined manuscript view — those key off `rootDir` instead).
 * Feeds the split commands (feature-plan-4 §1/§5): "duplicate the ACTIVE tab".
 */
export function activePanelPath(): string | null {
  const panel = dockApi?.activePanel
  if (!panel) return null
  const value = panel.params?.['path']
  return typeof value === 'string' ? value : null
}

/** A panel in `group` already showing `path`, if there is one. */
function panelForPath(group: DockviewGroupPanel, path: string): IDockviewPanel | null {
  for (const panel of group.panels) {
    const param = panel.params?.['path']
    if (panel.id === path || (typeof param === 'string' && param === path)) return panel
  }
  return null
}

/**
 * A free panel id for `path`. Panel ids are unique per dock, so splitting a
 * file that is already open needs a second id — `path`, then `path::2`, …
 */
function freePanelId(path: string): string {
  if (!dockApi || !dockApi.getPanel(path)) return path
  for (let n = 2; n < 1000; n += 1) {
    const id = `${path}::${n}`
    if (!dockApi.getPanel(id)) return id
  }
  return `${path}::${Date.now()}`
}

/**
 * Open `path` in the group beside/below the active one, creating that group on
 * the first call and reusing it afterwards (feature-plan-4 §1). Calling it
 * twice for the same file leaves exactly two groups, the second focused on it.
 */
export function openInSplit(path: string, direction: SplitDirection): void {
  if (!dockApi) return
  const api = dockApi
  const target = sideGroup()

  if (target) {
    const existing = panelForPath(target, path)
    if (existing) {
      existing.api.setActive()
      return
    }
    api.addPanel({
      id: freePanelId(path),
      component: componentForFile(path),
      title: titleForFile(path),
      params: { path },
      position: { referenceGroup: target }
    })
    return
  }

  const reference = api.activePanel ?? api.panels[0]
  if (!reference) {
    // Nothing to split from yet — the first tab has to exist somewhere.
    openFileTab(path)
    return
  }
  api.addPanel({
    id: freePanelId(path),
    component: componentForFile(path),
    title: titleForFile(path),
    params: { path },
    position: { referencePanel: reference.id, direction }
  })
}

/**
 * Show `path` in the side group as *the* viewer there: any PDF/image tab
 * already in that group is closed once the new one is in place, so clicking
 * three references in a row leaves one tab showing the last (feature-plan-4
 * §4). The new panel is added before the old ones are closed — closing the
 * group's last panel would destroy the group and collapse the split.
 */
export function openViewerInSide(path: string): void {
  if (!dockApi) return
  openInSplit(path, 'right')

  const target = sideGroup()
  if (!target) return
  const keep = panelForPath(target, path)
  if (!keep) return
  for (const panel of [...target.panels]) {
    if (panel.id === keep.id) continue
    if (VIEWER_COMPONENTS.has(panel.view.contentComponent)) panel.api.close()
  }
  keep.api.setActive()
}

/**
 * Dev-only seam for e2e drivers (main.tsx wires it under `window.__sunaDev`):
 * split/side-viewer commands plus the group/panel readouts the split-view
 * acceptance checks need ("still exactly 2 groups", "one PDF tab").
 */
export const dockDevSeam = {
  componentForFile,
  openFileTab,
  openInSplit,
  openViewerInSide,
  sideGroupId,
  activePanelPath,
  groupCount: (): number => dockApi?.groups.length ?? 0,
  /** Panel ids per group, in dock order — groups()[0] is the primary group. */
  groupPanelIds: (): string[][] =>
    (dockApi?.groups ?? []).map((group) => group.panels.map((panel) => panel.id)),
  /** Component name per open panel id — lets a driver tell a 'pdf' tab from
   *  an 'editor' one without re-deriving it from the path. */
  panelComponents: (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const panel of dockApi?.panels ?? []) out[panel.id] = panel.view.contentComponent
    return out
  },
  /**
   * Close every panel, leaving one empty group. Splitting is defined against
   * "the group the app's own tabs opened into" (see `sideGroup`), so a driver
   * measuring "⌘\ yields exactly 2 groups" needs a known starting dock rather
   * than whatever the previous step left behind.
   */
  clearDock: (): void => dockApi?.clear()
}
