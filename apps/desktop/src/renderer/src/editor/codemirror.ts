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
import { livePreview } from './livePreview'
import { sunaJsonLinter } from './jsonLint'
import { editorTheme } from './themes'
import type { EditorThemeName } from './settings'

/** Extension-based language pick. `.bib` (and anything unknown) stays plain
 *  and falls back to the shared highlight style. */
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
  theme: EditorThemeName
  live: boolean
  onDocChanged: () => void
  onSave: () => void
}

export interface EditorHandle {
  view: EditorView
  /** Toggle Obsidian-style live preview decorations (markdown only). */
  setLive: (on: boolean) => void
  /** Swap the editor-surface theme without losing document state. */
  setTheme: (name: EditorThemeName) => void
  destroy: () => void
}

export function createEditor(options: CreateEditorOptions): EditorHandle {
  const themeCompartment = new Compartment()
  const liveCompartment = new Compartment()

  const extensions: Extension[] = [
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
    liveCompartment.of(options.live ? livePreview() : []),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onDocChanged()
    }),
    ...languageExtensions(options.fileName)
  ]

  const view = new EditorView({
    state: EditorState.create({ doc: options.doc, extensions }),
    parent: options.parent
  })

  return {
    view,
    setLive: (on) => {
      view.dispatch({ effects: liveCompartment.reconfigure(on ? livePreview() : []) })
    },
    setTheme: (name) => {
      view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(name)) })
    },
    destroy: () => view.destroy()
  }
}
