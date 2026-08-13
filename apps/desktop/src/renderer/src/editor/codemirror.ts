import { EditorState, type Extension } from '@codemirror/state'
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
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const sunaEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13px',
      backgroundColor: 'var(--s-bg-editor)',
      color: 'var(--s-ink)'
    },
    '.cm-content': {
      fontFamily: 'var(--s-font-mono)',
      caretColor: 'var(--s-accent)',
      padding: '12px 0',
      lineHeight: '1.65'
    },
    '.cm-line': { padding: '0 16px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--s-accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(232, 180, 92, 0.18)'
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
    '.cm-gutters': {
      backgroundColor: 'var(--s-bg-editor)',
      color: 'var(--s-ink-faint)',
      border: 'none',
      paddingLeft: '6px'
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--s-ink-muted)' }
  },
  { dark: true }
)

const sunaHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--s-accent)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#c9c6f0' },
  { tag: tags.strong, fontWeight: '700', color: '#f0ede8' },
  { tag: tags.link, color: '#8ab4d8' },
  { tag: tags.url, color: '#8ab4d8' },
  { tag: tags.monospace, color: '#a8d8b8' },
  { tag: tags.quote, color: 'var(--s-ink-muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--s-ink-faint)' },
  { tag: tags.processingInstruction, color: 'var(--s-ink-faint)' },
  { tag: tags.labelName, color: '#d8a8c8' }
])

export interface CreateEditorOptions {
  parent: HTMLElement
  doc: string
  isMarkdown: boolean
  onDocChanged: () => void
  onSave: () => void
}

export function createEditor(options: CreateEditorOptions): EditorView {
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
    sunaEditorTheme,
    syntaxHighlighting(sunaHighlight, { fallback: true }),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onDocChanged()
    })
  ]
  if (options.isMarkdown) extensions.push(markdown())

  return new EditorView({
    state: EditorState.create({ doc: options.doc, extensions }),
    parent: options.parent
  })
}
