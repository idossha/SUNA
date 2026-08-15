/**
 * Prose formatting shortcuts (feature-plan-3.md §1): ⌘B bold, ⌘I italic,
 * ⌘⇧C code, ⌘⇧X strikethrough, ⌘K link, ⌘⇧M comment, ⌘⇧K insert citation.
 * `createEditor` (codemirror.ts) only installs this extension for prose
 * files (`contentKindFor === 'prose'`) and wraps it in `Prec.high` so it
 * wins over CM's own default keymap.
 */
import { Prec, type Extension } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'
import { insertLink, toggleWrap } from './markdownCommands'

export interface FormattingCallbacks {
  /** Comment on the current selection — same anchored-comment flow as the
   *  host's existing comment UI. Absent -> ⌘⇧M and the menu item no-op. */
  onComment?: (view: EditorView) => void
  /** Open the insert-citation picker. Absent -> ⌘⇧K and the menu item no-op. */
  onInsertCitation?: (view: EditorView) => void
}

/** Wraps an optional host callback as a Command: unhandled (returns false,
 *  so CM tries the next binding) when the callback wasn't supplied. */
function callbackCommand(fn: ((view: EditorView) => void) | undefined): Command {
  return (view) => {
    if (fn === undefined) return false
    fn(view)
    return true
  }
}

export function formattingKeymap(callbacks: FormattingCallbacks): Extension {
  return Prec.high(
    keymap.of([
      { key: 'Mod-b', run: toggleWrap('**') },
      { key: 'Mod-i', run: toggleWrap('*') },
      { key: 'Mod-Shift-c', run: toggleWrap('`') },
      { key: 'Mod-Shift-x', run: toggleWrap('~~') },
      { key: 'Mod-k', run: insertLink() },
      { key: 'Mod-Shift-m', run: callbackCommand(callbacks.onComment) },
      { key: 'Mod-Shift-k', run: callbackCommand(callbacks.onInsertCitation) }
    ])
  )
}
