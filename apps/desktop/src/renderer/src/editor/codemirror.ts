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
import { Vim, getCM, vim } from '@replit/codemirror-vim'
import { livePreview } from './livePreview'
import { exRegistry } from './vimEx'
import { moveByDocumentLines } from './vimMotions'
import { sunaJsonLinter } from './jsonLint'
import { bibLanguage, bibLinter } from './bibLang'
import { editorTheme } from './themes'
import { contentKindFor } from './contentKind'
import { formattingKeymap, type FormattingCallbacks } from './keymap'
import { openContextMenu } from './ContextMenu'
import { citationKeyAtLineOffset } from './citationHit'
import { getReferencePdf } from '../state/referencePdfs'
import { useUiStore } from '../state/ui'
import type { EditorThemeName } from './settings'
import type { OpenReferencePdfHit } from './contextMenuItems'
import './vim.css'

// The vim engine's own `write` has nothing to call under CM6 — it is
// `CM.commands.save ?? cm.save()` and the shim defines neither — so `:w` is a
// silent no-op until the host registers its own, and `quit` is not in the
// default ex map at all. Registered once at module scope because defineEx is
// process-wide; the handlers look the calling view up in exRegistry rather
// than closing over one editor.
//
// `wq` IS registerable next to `w`. The real constraint (vim.js:5827-5841) is
// that matchCommand_ scans the LONGEST prefix of the typed name first and then
// requires the typed name to be a prefix of the command's full name: `:wq`
// hits commandMap_['wq'] at i=2, `:w` hits commandMap_['w'] at i=1, and
// neither can shadow the other. Without it the single commonest vim keystroke
// answers "Not an editor command", which funnels the user into `:q` — the one
// that discards their work.
//
// `:q!` needs no registration of its own: parseInput_ matches the command name
// as `\w+`, so `q!` arrives as commandName 'q' with argString '!'.
//
// `:wq` / `:x` write and then close, and refuse to close if the write did not
// land — see saveAndClose in vimEx.ts.
const FORCED = (params: { argString?: string | undefined } | undefined): boolean =>
  params?.argString?.trim() === '!'

Vim.defineEx('write', 'w', (cm) => exRegistry.save(cm))
Vim.defineEx('quit', 'q', (cm, params) => exRegistry.close(cm, FORCED(params)))
Vim.defineEx('wq', 'wq', (cm) => exRegistry.saveAndClose(cm))
Vim.defineEx('xit', 'x', (cm) => exRegistry.saveAndClose(cm))

// `:help` / `:h` — the vim-native way to the shortcut overlay (feature-plan-9
// §1), because in NORMAL mode a bare `?` is vim's search-backward and never
// reaches the window listener that opens it. `:h` is vim's own abbreviation
// and collides with nothing: defaultExCommandMap has no command whose name or
// short name starts with `h`. No caller is passed on — the overlay is one
// app-wide dialog, not a per-view surface.
Vim.defineEx('help', 'h', () => exRegistry.help())

// j/k step one document line even where a block widget (an image, a figure, a
// display equation) stands in for the source — otherwise the covered line is
// unreachable and its source can never be revealed for editing. See vimMotions.ts.
//
// Replacing the motion rather than remapping keys fixes every binding that
// routes to it (j, k, +, -, _) at once, and shadows no user remap of those keys.
// The cast is the `this` parameter: the engine invokes a motion as
// `motions[name](…)`, so it is bound to the motions object, which MotionFn —
// declared without a `this` — cannot express.
Vim.defineMotion('moveByLines', moveByDocumentLines as unknown as Parameters<typeof Vim.defineMotion>[1])

