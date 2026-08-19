import { applyDiffSpans } from '@suna/core'
import { EditorView } from '@codemirror/view'
import { keymap } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { useRevisionsStore, peekRevision } from '../state/revisions'
import { revisionBaseField, revisionHunks, setRevisionBase, type DiffHunk } from './revisionDiff'

/**
 * Acting on the AI's changes (feature-plan-11 §11f) — the half of the review
 * view that is not paint.
 *
 * Accept and reject are deliberately asymmetric, because the document already
 * holds the AI's text:
 *
 *  - REJECT edits the document back to the baseline for that hunk. Afterwards
 *    base and document agree there, so the hunk stops existing on its own —
 *    no bookkeeping, and the change flows to disk through the ordinary save
 *    path, undoable like any other edit.
 *  - ACCEPT leaves the document alone and advances the BASELINE past the hunk,
 *    which likewise makes it stop existing. The prose is untouched, so
 *    accepting can never alter what is on disk.
 *
 * When nothing is left to review the revision is closed, which is what removes
 * it from manuscript/revisions.json.
 */

/** The hunk the cursor sits in or touches, else the next one after it. */
export function hunkAtCursor(view: EditorView): DiffHunk | null {
  const pos = view.state.selection.main.head
  const hunks = revisionHunks(view)
  return hunks.find((h) => pos >= h.from && pos <= h.to) ?? hunks.find((h) => h.from > pos) ?? null
}

function refresh(view: EditorView, path: string): void {
  const revision = peekRevision(path)
  view.dispatch({ effects: setRevisionBase.of(revision?.base ?? null) })
}

/** Close the revision once the author has dealt with everything in it. */
async function closeIfDone(view: EditorView, path: string): Promise<void> {
  if (revisionHunks(view).length > 0) return
  await useRevisionsStore.getState().close(path)
  view.dispatch({ effects: setRevisionBase.of(null) })
}

/** Keep the AI's version of one hunk: advance the baseline past it. */
export async function acceptHunk(view: EditorView, path: string, hunk: DiffHunk): Promise<void> {
  const base = view.state.field(revisionBaseField, false) ?? null
  if (base === null) return
  const next = applyDiffSpans(base, [
    { from: hunk.baseFrom, to: hunk.baseTo, insert: view.state.doc.sliceString(hunk.from, hunk.to) }
  ])
  await useRevisionsStore.getState().setBase(path, next)
  view.dispatch({ effects: setRevisionBase.of(next) })
  await closeIfDone(view, path)
}

/** Put one hunk back the way it was: an ordinary, undoable document edit. */
export async function rejectHunk(view: EditorView, path: string, hunk: DiffHunk): Promise<void> {
  view.dispatch({
    changes: { from: hunk.from, to: hunk.to, insert: hunk.removed },
    selection: { anchor: hunk.from + hunk.removed.length }
  })
  await closeIfDone(view, path)
}

/** Keep everything: the document already says it, so only the baseline goes. */
export async function acceptAll(view: EditorView, path: string): Promise<void> {
  await useRevisionsStore.getState().close(path)
  view.dispatch({ effects: setRevisionBase.of(null) })
}

/** Undo the whole run: restore the baseline into the document. */
export async function rejectAll(view: EditorView, path: string): Promise<void> {
  const base = view.state.field(revisionBaseField, false) ?? null
  if (base === null) return
  if (base !== view.state.doc.toString()) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: base } })
  }
  await useRevisionsStore.getState().close(path)
  view.dispatch({ effects: setRevisionBase.of(null) })
}

/** Move the cursor to the next (dir 1) or previous (dir -1) hunk. */
export function gotoHunk(view: EditorView, dir: 1 | -1): boolean {
  const hunks = revisionHunks(view)
  if (hunks.length === 0) return false
  const pos = view.state.selection.main.head
  const target =
    dir === 1
      ? (hunks.find((h) => h.from > pos) ?? hunks[0])
      : ([...hunks].reverse().find((h) => h.to < pos) ?? hunks[hunks.length - 1])
  if (target === undefined) return false
  view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true })
  return true
}

/**
 * Alt-based, so nothing collides with vim motions or the formatting keymap.
 * `path` is the manuscript-relative file this editor shows; it is fixed for
 * the life of the tab, so binding it at append time is safe.
 */
export function revisionReviewKeymap(path: string): Extension {
  const withHunk = (fn: (view: EditorView, hunk: DiffHunk) => Promise<void>) => (view: EditorView) => {
    const hunk = hunkAtCursor(view)
    if (hunk === null) return false
    void fn(view, hunk)
    return true
  }
  return keymap.of([
    { key: 'Alt-]', run: (view) => gotoHunk(view, 1) },
    { key: 'Alt-[', run: (view) => gotoHunk(view, -1) },
    { key: 'Alt-y', run: withHunk((view, hunk) => acceptHunk(view, path, hunk)) },
    { key: 'Alt-n', run: withHunk((view, hunk) => rejectHunk(view, path, hunk)) }
  ])
}

/** Re-apply the current baseline to a live editor (setting toggled, run finished). */
export function syncRevisionBase(view: EditorView, path: string, enabled: boolean): void {
  if (!enabled) {
    view.dispatch({ effects: setRevisionBase.of(null) })
    return
  }
  refresh(view, path)
}
