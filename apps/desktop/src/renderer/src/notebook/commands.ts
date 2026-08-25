import type { KeyBinding } from '@codemirror/view'

/**
 * The keys that act on a cell, defined once and installed in two places.
 *
 * A notebook shortcut has to work both while the author is TYPING in a cell
 * (where CodeMirror sees the key first — and, for ⇧↵, has its own meaning
 * for it) and while they are not (where the scroller sees it). Rather than
 * two lists that drift, the cell-execution keys live here: NotebookTab
 * handles them on the way up when no editor has focus, and CellView installs
 * exactly the same set INTO its editor at the highest precedence.
 */

export interface CellCommands {
  /** Run the selected cell; then stay on it, step to the next, or insert. */
  run: (after: 'stay' | 'next' | 'insert') => void
  /** Move the selected cell by `delta` places. */
  move: (delta: number) => void
  /** Leave the editor: the cell stays selected, the keyboard acts on it. */
  toCommandMode: () => void
  save: () => void
}

/**
 * The same bindings as CodeMirror keys. `Mod-` is ⌘ on macOS and Ctrl
 * elsewhere, which is also why ⌃↵ and ⌘↵ are one binding rather than two
 * spellings of the same command.
 */
export function cellKeymap(commands: () => CellCommands): readonly KeyBinding[] {
  return [
    { key: 'Shift-Enter', run: () => (commands().run('next'), true) },
    { key: 'Mod-Enter', run: () => (commands().run('stay'), true) },
    { key: 'Alt-Enter', run: () => (commands().run('insert'), true) },
    { key: 'Mod-Shift-ArrowUp', run: () => (commands().move(-1), true) },
    { key: 'Mod-Shift-ArrowDown', run: () => (commands().move(1), true) },
    { key: 'Escape', run: () => (commands().toCommandMode(), true) }
  ]
}
