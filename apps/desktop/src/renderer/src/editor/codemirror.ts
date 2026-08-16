import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { linter, lintGutter } from '@codemirror/lint'
import { vim } from '@replit/codemirror-vim'
import { livePreview } from './livePreview'
import { sunaJsonLinter } from './jsonLint'
import { bibLanguage, bibLinter } from './bibLang'
import { editorTheme } from './themes'
import { contentKindFor } from './contentKind'
import { formattingKeymap, type FormattingCallbacks } from './keymap'
import { openContextMenu } from './ContextMenu'
import { citationKeyAtLineOffset } from './citationHit'
import { getReferencePdf } from '../state/referencePdfs'
import type { EditorThemeName } from './settings'
import type { OpenReferencePdfHit } from './contextMenuItems'

/** Extension-based language pick. Anything unknown stays plain and falls
 *  back to the shared highlight style. */
export function languageExtensions(fileName: string): Extension[] {
  const lower = fileName.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  switch (ext) {
    case '.md':
    case '.markdown':
      return [markdown()]
    case '.json':
      return [json(), lintGutter(), linter(sunaJsonLinter(lower))]
    case '.bib':
      return [bibLanguage(), lintGutter(), linter(bibLinter)]
    case '.py':
      return [python()]
    case '.js':
    case '.mjs':
      return [javascript()]
    case '.ts':
      return [javascript({ typescript: true })]
    default:
      return []
  }
}

export interface CreateEditorOptions {
  parent: HTMLElement
  doc: string
  fileName: string
  /** Absolute path of the file being edited; lets live preview resolve
   *  relative markdown image urls against the file that contains them. */
  filePath?: string
  /** Project root; lets live preview find figures/<id>/figure.svg. */
  rootDir?: string | null
  theme: EditorThemeName
  live: boolean
  /** Vim motions/keymap; works in both source and reading mode. */
  vim?: boolean
  /** Read-only surfaces (e.g. the data grid's text view) skip the save keymap. */
  readOnly?: boolean
  onDocChanged: () => void
  onSave: () => void
  /**
   * Formatting UX (feature-plan-3.md §1): ⌘B/⌘I/⌘⇧C/⌘⇧X/⌘K always work on
   * prose files (contentKindFor === 'prose'); ⌘⇧M and ⌘⇧K plus the
   * right-click context menu's "Comment" and "Insert citation…" items only
   * do anything when the host supplies the matching callback below — the
   * item is simply left out of the menu, and the shortcut is unhandled
   * (falls through to the next binding), when it's absent. Ignored for
   * non-prose files.
   */
  onComment?: (view: EditorView) => void
  onInsertCitation?: (view: EditorView) => void
}

export interface EditorHandle {
  view: EditorView
  /** Toggle Obsidian-style live preview decorations (markdown only). */
  setLive: (on: boolean) => void
  /** Swap the editor-surface theme without losing document state. */
  setTheme: (name: EditorThemeName) => void
  /** Toggle the vim keymap without losing document state. */
  setVim: (on: boolean) => void
  /**
   * Re-measure font metrics and line/widget heights.
   *
   * CodeMirror caches character width, line height and every block widget's
   * height in its height map, and re-measures only on its own triggers (doc
   * changes, its ResizeObserver, viewport changes). This app changes the
   * editor's typography from OUTSIDE CodeMirror — `editorSurfaceStyle` writes
   * `--ed-font-size` / `--ed-line-height` / `--ed-body-font` as CSS custom
   * properties on the host — and a custom-property change fires none of those
   * triggers. The height map then keeps the OLD metrics while the DOM renders
   * the new ones, and `posAtCoords` (which maps a click to a document
   * position through that height map) drifts from what the user sees.
   *
   * Measured before this existed, in the combined manuscript document at
   * 14 px/1.6: clicks below the first block widget landed a whole line low —
   * the height map was ~11 px short over a figure widget whose height had
   * changed with the line height. Call this after any typography change.
   */
  remeasure: () => void
  destroy: () => void
}

