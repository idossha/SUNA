import { applyDiffSpans } from '@suna/core'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { useRevisionsStore, peekRevision } from '../state/revisions'
import { revisionBaseField, revisionHunks, setRevisionBase, type DiffHunk } from './revisionDiff'

/**
 * Acting on the AI's changes (ARCHITECTURE §5.6) — the half of the review
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

/** The hunk covering `pos`, or the nearest one — a removal widget reports a
 *  position just outside the zero-width hunk it belongs to. */
function hunkNear(view: EditorView, pos: number): DiffHunk | null {
  const hunks = revisionHunks(view)
  const inside = hunks.find((h) => pos >= h.from && pos <= h.to)
  if (inside !== undefined) return inside
  let best: DiffHunk | null = null
  let bestDistance = Infinity
  for (const hunk of hunks) {
    const distance = pos < hunk.from ? hunk.from - pos : pos - hunk.to
    if (distance < bestDistance) {
      bestDistance = distance
      best = hunk
    }
  }
  // Only claim a hunk the click was plausibly on, never one across the page.
  return bestDistance <= 2 ? best : null
}

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

/* ---- the per-hunk popover ------------------------------------------------- */

/** Show the accept/reject popover at a position, or dismiss it with null. */
const setActiveHunk = StateEffect.define<number | null>()

function actionsTooltip(path: string, pos: number): Tooltip {
  return {
    pos,
    above: false,
    strictSide: false,
    arrow: false,
    create: (view) => {
      const dom = document.createElement('div')
      dom.className = 'cm-sunaDiff-actions'
      const hunk = hunkNear(view, pos)
      if (hunk === null) return { dom }

      const button = (
        label: string,
        title: string,
        cls: string,
        run: () => Promise<void>
      ): HTMLButtonElement => {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = `cm-sunaDiff-action ${cls}`
        el.textContent = label
        el.title = title
        el.addEventListener('mousedown', (event) => {
          // Keep the click off the document: a selection change here would
          // dismiss this popover before the handler below ever ran.
          event.preventDefault()
          event.stopPropagation()
        })
        el.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          void run().then(() => {
            view.dispatch({ effects: setActiveHunk.of(null) })
            view.focus()
          })
        })
        return el
      }

      dom.appendChild(
        button('Accept', 'Keep the AI wording (Alt-y)', 'cm-sunaDiff-action--accept', () =>
          acceptHunk(view, path, hunk)
        )
      )
      dom.appendChild(
        button('Reject', 'Put the original wording back (Alt-n)', 'cm-sunaDiff-action--reject', () =>
          rejectHunk(view, path, hunk)
        )
      )
      return { dom }
    }
  }
}

function hunkTooltipField(path: string): Extension {
  const field = StateField.define<Tooltip | null>({
    create: () => null,
    update: (value, tr) => {
      for (const effect of tr.effects) {
        if (effect.is(setActiveHunk)) {
          return effect.value === null ? null : actionsTooltip(path, effect.value)
        }
      }
      // Any edit — including the accept/reject itself — invalidates it.
      if (tr.docChanged) return null
      return value
    },
    provide: (f) => showTooltip.from(f)
  })

  return [
    field,
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        const target = event.target as Element | null
        // Clicks inside the popover are its own business.
        if (target?.closest?.('.cm-sunaDiff-actions') != null) return false
        const mark = target?.closest?.('.cm-sunaDiff-ins, .cm-sunaDiff-del')
        if (mark == null) {
          if (view.state.field(field, false) != null) {
            view.dispatch({ effects: setActiveHunk.of(null) })
          }
          return false
        }
        // A removal is a widget, so ask CodeMirror where its DOM sits rather
        // than trusting the mouse coordinates.
        const pos = view.posAtDOM(mark)
        view.dispatch({ effects: setActiveHunk.of(pos) })
        return false
      }
    })
  ]
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
  return [
    hunkTooltipField(path),
    keymap.of([
      { key: 'Alt-]', run: (view) => gotoHunk(view, 1) },
      { key: 'Alt-[', run: (view) => gotoHunk(view, -1) },
      { key: 'Alt-y', run: withHunk((view, hunk) => acceptHunk(view, path, hunk)) },
      { key: 'Alt-n', run: withHunk((view, hunk) => rejectHunk(view, path, hunk)) },
      {
        key: 'Escape',
        run: (view) => {
          view.dispatch({ effects: setActiveHunk.of(null) })
          return false
        }
      }
    ])
  ]
}

/** Re-apply the current baseline to a live editor (setting toggled, run finished). */
export function syncRevisionBase(view: EditorView, path: string, enabled: boolean): void {
  if (!enabled) {
    view.dispatch({ effects: setRevisionBase.of(null) })
    return
  }
  refresh(view, path)
}
