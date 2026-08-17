import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { Comment } from '@suna/core'
import { locate } from './anchor'

/**
 * In-editor comment highlights, the mapped-StateField model: anchors are
 * re-located with `locate()` ONLY when the comment list itself changes
 * (load, add/resolve/delete, external reload) and are MAPPED through every
 * edit in between (`mapPos`), so they stay glued to their text with zero
 * in-session drift and zero per-keystroke re-location cost. External disk
 * reloads arrive as a minimal mapped change (state/docSessions), so the
 * same mapping carries anchors through agent edits.
 *
 * The vertical-positioning helpers that used to live here (anchorTopsFor /
 * per-scroll coordsAtPos) are gone with the old absolutely-positioned
 * gutter — the aligned rail (comments/CommentsRail) reads positions from
 * CodeMirror's height map itself and re-derives them on this module's
 * geometry channel below, never per scroll frame.
 */

export interface LiveAnchor {
  id: string
  from: number
  to: number
}

/** Effect: replace the set of comments this editor's decorations track. */
export const setSectionComments = StateEffect.define<readonly Comment[]>()

/** Effect: mark one comment's highlight as the active one (or none). */
export const setActiveComment = StateEffect.define<string | null>()

function locateAll(text: string, comments: readonly Comment[]): readonly LiveAnchor[] {
  const out: LiveAnchor[] = []
  for (const comment of comments) {
    if (comment.target.kind !== 'section') continue
    const range = locate(text, comment.target.anchor)
    if (range === null || range.from >= range.to) continue
    out.push({ id: comment.id, from: range.from, to: range.to })
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

const anchorsField = StateField.define<readonly LiveAnchor[]>({
  create: () => [],
  update: (anchors, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setSectionComments)) {
        return locateAll(tr.state.doc.toString(), effect.value)
      }
    }
    if (!tr.docChanged) return anchors
    const mapped: LiveAnchor[] = []
    for (const anchor of anchors) {
      // assoc 1 / -1 reproduces exactly how a non-inclusive mark decoration
      // maps: an insertion at either boundary stays OUTSIDE the range, so
      // the live anchor and the visible highlight never disagree.
      const from = tr.changes.mapPos(anchor.from, 1)
      const to = tr.changes.mapPos(anchor.to, -1)
      // a collapsed range (quote fully deleted) drops out of the live set —
      // the comment itself is untouched; the rail shows it as detached
      if (from < to) mapped.push({ id: anchor.id, from, to })
    }
    return mapped
  }
})

const activeField = StateField.define<string | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setActiveComment)) value = effect.value
    }
    return value
  }
})

/** One mark per comment; the id rides in `data-comment-id`, which is both
 *  the click target's identity and what e2e drivers correlate cards by. */
function anchorMark(commentId: string, active: boolean): Decoration {
  return Decoration.mark({
    class: active ? 'cmt-anchor cmt-anchor--active' : 'cmt-anchor',
    attributes: { 'data-comment-id': commentId }
  })
}

const decorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    const listChanged = tr.effects.some(
      (e) => e.is(setSectionComments) || e.is(setActiveComment)
    )
    if (!listChanged && !tr.docChanged) return deco
    if (!listChanged && tr.docChanged) return deco.map(tr.changes)
    const active = tr.state.field(activeField)
    const anchors = tr.state.field(anchorsField)
    return Decoration.set(
      anchors.map((a) => anchorMark(a.id, a.id === active).range(a.from, a.to)),
      true
    )
  },
  provide: (field) => EditorView.decorations.from(field)
})

/** Effect: briefly highlight one range (rail "scroll to and flash"). */
export const setFlashRange = StateEffect.define<{ from: number; to: number } | null>()

const flashField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setFlashRange)) value = effect.value
    }
    if (value !== null && tr.docChanged) value = null
    return value
  }
})

const flashMark = Decoration.mark({ class: 'cmt-anchor--flash' })

const flashDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (_deco, tr) => {
    const flash = tr.state.field(flashField)
    return flash === null ? Decoration.none : Decoration.set([flashMark.range(flash.from, flash.to)])
  },
  provide: (field) => EditorView.decorations.from(field)
})

/* ---- live-anchor registry + change epoch ----------------------------------
   The save-time re-anchoring in state/comments needs the EDITOR's mapped
   ranges (locate() against saved text would wrongly detach a comment whose
   quote was edited but whose mark tracked it), and the rail needs to know
   when anchors moved so its document-order sort stays fresh. Both are module
   registries fed by the extension below. */

type LiveAnchorSource = () => readonly LiveAnchor[]
const anchorSources = new Map<string, Set<LiveAnchorSource>>()

