import type { CSSProperties } from 'react'
import { editorSurfaceStyle, type EditorSettings } from '../editor/settings'

/**
 * The manuscript tab's root style-vars object: `--ed-content-width`,
 * `--ed-font-size`, `--ed-line-height`, `--ed-body-font`.
 *
 * Delegates to `editorSurfaceStyle` (the exact function `EditorTab` uses) so
 * the combined document — title page, every section editor, and the
 * references block, all nested inside `.msdoc__page` — reflows from
 * *literally the same* vars EditorTab publishes. See
 * ARCHITECTURE §17.3 rule 3 ("one measure for the whole
 * document"): before this, the tab built its own inline style object by
 * hand, which is exactly the kind of duplication that lets the two surfaces
 * drift apart into "two measures" for one document.
 *
 * Kept as a named export — rather than inlined in ManuscriptTab's render —
 * so this parity is independently testable without mounting the component.
 */
export function manuscriptStyleVars(settings: EditorSettings): CSSProperties {
  return editorSurfaceStyle(settings)
}
