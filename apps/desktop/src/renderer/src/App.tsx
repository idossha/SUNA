import { useCallback, useEffect, type JSX } from 'react'
import type { DockviewApi } from 'dockview'
import { TitleBar } from './shell/TitleBar'
import { ActivityBar } from './shell/ActivityBar'
import { SideBar } from './shell/SideBar'
import { StatusBar } from './shell/StatusBar'
import { Toasts } from './shell/Toasts'
import { DockHost, type DockPanelComponent } from './shell/dock/DockHost'
import { WelcomeTab } from './shell/WelcomeTab'
import { EditorTab } from './editor/EditorTab'
import { CanvasTab } from './canvas/CanvasTab'
import { DataGridTab } from './dataview/DataGridTab'
import { DocxImportTab } from './import/DocxImportTab'
import { ExportDialog } from './export/ExportDialog'
import { ManuscriptTab } from './manuscript/ManuscriptTab'
import { OnboardingTab } from './onboarding/OnboardingTab'
import { ReadingNotesTab } from './viewer/ReadingNotesTab'
import { SettingsTab } from './settings/SettingsTab'
import { TrashTab } from './shell/TrashTab'
import { TerminalPanel } from './terminal/TerminalPanel'
import { PdfTab } from './viewer/PdfTab'
import { ImageTab } from './viewer/ImageTab'
import { HtmlTab } from './viewer/HtmlTab'
import { DocxTab } from './viewer/DocxTab'
import { CommandPalette } from './palette/CommandPalette'
import { HelpOverlay } from './shell/help/HelpOverlay'
import { RepairPicker } from './shell/repair/RepairPicker'
import { FloatingTerminal } from './shell/screenask/FloatingTerminal'
import { ScreenAskComposer } from './shell/screenask/ScreenAskComposer'
import { TourOverlay } from './tour/TourOverlay'
import { LetterTab } from './documents/LetterTab'
import { SupplementTab } from './documents/SupplementTab'
import { RoundTab } from './documents/RoundTab'
import { VersionTab } from './documents/VersionTab'
import { CompareTab } from './documents/CompareTab'
import { ReviewImportTab } from './documents/ReviewImportTab'
import { useUiStore } from './state/ui'
import { useEditorSettings } from './editor/settings'
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
  letter: LetterTab,
  supplement: SupplementTab,
  round: RoundTab,
  version: VersionTab,
  compare: CompareTab,
  'review-import': ReviewImportTab,
  onboarding: OnboardingTab,
  'docx-import': DocxImportTab,
  export: ExportDialog,
  settings: SettingsTab,
  trash: TrashTab,
  'reading-notes': ReadingNotesTab,
  pdf: PdfTab,
  image: ImageTab,
  html: HtmlTab,
  docx: DocxTab
}

export function App(): JSX.Element {
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const railVisible = useUiStore((s) => s.railVisible)
  // Same store EditorTab renders its theme class from, so chrome and editor
  // surface can never disagree. tokens.css keys its chrome palettes off this
  // attribute; a theme without a block there (suna-dark) leaves the :root
  // palette — i.e. today's look — untouched.
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  // Mirrored onto <body> for body-portalled chrome (ProjectMenu) and the body
  // background itself, both of which sit outside the .app subtree.
  useEffect(() => {
    document.body.setAttribute('data-suna-theme', editorTheme)
    return () => document.body.removeAttribute('data-suna-theme')
  }, [editorTheme])

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
    <div className="app" data-suna-theme={editorTheme}>
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
      {/* Same z-200 layer as the palette; only one of the two is ever open
          (the palette's input is a typing surface, so '?' can't open help
          over it). RepairPicker sits above both at z-210 — a repair report
          may be about those overlays themselves. */}
      <HelpOverlay />
      <RepairPicker />
      {/* Screen-ask sits at z-215, between the repair picker and the tour: an
          ask may be ABOUT the palette or the help dialog. Its floating
          terminal is lower (z-150) — a working window, not a modal. */}
      <ScreenAskComposer />
      <FloatingTerminal />
      {/* Above both (z-220): a tour step may point AT the palette or the help
          dialog, and its card has to stay readable over them. */}
      <TourOverlay />
      <Toasts />
    </div>
  )
}