/**
 * The citation under a right-click, if any (feature-plan-4.md §3): hit-tests
 * the click to a document position, slices out that line, and runs the pure
 * `citationKeyAtLineOffset` grammar over it — then resolves the key against
 * the project's reference-PDF map (state/referencePdfs.ts). Returns null
 * (hiding the menu item) when the click landed off any citation.
 */
function citationHitAt(view: EditorView, clientX: number, clientY: number): OpenReferencePdfHit | null {
  const pos = view.posAtCoords({ x: clientX, y: clientY })
  if (pos === null) return null
  const line = view.state.doc.lineAt(pos)
  const key = citationKeyAtLineOffset(line.text, pos - line.from)
  if (key === null) return null
  return { key, path: getReferencePdf(key)?.path ?? null }
}

export function createEditor(options: CreateEditorOptions): EditorHandle {
  const themeCompartment = new Compartment()
  const liveCompartment = new Compartment()
  const vimCompartment = new Compartment()

  // Prose wraps at the content-width measure; code/data scroll horizontally
  // instead so statements and long tokens never soft-break mid-line.
  const isProse = contentKindFor(options.fileName) === 'prose'
  // Captured once: both the initial extension and every setLive() reconfigure
  // must resolve images against the same file, or toggling reading mode would
  // silently stop finding them.
  const livePreviewConfig = {
    rootDir: options.rootDir ?? null,
    filePath: options.filePath ?? null
  }
  const wrapping: Extension = isProse ? EditorView.lineWrapping : []
  const formattingCallbacks: FormattingCallbacks = {
    onComment: options.onComment,
    onInsertCitation: options.onInsertCitation
  }

  const extensions: Extension[] = [
    // vim() must precede every other keymap: it installs its own high-priority
    // input handler and only wins if CM6 sees it first (per its README).
    vimCompartment.of(options.vim === true ? vim() : []),
    lineNumbers(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          options.onSave()
          return true
        }
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap
    ]),
    themeCompartment.of(editorTheme(options.theme)),
    liveCompartment.of(options.live ? livePreview(livePreviewConfig) : []),
    wrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onDocChanged()
    }),
    ...languageExtensions(options.fileName),
    // Word/Flux-grade formatting UX (feature-plan-3.md §1) — prose only,
    // and after the language/keymap extensions above so Prec.high inside
    // formattingKeymap wins regardless of source order.
    ...(isProse
      ? [
          formattingKeymap(formattingCallbacks),
          EditorView.domEventHandlers({
            contextmenu: (event, view) => {
              event.preventDefault()
              openContextMenu(
                view,
                event.clientX,
                event.clientY,
                formattingCallbacks,
                citationHitAt(view, event.clientX, event.clientY)
              )
            }
          })
        ]
      : [])
  ]

  if (options.readOnly === true) extensions.push(EditorState.readOnly.of(true))

  const view = new EditorView({
    state: EditorState.create({ doc: options.doc, extensions }),
    parent: options.parent
  })

  return {
    view,
    setLive: (on) => {
      view.dispatch({ effects: liveCompartment.reconfigure(on ? livePreview(livePreviewConfig) : []) })
    },
    setTheme: (name) => {
      view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(name)) })
    },
    setVim: (on) => {
      view.dispatch({ effects: vimCompartment.reconfigure(on ? vim() : []) })
    },
    // `requestMeasure` alone re-reads geometry but keeps the cached font
    // metrics; `setState`-free invalidation is what CodeMirror exposes for
    // "my fonts changed" — dispatching an empty transaction after clearing
    // the measured heights is not public API, so this uses the documented
    // pair: requestMeasure schedules the read, and the docView's own
    // `checkLayout` picks up the new character width and line height from it.
    remeasure: () => {
      view.requestMeasure()
    },
    destroy: () => view.destroy()
  }
}
