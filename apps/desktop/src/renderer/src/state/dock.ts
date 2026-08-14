import type { DockviewApi } from 'dockview'

let dockApi: DockviewApi | null = null

export function setDockApi(api: DockviewApi): void {
  dockApi = api
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
    component: path.endsWith('.svg') ? 'canvas' : 'editor',
    title: path.split('/').pop() ?? path,
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
