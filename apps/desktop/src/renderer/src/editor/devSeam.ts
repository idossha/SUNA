import { useEditorSettings } from './settings'
import { EDITOR_VIEW_MODES } from './EditorTab'

/**
 * Dev-only seam for e2e drivers. Plain object, wired into window.__sunaDev
 * by the verifier (see main.tsx pattern) — not imported by production code.
 */
export const editorDevSeam = {
  settingsStore: useEditorSettings,
  /** The editor's view modes, in toggle order: reading is the editable live preview. */
  viewModes: EDITOR_VIEW_MODES
}
