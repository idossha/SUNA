import { useCallback, type JSX } from 'react'
import type { DockviewApi } from 'dockview'
import { TitleBar } from './shell/TitleBar'
import { ActivityBar } from './shell/ActivityBar'
import { SideBar } from './shell/SideBar'
import { StatusBar } from './shell/StatusBar'
import { DockHost, type DockPanelComponent } from './shell/dock/DockHost'
import { WelcomeTab } from './shell/WelcomeTab'
import { EditorTab } from './editor/EditorTab'
import { CanvasTab } from './canvas/CanvasTab'
import { ManuscriptTab } from './manuscript/ManuscriptTab'
import { SettingsTab } from './settings/SettingsTab'
import { TerminalPanel } from './terminal/TerminalPanel'
import { useUiStore } from './state/ui'
import { setDockApi } from './state/dock'

const DOCK_COMPONENTS: Record<string, DockPanelComponent> = {
  welcome: WelcomeTab,
  editor: EditorTab,
  canvas: CanvasTab,
  manuscript: ManuscriptTab,
  settings: SettingsTab
}

export function App(): JSX.Element {
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)

  const handleDockReady = useCallback((api: DockviewApi) => {
    setDockApi(api)
    api.addPanel({ id: 'welcome', component: 'welcome', title: 'Welcome' })
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <div
        className={
          sidebarVisible ? 'workbench' : 'workbench workbench--sidebar-hidden'
        }
      >
        <ActivityBar />
        {sidebarVisible && <SideBar />}
        <div className="dock-stage">
          <DockHost components={DOCK_COMPONENTS} onReady={handleDockReady} />
          <TerminalPanel />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