/** Register a view's live anchors under its manuscript-relative path. */
export function registerLiveAnchorSource(path: string, source: LiveAnchorSource): () => void {
  let set = anchorSources.get(path)
  if (set === undefined) {
    set = new Set()
    anchorSources.set(path, set)
  }
  set.add(source)
  return () => {
    set.delete(source)
    if (set.size === 0) anchorSources.delete(path)
  }
}

/** A registered view's live anchors for `path`, or null when none is attached. */
export function liveAnchorsForPath(path: string): readonly LiveAnchor[] | null {
  const set = anchorSources.get(path)
  if (set === undefined) return null
  for (const source of set) return source()
  return null
}

let anchorsEpoch = 0
const epochListeners = new Set<() => void>()

/** Bumped on every doc change in a view carrying the extension. */
export function getAnchorsEpoch(): number {
  return anchorsEpoch
}

export function subscribeAnchorsEpoch(listener: () => void): () => void {
  epochListeners.add(listener)
  return () => epochListeners.delete(listener)
}

function bumpAnchorsEpoch(): void {
  anchorsEpoch += 1
  for (const listener of epochListeners) listener()
}

/* ---- geometry channel ------------------------------------------------------
   CodeMirror's height map is an ESTIMATE for lines it has not rendered yet;
   as the user scrolls (or images load, or the pane resizes), measured heights
   replace estimates and every block's document-space `top` can shift. The
   aligned rail must re-derive card positions then — but this is a layout
   concern only, so it gets its own listener channel instead of riding
   anchorsEpoch: no React re-render of the card list on a pure re-measure. */

const geometryListeners = new Set<() => void>()

/** Fires when a view carrying the extension re-measures (geometryChanged). */
export function subscribeAnchorGeometry(listener: () => void): () => void {
  geometryListeners.add(listener)
  return () => geometryListeners.delete(listener)
}

function notifyGeometry(): void {
  for (const listener of geometryListeners) listener()
}

/**
 * The highlight extension. Clicking an anchored highlight fires
 * `onActivate(commentId)` — the reverse of clicking its rail card. No keymap
 * here: ⌘⇧M is owned solely by editor/keymap.ts's formatting keymap (the
 * duplicate registration is gone).
 */
export function commentHighlightExtension(onActivate: (commentId: string) => void): Extension {
  return [
    anchorsField,
    activeField,
    decorationsField,
    flashField,
    flashDecorationField,
    EditorView.updateListener.of((update) => {
      // anchors move on doc changes AND get rebuilt by setSectionComments
      // (a pure-effect transaction) — the rail's document-order sort must
      // re-run for both, or a card computed before the first anchor
      // application stays stuck in the unanchored bucket
      const listSet = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setSectionComments))
      )
      if (update.docChanged || listSet) bumpAnchorsEpoch()
      // estimates -> measurements: block tops moved without any doc change
      else if (update.geometryChanged) notifyGeometry()
    }),
    EditorView.domEventHandlers({
      mousedown(event) {
        if (event.button !== 0) return false
        const target = event.target as Element | null
        const el = target?.closest?.('[data-comment-id]')
        const id = el?.getAttribute('data-comment-id')
        if (id === null || id === undefined || id === '') return false
        onActivate(id)
        return false
      }
    })
  ]
}

/** Push a fresh comments list into a view that has the extension appended. */
export function applySectionComments(view: EditorView, comments: readonly Comment[]): void {
  view.dispatch({ effects: setSectionComments.of(comments) })
}

/** Reflect the rail's active thread in the editor's highlight styling. */
export function setActiveInView(view: EditorView, commentId: string | null): void {
  if (view.state.field(activeField, false) === commentId) return
  view.dispatch({ effects: setActiveComment.of(commentId) })
}

/** The live (mapped) anchor ranges — rail sorting, resolve snapshots. */
export function liveAnchors(state: EditorState): readonly LiveAnchor[] {
  return state.field(anchorsField, false) ?? []
}

/** Select, scroll to, and briefly highlight an anchored range. */
export function flashAnchor(view: EditorView, from: number, to: number): void {
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: [setFlashRange.of({ from, to }), EditorView.scrollIntoView(from, { y: 'center' })]
  })
  window.setTimeout(() => {
    view.dispatch({ effects: setFlashRange.of(null) })
  }, 1200)
}

/** Flash a comment's CURRENT live range; false when it has none (detached). */
export function flashAnchorById(view: EditorView, commentId: string): boolean {
  const anchor = liveAnchors(view.state).find((a) => a.id === commentId)
  if (anchor === undefined) return false
  flashAnchor(view, anchor.from, anchor.to)
  return true
}
