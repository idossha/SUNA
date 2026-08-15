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
import { DataGridTab } from './dataview/DataGridTab'
import { ManuscriptTab } from './manuscript/ManuscriptTab'
import { SettingsTab } from './settings/SettingsTab'
import { TerminalPanel } from './terminal/TerminalPanel'
import { PdfTab } from './viewer/PdfTab'
import { ImageTab } from './viewer/ImageTab'
import { CommandPalette } from './palette/CommandPalette'
import { useUiStore } from './state/ui'
import { setDockApi } from './state/dock'
// Registers the app's built-in commands as an import side effect (state/commands.ts).
import './state/commands'

const DOCK_COMPONENTS: Record<string, DockPanelComponent> = {
  welcome: WelcomeTab,
  editor: EditorTab,
  canvas: CanvasTab,
  dataview: DataGridTab,
  manuscript: ManuscriptTab,
  settings: SettingsTab,
  pdf: PdfTab,
  image: ImageTab
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
      <CommandPalette />
    </div>
  )
}
