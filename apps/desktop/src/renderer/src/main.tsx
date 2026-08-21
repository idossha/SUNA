import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { canvasToolsSeam } from './canvas/dev-seam'
import { dataviewDevSeam } from './dataview/devSeam'
import { schemaDevSeam } from './dev/schemaSeam'
import { editorDevSeam } from './editor/devSeam'
import { manuscriptDevSeam } from './manuscript/devSeam'
import { onboardingSeam } from './onboarding/devSeam'
import { settingsDevSeam } from './settings/devSeam'
import { screenAskDevSeam } from './shell/screenask/devSeam'
import { terminalDevSeam } from './terminal/devSeam'
import { commandsDevSeam } from './state/commands'
import { dockDevSeam, openFileTab } from './state/dock'
import { useAgentChatStore } from './state/agentChat'
import { useCommentsStore } from './state/comments'
import { peekDocSessionText, useDocSessionsStore } from './state/docSessions'
import { useRevisionsStore } from './state/revisions'
import { useExplorerStore } from './state/explorer'
import { useManuscriptStore } from './state/manuscript'
import { openProjectAt, useProjectStore } from './state/project'
import { getReferencePdf, useReferencePdfsStore } from './state/referencePdfs'
import { useRenderProfileStore } from './state/renderProfile'
import { useTourStore } from './state/tour'
import { useUiStore } from './state/ui'
import './styles/app.css'
import { useRoundFocusStore } from './state/roundFocus'
import { useAiActionsStore } from './state/aiActions'
import { runPeerReviewLearn } from './ai/directedActions'
import 'katex/dist/katex.min.css'

// Dev-only seam for e2e drivers (CDP): bypasses native dialogs.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __sunaDev: {
      openFileTab,
      projectStore: useProjectStore,
      // --- feature-plan-7 ---------------------------------------------------
      // Project switcher (§3): the title-bar menu's own "Open project…" opens a
      // NATIVE directory picker a CDP driver cannot operate, so the one
      // switching function is seamed directly. It re-points the whole app
      // (store, comments, reference PDFs, settings, open tabs) and runs the
      // flat-manuscript migration, so a driver asserts the switch by calling
      // this and then reading projectStore/dock/commentsStore.
      openProjectAt,
      uiStore: useUiStore,
      // The guided tour (tour/steps.ts): a driver starts it, steps it and
      // reads which card is showing without having to synthesise clicks on
      // an overlay that deliberately does not capture them.
      tourStore: useTourStore,
      // Shared doc sessions (state/docSessions): the smoke driver reads
      // buffer truth (before a save reaches disk) and session meta to assert
      // the cross-tab live sync and the external-reload flow.
      docSessions: { peek: peekDocSessionText, meta: useDocSessionsStore },
      revisionsStore: useRevisionsStore,
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
      agentChatStore: useAgentChatStore,
      // The reviewer-response surfaces: the focus/continuous mode and point
      // selection the round tab and its outline share, and the directed-AI
      // run/proposal store. A driver pushes a proposal through the store
      // rather than spawning a CLI, so a probe for the ✦ assistant stays
      // offline and deterministic.
      roundFocusStore: useRoundFocusStore,
      aiActionsStore: useAiActionsStore,
      // The approval sheet's "learn from a past letter" route. Seamed
      // because its own entry point is a NATIVE file picker, which CDP
      // cannot operate — the same reason openDocxImportTab is seamed.
      peerReviewLearn: runPeerReviewLearn,
      // manuscript/comments.json state — a driver reloads it after an
      // out-of-band write (an MCP add_comment) instead of restarting the app,
      // and reads `comments` to assert anchoring/detached flips
      // (docs/design/feature-plan-2.md §2).
      commentsStore: useCommentsStore,
      // Schema-validate a file the app just wrote using the REAL @suna/core
      // schemas. Workspace packages are raw TS, so a driver script cannot
      // import them directly — see dev/schemaSeam.ts
      // (feature-plan-3 §4 asserts a schema-valid figure.json on disk).
      validateDoc: schemaDevSeam.validateDoc,
      validateFile: schemaDevSeam.validateFile,
      // --- feature-plan-4 -------------------------------------------------
      // Split view (§1): openInSplit/openViewerInSide plus the group/panel
      // readouts the "exactly 2 groups" / "exactly one PDF tab" acceptance
      // checks measure (state/dock.ts).
      //
      // --- feature-plan-6 --------------------------------------------------
      // Also carries openDocxImportTab (§2) and openExportTab (§3/§4), which
      // bypass the native file/folder pickers a CDP driver cannot operate.
      // NOT yet seamed: the import review's own "Import into new project…"
      // button still opens a native directory picker, so a full
      // analyze→review→commit e2e needs a target-directory seam inside
      // import/DocxImportTab.tsx (see docs/design/roadmap.md).
      dock: dockDevSeam,
      // Command registry (§5): list/inspect/run a command by id, so a driver
      // can assert '>split right' without synthesizing every keystroke.
      commands: commandsDevSeam,
      // citekey -> resolved PDF map (§3/§4), scanned per project + saveBump.
      referencePdfsStore: useReferencePdfsStore,
      getReferencePdf,
      // Settings store (feature-plan-4 §4's 'references.autoOpenPdf', and
      // feature-plan-5 §4's two-level hierarchy: `resolved.value` /
      // `resolved.sources` per key, plus setGlobal/setProject/clearProject and
      // refreshProjectSettings for an out-of-band suna.json edit).
      settingsStore: settingsDevSeam.settingsStore,
      settingsDefaults: settingsDevSeam.defaults,
      // Integrated terminal (§5 '$' mode): tab metadata + the panel store.
      terminal: terminalDevSeam,
      // --- feature-plan-5 -------------------------------------------------
      // Onboarding wizard (§5): read/patch the visible wizard's state so a
      // driver can walk all seven steps past step 1's NATIVE folder picker,
      // which CDP cannot drive (onboarding/devSeam.ts).
      onboarding: onboardingSeam,
      // Screen-ask (⌘⇧A): the composer/region phases, the floating terminal's
      // own store, and openFloatWith — which builds the same float session the
      // ask would, around a command of the driver's choosing, so the window's
      // chrome can be exercised without spawning a real agent.
      screenAsk: screenAskDevSeam
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
