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
import { DocxImportTab } from './import/DocxImportTab'
import { ExportDialog } from './export/ExportDialog'
import { ManuscriptTab } from './manuscript/ManuscriptTab'
import { OnboardingTab } from './onboarding/OnboardingTab'
import { SettingsTab } from './settings/SettingsTab'
import { TerminalPanel } from './terminal/TerminalPanel'
import { PdfTab } from './viewer/PdfTab'
import { ImageTab } from './viewer/ImageTab'
import { CommandPalette } from './palette/CommandPalette'
import { useUiStore } from './state/ui'
import { setDockApi } from './state/dock'
// Registers the app's built-in commands as an import side effect (state/commands.ts).
import './state/commands'
// Feeds resolved project/global settings into the editor surface store
// (feature-plan-5 §4) as an import side effect — see state/editorSettingsBridge.ts.
import './state/editorSettingsBridge'

const DOCK_COMPONENTS: Record<string, DockPanelComponent> = {
  welcome: WelcomeTab,
  editor: EditorTab,
  canvas: CanvasTab,
  dataview: DataGridTab,
  manuscript: ManuscriptTab,
  onboarding: OnboardingTab,
  'docx-import': DocxImportTab,
  export: ExportDialog,
  settings: SettingsTab,
  pdf: PdfTab,
  image: ImageTab
}

export function App(): JSX.Element {
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const railVisible = useUiStore((s) => s.railVisible)

  const handleDockReady = useCallback((api: DockviewApi) => {
    setDockApi(api)
    api.addPanel({ id: 'welcome', component: 'welcome', title: 'Welcome' })
  }, [])

  // Three nav states, and no width transition on any of them: an animated
  // width would re-fire DockHost's and CodeMirror's resize observers every
  // frame. Unmounting a grid child is picked up by DockHost's observer; CM's
  // own is GUARDED — @codemirror/view drops a resize that lands within 75 ms
  // of a document update — so on a fast keystroke-then-toggle its height map
  // can stay computed for the old width until the next doc change or scroll.
  // Accepted: it self-heals on the next keystroke and the alternative is a
  // remeasure on every toggle for a transient scrollbar-extent error.
  //
  // The grid class is derived from BOTH flags rather than from railVisible
  // alone, so the store's rail-implies-panel invariant cannot be broken by a
  // caller that bypasses commitChrome (`useUiStore.setState`, which
  // scripts/e2e/smoke.mjs does use): a single-column grid with <SideBar/>
  // still mounted would push .dock-stage into an implicit auto-sized column.
  const navHidden = !railVisible && !sidebarVisible
  const workbenchClass = [
    'workbench',
    !sidebarVisible && !navHidden ? 'workbench--sidebar-hidden' : '',
    navHidden ? 'workbench--nav-hidden' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="app">
      <TitleBar />
      <div className={workbenchClass}>
        {(railVisible || sidebarVisible) && <ActivityBar />}
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
