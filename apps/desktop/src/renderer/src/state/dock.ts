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
