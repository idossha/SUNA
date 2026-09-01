/**
 * Prose formatting shortcuts (ARCHITECTURE §17.3): ⌘B bold, ⌘I italic,
 * ⌘⇧C code, ⌘⇧X strikethrough, ⌘K link (selection only — see
 * `insertLinkOnSelection`), ⌘⇧M comment, ⌘⇧K insert citation, ⌘⇧F insert
 * figure.
 * `createEditor` (codemirror.ts) only installs this extension for prose
 * files (`contentKindFor === 'prose'`) and wraps it in `Prec.high` so it
 * wins over CM's own default keymap.
 */
import { Prec, type Extension } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'
import { insertLink, toggleWrap } from './markdownCommands'

/**
 * ⌘K is claimed by two shipped specs: the editor contract (ARCHITECTURE §17.3) gave it to *Insert
 * link* ("select a word and press ⌘K"), DECISIONS 2026-08-14 gave it to the
 * command palette ("⌘K opens focused"). Both are real, and a keymap that
 * silently swallows ⌘K inside every prose editor makes the palette
 * unreachable from the app's primary surface — you cannot search files while
 * writing, which is exactly when you want to.
 *
 * The split follows what each spec actually documents: with a **selection**
 * ⌘K wraps it as a link, which is the only form the editor contract describes (ARCHITECTURE §17.3);
 * with an **empty** selection it returns false, so CodeMirror does not
 * preventDefault and the palette's window-level listener opens
 * (CommandPalette.tsx deliberately skips `defaultPrevented` events). The
 * no-selection *Link…* action is still one right-click away in the context
 * menu, where it is enabled regardless of selection.
 */
export function insertLinkOnSelection(): Command {
  const run = insertLink()
  return (view) => (view.state.selection.main.empty ? false : run(view))
}

export interface FormattingCallbacks {
  /** Comment on the current selection — same anchored-comment flow as the
   *  host's existing comment UI. Absent -> ⌘⇧M and the menu item no-op. */
  onComment?: (view: EditorView) => void
  /** Open the insert-citation picker. Absent -> ⌘⇧K and the menu item no-op. */
  onInsertCitation?: (view: EditorView) => void
  /** Open the insert-figure picker. Absent -> ⌘⇧F and the menu item no-op. */
  onInsertFigure?: (view: EditorView) => void
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
      { key: 'Mod-k', run: insertLinkOnSelection() },
      { key: 'Mod-Shift-m', run: callbackCommand(callbacks.onComment) },
      { key: 'Mod-Shift-k', run: callbackCommand(callbacks.onInsertCitation) },
      { key: 'Mod-Shift-f', run: callbackCommand(callbacks.onInsertFigure) }
    ])
  )
}
