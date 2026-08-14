import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { EditorThemeName } from './settings'

/**
 * All three editor themes share one CM theme spec driven by `--ed-*` CSS
 * variables; the palette itself lives in editor.css, scoped by a
 * `.editor-tab--theme-*` class on the tab container. The only per-theme
 * difference at the CM level is the `dark` base flag.
 */
function chrome(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: 'var(--ed-font-size, 13px)',
        backgroundColor: 'var(--ed-bg, var(--s-bg-editor))',
        color: 'var(--ed-ink, var(--s-ink))'
      },
      '.cm-content': {
        fontFamily: 'var(--ed-content-font, var(--s-font-mono))',
        caretColor: 'var(--ed-accent, var(--s-accent))',
        padding: '12px 0',
        lineHeight: 'var(--ed-line-height, 1.65)'
      },
      '.cm-line': { padding: '0 16px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor': { borderLeftColor: 'var(--ed-accent, var(--s-accent))' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'var(--ed-selection, rgba(232, 180, 92, 0.18))'
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--ed-active-line, rgba(255, 255, 255, 0.03))'
      },
      '.cm-gutters': {
        backgroundColor: 'var(--ed-bg, var(--s-bg-editor))',
        color: 'var(--ed-ink-faint, var(--s-ink-faint))',
        border: 'none',
        paddingLeft: '6px'
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--ed-ink-muted, var(--s-ink-muted))'
      },
      '.cm-lintRange-error': {
        textDecorationColor: 'var(--s-err)'
      }
    },
    { dark }
  )
}

const darkChrome = chrome(true)
const lightChrome = chrome(false)

const sunaSyntax = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--ed-syn-heading)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--ed-syn-em)' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--ed-syn-strong)' },
  { tag: tags.link, color: 'var(--ed-syn-link)' },
  { tag: tags.url, color: 'var(--ed-syn-link)' },
  { tag: tags.monospace, color: 'var(--ed-syn-code)' },
  { tag: tags.quote, color: 'var(--ed-ink-muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--ed-ink-faint)' },
  { tag: tags.processingInstruction, color: 'var(--ed-ink-faint)' },
  { tag: tags.labelName, color: 'var(--ed-syn-label)' },
  { tag: tags.string, color: 'var(--ed-syn-code)' },
  { tag: tags.number, color: 'var(--ed-syn-number)' },
  { tag: tags.bool, color: 'var(--ed-syn-number)' },
  { tag: tags.null, color: 'var(--ed-syn-number)' },
  { tag: tags.keyword, color: 'var(--ed-syn-keyword)' },
  { tag: tags.comment, color: 'var(--ed-ink-faint)', fontStyle: 'italic' },
  { tag: tags.propertyName, color: 'var(--ed-syn-link)' }
])

const syntax = syntaxHighlighting(sunaSyntax, { fallback: true })

export function editorTheme(name: EditorThemeName): Extension {
  return [name === 'suna-light' ? lightChrome : darkChrome, syntax]
}

export const EDITOR_THEME_CLASS: Record<EditorThemeName, string> = {
  'suna-dark': 'editor-tab--theme-suna-dark',
  'suna-light': 'editor-tab--theme-suna-light',
  'high-contrast': 'editor-tab--theme-high-contrast'
}
