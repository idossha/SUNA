import { bibDiagnostics } from './bibLang'
import { useEditorSettings } from './settings'
import { EDITOR_VIEW_MODES } from './EditorTab'
import { CONTENT_KIND_CLASS, contentKindFor } from './contentKind'

/**
 * Dev-only seam for e2e drivers. Plain object, wired into window.__sunaDev
 * by the verifier (see main.tsx pattern) — not imported by production code.
 */
export const editorDevSeam = {
  settingsStore: useEditorSettings,
  /** The editor's view modes, in toggle order: reading is the editable live preview. */
  viewModes: EDITOR_VIEW_MODES,
  /**
   * Pure .bib diagnostics (parse errors, duplicate keys, missing required
   * fields) so a driver can assert linting without reading CM internals.
   */
  bibDiagnostics,
  /**
   * fileName -> 'prose' | 'code'. 'prose' is .md/.markdown only. Drives the
   * `.editor-tab--prose` / `.editor-tab--code` root modifier class a driver
   * can assert on directly (see CONTENT_KIND_CLASS).
   */
  contentKindFor,
  contentKindClass: CONTENT_KIND_CLASS
}
