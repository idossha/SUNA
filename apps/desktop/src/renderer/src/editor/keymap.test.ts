/**
 * The ⌘K arbitration between *Insert link* (feature-plan-3 §1) and the
 * command palette (feature-plan-4 §5).
 *
 * The load-bearing decision is the command's RETURN VALUE: CodeMirror's
 * `runHandlers` only calls `event.preventDefault()` when a binding's command
 * returns true, and CommandPalette.tsx's window listener opens only for
 * events that are not `defaultPrevented`. So "returns false on an empty
 * selection" is exactly "⌘K reaches the palette from inside a prose editor".
 * (The repo has no DOM test environment in apps/desktop — jsdom is a
 * packages/canvas dependency — so this drives the Command through a minimal
 * stub view rather than a real EditorView; the end-to-end half is measured
 * in the app by scripts/e2e/smoke.mjs's `palette-opens-over-editor` step.)
 */
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { insertLinkOnSelection } from './keymap'

/** Minimal stand-in for the two EditorView members insertLink() touches. */
function stubView(doc: string, from: number, to = from) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(from, to) })
  const view = {
    get state() {
      return state
    },
    dispatch(spec: TransactionSpec | Transaction) {
      state = state.update(spec as TransactionSpec).state
    }
  }
  return {
    view: view as unknown as EditorView,
    doc: () => state.doc.toString()
  }
}

describe('insertLinkOnSelection (⌘K)', () => {
  it('wraps a selection as a markdown link and CLAIMS the key', () => {
    const { view, doc } = stubView('say hello world', 4, 9)
    expect(insertLinkOnSelection()(view)).toBe(true)
    expect(doc()).toBe('say [hello](url) world')
  })

  it('selects the `url` placeholder so it can be typed over', () => {
    const { view } = stubView('say hello world', 4, 9)
    insertLinkOnSelection()(view)
    const { from, to } = view.state.selection.main
    expect(view.state.doc.sliceString(from, to)).toBe('url')
  })

  it('does NOT claim the key with an empty selection, and leaves the doc untouched', () => {
    // -> CodeMirror does not preventDefault -> the palette's window listener opens.
    const { view, doc } = stubView('say hello world', 6)
    expect(insertLinkOnSelection()(view)).toBe(false)
    expect(doc()).toBe('say hello world')
  })

  it('treats a zero-width selection at position 0 the same way', () => {
    const { view, doc } = stubView('hello', 0)
    expect(insertLinkOnSelection()(view)).toBe(false)
    expect(doc()).toBe('hello')
  })
})