// Where a refusal ("no write since last change") is shown, and where `:help`
// lands. Wired here because defineEx is process-wide, so the registry is too —
// and so the ex commands above cannot exist without their destinations.
exRegistry.setNotify((message) => useUiStore.getState().setStatusNote(message))
exRegistry.setShowHelp(() => useUiStore.getState().setHelpOpen(true))

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
  onSave: () => void | Promise<void>
  /**
   * What vim's `:q` closes. `force` is `:q!`; return false to REFUSE (an
   * unsaved buffer), which surfaces vim's own "no write since last change"
   * instead of discarding the work. Omitted by hosts that own their own
   * surface (the combined manuscript view is the tab, not a file in it), which
   * makes `:q` report that rather than doing nothing at all.
   */
  onClose?: (force: boolean) => boolean
  /**
   * Current vim mode ('normal', 'insert', 'visual line', …) for a mode
   * indicator, and null once vim is off or the editor is gone. Only ever
   * called while the vim keymap is installed.
   *
   * `owner` identifies the reporting editor, so a store behind this can ignore
   * a `null` from an editor that is not the one it is currently showing —
   * without it, tearing down any one editor blanks the indicator for every
   * other mounted editor that still has vim installed.
   */
  onVimMode?: (owner: object, mode: string | null) => void
  /**
   * Formatting UX (feature-plan-3.md §1): ⌘B/⌘I/⌘⇧C/⌘⇧X/⌘K always work on
   * prose files (contentKindFor === 'prose'); ⌘⇧M, ⌘⇧K and ⌘⇧F plus the
   * right-click context menu's "Comment", "Insert citation…" and "Insert
   * figure…" items only do anything when the host supplies the matching
   * callback below — the item is simply left out of the menu, and the
   * shortcut is unhandled (falls through to the next binding), when it's
   * absent. Ignored for non-prose files.
   */
  onComment?: (view: EditorView) => void
  onInsertCitation?: (view: EditorView) => void
  onInsertFigure?: (view: EditorView) => void
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
    onInsertCitation: options.onInsertCitation,
    onInsertFigure: options.onInsertFigure
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
          void options.onSave()
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

  exRegistry.register(view, { save: options.onSave, close: options.onClose })

  // The vim plugin builds a fresh CM5 adapter on every compartment swap, so
  // the mode listener is re-attached each time vim is installed. The initial
  // 'normal' has to be seeded by hand: enterVimMode signals it from inside the
  // plugin constructor, which has already run by the time we get here.
  //
  // Every report carries `vimOwner`, an identity token for this editor. A
  // dedicated object rather than the view itself, so a mode store cannot end
  // up retaining a destroyed EditorView.
  const vimOwner = {}
  let detachVimMode: (() => void) | null = null
  const attachVimMode = (): void => {
    const report = options.onVimMode
    const cm = getCM(view)
    if (report === undefined || cm === null) return
    const onModeChange = (event: { mode: string; subMode?: string }): void => {
      const sub = event.subMode === undefined ? '' : event.subMode
      report(
        vimOwner,
        sub === '' ? event.mode : `${event.mode} ${sub === 'linewise' ? 'line' : 'block'}`
      )
    }
    // Focus, not just mode changes: with two vim editors mounted the chip is
    // last-writer-wins, so without this it keeps asserting the OTHER editor's
    // mode until the focused one happens to change mode — a positively wrong
    // reading, which is worse than none.
    const onFocus = (): void => report(vimOwner, cm.state.vim?.mode ?? 'normal')
    cm.on('vim-mode-change', onModeChange)
    view.contentDOM.addEventListener('focus', onFocus)
    detachVimMode = () => {
      cm.off('vim-mode-change', onModeChange)
      view.contentDOM.removeEventListener('focus', onFocus)
    }
    report(vimOwner, cm.state.vim?.mode ?? 'normal')
  }
  if (options.vim === true) attachVimMode()

  return {
    view,
    setLive: (on) => {
      view.dispatch({ effects: liveCompartment.reconfigure(on ? livePreview(livePreviewConfig) : []) })
    },
    setTheme: (name) => {
      view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(name)) })
    },
    setVim: (on) => {
      detachVimMode?.()
      detachVimMode = null
      view.dispatch({ effects: vimCompartment.reconfigure(on ? vim() : []) })
      if (on) attachVimMode()
      else options.onVimMode?.(vimOwner, null)
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
    destroy: () => {
      detachVimMode?.()
      detachVimMode = null
      options.onVimMode?.(vimOwner, null)
      exRegistry.unregister(view)
      view.destroy()
    }
  }
}
