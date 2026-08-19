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
 * `onActivate(commentId)` — the reverse of clicking its rail card — and
 * clicking anywhere else in the text fires `onActivate(null)`, so the solid
 * "you are in this thread" trail reverts to the dotted resting one as soon as
 * the caret leaves. No keymap here: ⌘⇧M is owned solely by
 * editor/keymap.ts's formatting keymap (the duplicate registration is gone).
 */
export function commentHighlightExtension(
  onActivate: (commentId: string | null) => void
): Extension {
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
      mousedown(event, view) {
        if (event.button !== 0) return false
        const target = event.target as Element | null
        const el = target?.closest?.('[data-comment-id]')
        const id = el?.getAttribute('data-comment-id')
        if (id !== null && id !== undefined && id !== '') {
          onActivate(id)
          return false
        }
        // Clicking away from every anchor DEACTIVATES: the solid trail means
        // "this is the thread you are in", so leaving it solid after the
        // caret has moved elsewhere is a lie, and with several comments in a
        // paragraph it points at the wrong one.
        //
        // Tooltips and panels are exempt. They live inside the editor's DOM
        // but are chrome, not text — the AI-diff Accept/Reject popover in
        // particular can sit inside a commented sentence, and using it must
        // not drop the highlight of the comment being worked on.
        if (target?.closest?.('.cm-tooltip, .cm-panel') != null) return false
        if (view.state.field(activeField, false) == null) return false
        onActivate(null)
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

/**
 * Where a jumped-to anchor lands in the readable viewport: 10% above its
 * middle. Dead centre reads as "somewhere in the page"; a bit high leaves the
 * sentence with its following context visible, which is what a reviewer
 * reads next, and it is the SAME spot every time — the point of the rule.
 */
export const ANCHOR_VIEWPORT_FRACTION = 0.4

/**
 * The `yMargin` that puts an anchor at ANCHOR_VIEWPORT_FRACTION of the
 * READABLE height — the scrollport minus whatever sticky chrome covers its
 * top (the manuscript tab's toolbar). CodeMirror's `y: 'start'` lands the
 * range at `scrollport top + yMargin`, so the offset is measured from the
 * true top and the inset has to be added back in.
 */
export function anchorYMargin(
  viewportHeight: number,
  insetTop: number,
  fraction: number = ANCHOR_VIEWPORT_FRACTION
): number {
  const readable = Math.max(0, viewportHeight - insetTop)
  return insetTop + readable * fraction
}

/**
 * The element the document actually scrolls in, found the way CodeMirror's
 * own scrollIntoView finds it: the nearest ancestor that overflows. It is
 * `.msdoc` in the manuscript tab and CodeMirror's own scroller in the editor
 * tab, so neither surface may hard-code one.
 */
function scrollportOf(view: EditorView): HTMLElement | null {
  let cur: HTMLElement | null = view.scrollDOM
  while (cur !== null && cur !== document.body) {
    if (cur.scrollHeight > cur.clientHeight) return cur
    cur = cur.parentElement
  }
  return null
}

/** Height of the sticky chrome pinned to the scrollport's top, if any. */
function stickyInsetOf(scrollport: HTMLElement): number {
  let inset = 0
  for (const child of Array.from(scrollport.children)) {
    if (!(child instanceof HTMLElement)) continue
    const style = getComputedStyle(child)
    if (style.position !== 'sticky' || parseFloat(style.top || 'NaN') !== 0) continue
    inset = Math.max(inset, child.getBoundingClientRect().height)
  }
  return inset
}

/** How long the flash — and the pin that holds the anchor in place — last. */
const FLASH_MS = 1200
/** Corrections below this are invisible; chasing them would only churn. */
const PIN_EPSILON_PX = 1

/**
 * How far the scrollport must move to put a block at its target line.
 * Positive scrolls down. Pure so the arithmetic can be tested without a DOM.
 */
export function anchorScrollDelta(
  blockTopOnScreen: number,
  portTop: number,
  portHeight: number,
  insetTop: number,
  fraction: number = ANCHOR_VIEWPORT_FRACTION
): number {
  return blockTopOnScreen - (portTop + anchorYMargin(portHeight, insetTop, fraction))
}

/** The pin currently holding an anchor in place, if any — at most one. */
let activePin: (() => void) | null = null
/** The pending "put the flash out" timer — at most one, see flashAnchor. */
let flashTimer = 0

/**
 * What makes the pin let go. USER GESTURES only, deliberately: a scrollTop we
 * did not write is not evidence of the user, because CodeMirror corrects the
 * scroll position itself whenever it replaces estimated line heights with
 * measured ones. Aborting on that was measurably worse than not aborting —
 * it dropped the pin mid-flight and left long jumps short of their mark.
 * Other programmatic scrollers call cancelAnchorPin() instead.
 */
const ABORT_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/**
 * Put an anchor at its target line and HOLD it there for FLASH_MS.
 *
 * One scroll is not enough on this surface, which is what made repeated jumps
 * land differently: after the scroll lands, the document above the anchor
 * keeps changing height — figure and math widgets resolve asynchronously,
 * CodeMirror swaps estimated line heights for measured ones as regions come
 * into view, and selecting the range reveals the raw source of any rendered
 * span it touches. Every one of those drags the anchor off its mark, and the
 * next click then starts from a different document than the last one.
 *
 * So the target is re-derived from live geometry every frame and the anchor
 * is pulled back onto it — the document settles AROUND a fixed anchor rather
 * than sliding it away. The pin holds only as long as the flash, and any user
 * gesture on the scrollport ends it immediately (see ABORT_EVENTS).
 */
function pinAnchor(view: EditorView, pos: number, commentId: string | null): void {
  activePin?.()
  const found = scrollportOf(view)
  if (found === null || found.clientHeight === 0) {
    // no measurable scrollport (detached view, or nothing overflows) — let
    // CodeMirror do its ancestor walk instead of guessing
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    return
  }
  // bound non-null so the frame closures below keep the narrowing
  const port: HTMLElement = found

  let frameId = 0
  let stopped = false

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (frameId !== 0) cancelAnimationFrame(frameId)
    for (const event of ABORT_EVENTS) port.removeEventListener(event, stop, true)
    if (activePin === stop) activePin = null
  }

  const correct = (): void => {
    if (!view.dom.isConnected || port.clientHeight === 0) return stop()
    // re-resolve by id so an edit that moves the text moves the pin with it
    let target = pos
    if (commentId !== null) {
      const live = liveAnchors(view.state).find((a) => a.id === commentId)
      if (live === undefined) return stop()
      target = live.from
    }
    const clamped = Math.min(target, view.state.doc.length)
    const rect = port.getBoundingClientRect()
    const delta = anchorScrollDelta(
      view.documentTop + view.lineBlockAt(clamped).top,
      rect.top,
      port.clientHeight,
      stickyInsetOf(port)
    )
    if (Math.abs(delta) >= PIN_EPSILON_PX) port.scrollTop += delta
  }

  for (const event of ABORT_EVENTS) port.addEventListener(event, stop, { capture: true, passive: true })
  activePin = stop
  // the first correction is synchronous: the jump must not cost a frame
  correct()
  const deadline = performance.now() + FLASH_MS
  const frame = (): void => {
    frameId = 0
    if (stopped) return
    correct()
    if (performance.now() >= deadline) return stop()
    frameId = requestAnimationFrame(frame)
  }
  frameId = requestAnimationFrame(frame)
}

/**
 * Release any anchor pin currently holding the document in place. Anything
 * else that scrolls these surfaces programmatically (the section outline)
 * calls this first, so the two never fight over the same scrollport.
 */
export function cancelAnchorPin(): void {
  activePin?.()
}

/**
 * Select, scroll to, and briefly highlight an anchored range. `commentId`
 * lets the pin track the anchor through document changes.
 */
export function flashAnchor(view: EditorView, from: number, to: number, commentId?: string): void {
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: [setFlashRange.of({ from, to })]
  })
  // AFTER the dispatch, so the reveal reflow that selecting a rendered span
  // triggers is already in the geometry the first correction measures
  pinAnchor(view, from, commentId ?? null)
  // One timer for the whole app, replaced on every flash. Scheduling a fresh
  // one per flash meant the PREVIOUS flash's timer put out the current one:
  // jump to a comment, jump to another within the second, and the second
  // highlight died a few hundred ms after it lit.
  if (flashTimer !== 0) window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    flashTimer = 0
    view.dispatch({ effects: setFlashRange.of(null) })
  }, FLASH_MS)
}

/** Flash a comment's CURRENT live range; false when it has none (detached). */
export function flashAnchorById(view: EditorView, commentId: string): boolean {
  const anchor = liveAnchors(view.state).find((a) => a.id === commentId)
  if (anchor === undefined) return false
  flashAnchor(view, anchor.from, anchor.to, commentId)
  return true
}
