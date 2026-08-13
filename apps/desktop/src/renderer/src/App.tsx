import { useCallback, type JSX } from 'react'
import type { DockviewApi } from 'dockview'
import { TitleBar } from './shell/TitleBar'
import { ActivityBar } from './shell/ActivityBar'
import { SideBar } from './shell/SideBar'
import { StatusBar } from './shell/StatusBar'
import { DockHost, type DockPanelComponent } from './shell/dock/DockHost'
import { WelcomeTab } from './shell/WelcomeTab'
import { useUiStore } from './state/ui'

const DOCK_COMPONENTS: Record<string, DockPanelComponent> = {
  welcome: WelcomeTab
}

export function App(): JSX.Element {
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)

  const handleDockReady = useCallback((api: DockviewApi) => {
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
        <DockHost components={DOCK_COMPONENTS} onReady={handleDockReady} />
      </div>
      <StatusBar />
    </div>
  )
}
