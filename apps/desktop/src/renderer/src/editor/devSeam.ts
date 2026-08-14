import { useEditorSettings } from './settings'

/**
 * Dev-only seam for e2e drivers. Plain object, wired into window.__sunaDev
 * by the verifier (see main.tsx pattern) — not imported by production code.
 */
export const editorDevSeam = {
  settingsStore: useEditorSettings
}
