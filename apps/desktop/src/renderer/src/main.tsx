import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { canvasToolsSeam } from './canvas/dev-seam'
import { dataviewDevSeam } from './dataview/devSeam'
import { editorDevSeam } from './editor/devSeam'
import { manuscriptDevSeam } from './manuscript/devSeam'
import { openFileTab } from './state/dock'
import { useAgentChatStore } from './state/agentChat'
import { useExplorerStore } from './state/explorer'
import { useManuscriptStore } from './state/manuscript'
import { useProjectStore } from './state/project'
import { useRenderProfileStore } from './state/renderProfile'
import { useUiStore } from './state/ui'
import './styles/app.css'
import 'katex/dist/katex.min.css'

// Dev-only seam for e2e drivers (CDP): bypasses native dialogs.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __sunaDev: {
      openFileTab,
      projectStore: useProjectStore,
      uiStore: useUiStore,
      canvasTools: canvasToolsSeam,
      editorSettings: editorDevSeam.settingsStore,
      editorViewModes: editorDevSeam.viewModes,
      editorBibDiagnostics: editorDevSeam.bibDiagnostics,
      // fileName -> 'prose' | 'code' and the matching root modifier class,
      // so a driver can assert layout-by-content-kind without guessing at
      // class names (docs/design/ui-fix-plan.md, work item 1).
      editorContentKindFor: editorDevSeam.contentKindFor,
      editorContentKindClass: editorDevSeam.contentKindClass,
      dataGrid: dataviewDevSeam,
      explorerStore: useExplorerStore,
      manuscriptStore: useManuscriptStore,
      manuscriptDocStore: manuscriptDevSeam.docStore,
      // 'Rendered as' preview profile, shared by the References view and the
      // combined manuscript tab (work items 3–5).
      renderProfileStore: useRenderProfileStore,
      agentChatStore: useAgentChatStore
    }
  })
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('missing #root element')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
