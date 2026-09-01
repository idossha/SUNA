import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX
} from 'react'
import type { EditorView } from '@codemirror/view'
import type { Comment } from '@suna/core'
import { cliGate, runCommentFix, type CliGateResult } from '../ai/directedActions'
import type { CommentThreadEntry } from '../ai/templates'
import { commentRunKey, useAiActionsStore } from '../state/aiActions'
import {
  COMMENTS_RAIL_WIDTH_MIN,
  clampCommentsRailWidth,
  useUiStore
} from '../state/ui'
import { useCommentsStore } from '../state/comments'
import { useProjectStore } from '../state/project'
import { locate, makeAnchor } from './anchor'
import {
  revealAnchorById,
  getAnchorsEpoch,
  liveAnchors,
  setActiveInView,
  subscribeAnchorGeometry,
  subscribeAnchorsEpoch
} from './anchorExtension'
import { CommentsOutline } from './CommentsOutline'
import { layoutSlots } from './railLayout'
import { relativeTime } from './relativeTime'
import './comments.css'

/**
 * The right-side comments rail, ANCHOR-ALIGNED: every card sits level with
 * the text it annotates and moves 1:1 with it while scrolling.
 *
 * Lag-free by construction — the two mistakes of the old margin gutter are
 * structurally impossible here:
 *  - Card positions are DOCUMENT-SPACE offsets computed from CodeMirror's
 *    height map (`lineBlockAt`, viewport-independent), recomputed only when
 *    the document, the comment set, or the geometry changes — never on
 *    scroll.
 *  - Scrolling applies ONE compositor-only `translateY` to the whole track,
 *    written directly to the DOM in the scroll handler (rAF-throttled). No
 *    React render, no layout read, no animated `top`.
 */

export interface CommentsRailProps {
  /** Every comment relevant to this document (any target kind). */
  comments: readonly Comment[]
  /** Comment target path relative to manuscript/ (null: no composing here). */
  docPath: string | null
  /** The live editor view — anchors, jumps, resolve snapshots. */
  getView: () => EditorView | null
  /** The element that scrolls the document (.msdoc, or CM's scrollDOM) —
   *  observed for size changes; scroll itself is captured on the host row. */
  getScrollElement: () => HTMLElement | null
}

/** Space the document keeps when the rail is dragged wide (the flux rule). */
const HOST_MIN_DOCUMENT_PX = 420
/** Assumed height for a card not measured yet. */
const DEFAULT_CARD_HEIGHT = 72
/** Prose sent to the agent around a comment's anchor (DECISIONS 2026-08-17). */
const SURROUND_RADIUS = 400
/** Shown on the AI buttons until the one cliGate round trip resolves. */
const GATE_PENDING: CliGateResult = { ok: false, reason: 'Checking for an AI CLI…' }

/** Clamped `[from - radius, to + radius)` slice — the agent's local context. */
export function surroundingText(
  text: string,
  from: number,
  to: number,
  radius: number = SURROUND_RADIUS
): string {
  return text.slice(Math.max(0, from - radius), Math.min(text.length, to + radius))
}

/**
 * The thread as the comment-fix template wants it: the comment first, then
 * its replies in order, agent authors named by model like AuthorBadge.
 */
export function commentThreadEntries(comment: Comment): CommentThreadEntry[] {
  const label = (author: Comment['author']): string =>
    author.kind === 'agent' ? (author.model ?? author.name) : author.name
  return [
    { author: label(comment.author), when: comment.createdAt, body: comment.body },
    ...comment.replies.map((reply) => ({
      author: label(reply.author),
      when: reply.createdAt,
      body: reply.body
    }))
  ]
}

function AuthorBadge({ author }: { author: Comment['author'] }): JSX.Element {
  return (
    <span className={author.kind === 'agent' ? 'cmt__badge cmt__badge--agent' : 'cmt__badge'}>
      {author.kind === 'agent' ? (author.model ?? author.name) : author.name}
    </span>
  )
}

function DraftComposer(): JSX.Element | null {
  const draft = useCommentsStore((s) => s.draft)
  const [body, setBody] = useState('')

  if (draft === null) return null

  const cancel = (): void => {
    setBody('')
    useCommentsStore.getState().cancelDraft()
  }

  const submit = async (): Promise<void> => {
    if (body.trim().length === 0) return
    const added = await useCommentsStore.getState().add(draft.target, body)
    setBody('')
    // `add` deliberately does not touch the draft (it is also the store's
    // generic "create a comment" entry point), so the composer must retire
    // its own draft. Left open on failure so the typed body is not lost.
    if (added !== null) useCommentsStore.getState().cancelDraft()
  }

  return (
    <div className="cmt-card cmt-card--active cmt__draft">
      <div className="cmt__target">On: “{draft.preview}”</div>
      <textarea
        className="cmt-textarea"
        autoFocus
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
      />
      <div className="cmt__draft-actions">
        <button className="cmt__btn" onClick={cancel}>
          Cancel
        </button>
        <button
          className="cmt__btn cmt__btn--primary"
          disabled={body.trim().length === 0}
          onClick={() => void submit()}
        >
          Comment
        </button>
      </div>
    </div>
  )
}

/**
 * Is there a text selection INSIDE this element? The card suppresses
 * activation while the user is selecting its text to copy — but the test has
 * to be local. A bare `getSelection().toString() !== ''` also sees the
 * EDITOR's selection, and jumping to a comment leaves one there (revealAnchor
 * selects the anchored range, which a focused editor mirrors into the DOM).
 * That made the next card click a no-op: click one comment, click another,
 * nothing happens until you click again.
 */
function selectionInside(el: HTMLElement): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.toString() === '') return false
  const { anchorNode, focusNode } = selection
  return (
    (anchorNode !== null && el.contains(anchorNode)) ||
    (focusNode !== null && el.contains(focusNode))
  )
}

interface ThreadCardProps {
  comment: Comment
  active: boolean
  onActivate: () => void
  getView: () => EditorView | null
  /** Shared verdict from the rail's single cliGate round trip (§2a). */
  aiGate: CliGateResult
}

function ThreadCard({ comment, active, onActivate, getView, aiGate }: ThreadCardProps): JSX.Element {
  const [replying, setReplying] = useState(false)
  const [replyBody, setReplyBody] = useState('')

  // The run lives in the aiActions store, not here: this card unmounts on
  // deactivate while the CLI child keeps going, and must find its progress
  // and cancel handle again on remount.
  const aiRun = useAiActionsStore((s) => s.runs[commentRunKey(comment.id)])

  // The composing guard is tied to the reply box's MOUNTED LIFETIME, not to
  // imperative open/close calls: hiding the rail, closing the tab, or an
  // external delete unmounting this card mid-reply must all release the
  // guard, or external comments.json reloads stay suppressed forever.
  useEffect(() => {
    if (!replying) return
    useCommentsStore.getState().setComposing(true)
    return () => useCommentsStore.getState().setComposing(false)
  }, [replying])

  // deactivating a card unrenders its reply box — close the state with it
  useEffect(() => {
    if (!active) setReplying(false)
  }, [active])

  const closeReply = (): void => setReplying(false)
  const openReply = (): void => setReplying(true)

  const submitReply = async (): Promise<void> => {
    if (replyBody.trim().length === 0) return
    await useCommentsStore.getState().reply(comment.id, replyBody)
    setReplyBody('')
    closeReply()
  }

  const toggleResolved = (): void => {
    const nextResolved = !comment.resolved
    let refreshed: { quote: string; prefix: string; suffix: string } | undefined
    if (nextResolved) {
      // snapshot the LIVE range into the anchor before its mark is dropped
      // (flux PAP-9) — reopening later re-anchors exactly where it was
      const view = getView()
      const anchor = view === null ? undefined : liveAnchors(view.state).find((a) => a.id === comment.id)
      if (view !== null && anchor !== undefined) {
        refreshed = makeAnchor(view.state.doc.toString(), anchor.from, anchor.to)
      }
    }
    void useCommentsStore.getState().resolve(comment.id, nextResolved, refreshed)
  }

  const sendToAi = (): void => {
    if (comment.target.kind !== 'section') return
    const rootDir = useProjectStore.getState().rootDir
    if (rootDir === null) return
    // Snapshot the LIVE anchor exactly like toggleResolved (flux PAP-9): the
    // agent's find/replace must aim at where the text is NOW, not at where
    // it was when the comment was written.
    const view = getView()
    let anchor: { quote: string; prefix: string; suffix: string } = comment.target.anchor
    // no live buffer (editor unmounted): the stored anchor context stands in
    let surrounding = `${anchor.prefix}${anchor.quote}${anchor.suffix}`
    let detached = comment.detached
    if (view !== null) {
      const text = view.state.doc.toString()
      const live = liveAnchors(view.state).find((a) => a.id === comment.id)
      if (live !== undefined) {
        anchor = makeAnchor(text, live.from, live.to)
        surrounding = surroundingText(text, live.from, live.to)
        detached = false
      } else {
        // detached: the quote may still fuzzily locate in the buffer
        const range = locate(text, comment.target.anchor)
        if (range !== null) surrounding = surroundingText(text, range.from, range.to)
        detached = true
      }
    }
    // Fire-and-forget: progress/cancel live under 'comment:<id>' in the
    // aiActions store; the reply/resolve land back through the comments.json
    // watcher. `composing` stays untouched — setting it would defer exactly
    // the reload that delivers the agent's reply.
    void runCommentFix({
      rootDir,
      // absolute, composed the way state/comments.ts reads the file
      manuscriptPath: `${rootDir}/manuscript/${comment.target.path}`,
      commentId: comment.id,
      anchor,
      thread: commentThreadEntries(comment),
      surrounding,
      detached
    })
  }

  return (
    <div
      className={`cmt-card${active ? ' cmt-card--active' : ' cmt-card--compact'}${comment.resolved ? ' cmt-card--resolved' : ''}${aiRun !== undefined ? ' cmt-card--ai-busy' : ''}`}
      data-comment-id={comment.id}
    >
      {/* A div, not a button: comment text must stay mouse-selectable for
          copying, and buttons suppress text selection. Activation skips
          clicks that end a selection drag so copying never toggles the card. */}
      <div
        className="cmt-card__main"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (!selectionInside(e.currentTarget)) onActivate()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onActivate()
          }
        }}
      >
        <div className="cmt__card-head">
          <AuthorBadge author={comment.author} />
          <span className="cmt__time">{relativeTime(comment.createdAt)}</span>
          {comment.detached && (
            <span
              className="cmt__detached"
              title="The original text was not found — this comment is detached"
            >
              detached
            </span>
          )}
          {comment.resolved && <span className="cmt__badge cmt__badge--resolved">resolved</span>}
        </div>
        {comment.target.kind === 'section' && (
          <div className="cmt__quote">“{comment.target.anchor.quote}”</div>
        )}
        <div className={`cmt-card__body${active ? '' : ' cmt-card__body--clamped'}`}>
          {comment.body}
        </div>
      </div>

      {active && (
        <>
          {comment.replies.length > 0 && (
            <div className="cmt__replies">
              {comment.replies.map((reply) => (
                <div key={reply.id} className="cmt__reply">
                  <div className="cmt__card-head">
                    <AuthorBadge author={reply.author} />
                    <span className="cmt__time">{relativeTime(reply.createdAt)}</span>
                  </div>
                  <div className="cmt__body">{reply.body}</div>
                </div>
              ))}
            </div>
          )}

          {replying ? (
            <div className="cmt__replybox">
              <textarea
                className="cmt-textarea"
                autoFocus
                placeholder="Reply…"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeReply()
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitReply()
                }}
              />
              <div className="cmt__draft-actions">
                <button className="cmt__btn" onClick={closeReply}>
                  Cancel
                </button>
                <button className="cmt__btn cmt__btn--primary" onClick={() => void submitReply()}>
                  Reply
                </button>
              </div>
            </div>
          ) : aiRun !== undefined ? (
            <div className="cmt__actions">
              <span className="cmt__ai-note">✦ {aiRun.note}</span>
              <button className="cmt__btn" onClick={() => aiRun.cancel()}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="cmt__actions">
              <button className="cmt__btn" onClick={openReply}>
                Reply
              </button>
              {comment.target.kind === 'section' && (
                <button
                  className="cmt__btn cmt__btn--ai"
                  disabled={!aiGate.ok}
                  title={aiGate.ok ? 'Send this comment to the AI agent' : aiGate.reason}
                  onClick={sendToAi}
                >
                  ✦ AI
                </button>
              )}
              <button className="cmt__btn" onClick={toggleResolved}>
                {comment.resolved ? 'Reopen' : 'Resolve'}
              </button>
              <button
                className="cmt__btn cmt__btn--danger"
                onClick={() => void useCommentsStore.getState().removeWithUndo(comment.id)}
              >
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface RailLayout {
  /** commentId -> document-space top (px), collision-resolved. */
  tops: ReadonlyMap<string, number>
  /** The draft composer's document-space top, when locatable. */
  draftTop: number | null
  trackHeight: number
}

const EMPTY_LAYOUT: RailLayout = { tops: new Map(), draftTop: null, trackHeight: 0 }

export function CommentsRail({
  comments,
  docPath,
  getView,
  getScrollElement
}: CommentsRailProps): JSX.Element | null {
  const visible = useUiStore((s) => s.commentsRailVisible)
  const width = useUiStore((s) => s.commentsRailWidth)
  const activeId = useCommentsStore((s) => s.activeId)
  const revealRequest = useCommentsStore((s) => s.revealRequest)
  const draft = useCommentsStore((s) => s.draft)
  const railRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const openCount = useMemo(() => comments.filter((c) => !c.resolved).length, [comments])

  // One cliGate round trip per rail-show, shared by every card — a per-card
  // gate would be N identical 'lit:cli-status' IPC calls for one answer.
  const [aiGate, setAiGate] = useState<CliGateResult>(GATE_PENDING)
  useEffect(() => {
    if (!visible) return
    let stale = false
    void cliGate().then((gate) => {
      if (!stale) setAiGate(gate)
    })
    return () => {
      stale = true
    }
  }, [visible])

  // Bumped on doc changes and comment-list applications in the editor — the
  // signal that anchor positions may have moved.
  const anchorsEpoch = useSyncExternalStore(subscribeAnchorsEpoch, getAnchorsEpoch)

  // Resolved threads leave the working surface entirely: they collect in the
  // History section (reopenable, deletable) so finished business never
  // competes with open review work. Deleted comments, by contrast, are gone
  // for good once the undo toast lapses.
  const resolved = useMemo(() => comments.filter((c) => c.resolved), [comments])

  // Anchored vs detached/unanchored (OPEN threads only): comments with a
  // LIVE anchor get a document-space position; the rest collect in the
  // pinned section on top. Anchored cards render in document order so
  // DOM/tab order matches the visual top-to-bottom order the layout produces.
  const { anchored, unanchored } = useMemo(() => {
    const view = getView()
    const live = new Map<string, number>()
    if (view !== null) for (const anchor of liveAnchors(view.state)) live.set(anchor.id, anchor.from)
    const anchoredList: Comment[] = []
    const unanchoredList: Comment[] = []
    for (const comment of comments) {
      if (comment.resolved) continue
      if (comment.target.kind === 'section' && live.has(comment.id)) anchoredList.push(comment)
      else unanchoredList.push(comment)
    }
    anchoredList.sort((a, b) => (live.get(a.id) ?? 0) - (live.get(b.id) ?? 0))
    return { anchored: anchoredList, unanchored: unanchoredList }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, anchorsEpoch, getView])

  /* A detached thread has no place on the aligned surface, so its card lives
     in the pinned <details> below — which used to stay CLOSED when the card
     was activated. Clicking such a thread in the outline then looked inert:
     it went active, and its card stayed hidden inside a collapsed group, with
     no way to reach Resolve or Delete. Activation now opens the group and
     scrolls the card into view, so a detached comment is exactly as usable as
     an anchored one. Manual toggling still wins afterwards (onToggle). */
  const pinnedRef = useRef<HTMLDetailsElement>(null)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const activeIsUnanchored = useMemo(
    () => activeId !== null && unanchored.some((c) => c.id === activeId),
    [activeId, unanchored]
  )
  useEffect(() => {
    if (!activeIsUnanchored) return
    setPinnedOpen(true)
    // after the group paints, bring the card itself into the rail's view
    const raf = requestAnimationFrame(() => {
      pinnedRef.current
        ?.querySelector(`.cmt-card[data-comment-id="${activeId}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [activeIsUnanchored, activeId])

  /* ---- geometry: document-space layout + measured transform ----------------

     Everything on this surface is derived from MEASURED geometry, never from
     cached arithmetic:

     - Slot tops are pure document coordinates (`lineBlockAt(pos).top`,
       relative to the document top — CodeMirror's height map answers for
       off-screen positions too).
     - The per-frame transform is `view.documentTop - viewportRect.top`: it
       measures where the document top ACTUALLY is on screen right now, so
       nested scrollers, rubber-banding, and late layout shifts all land in
       exactly the right place — there is no cached origin to drift from.
     - When CodeMirror replaces height ESTIMATES with measurements while
       content scrolls into view (the source of "cards shift as I scroll"),
       the extension's geometry channel triggers a re-layout; the layout
       compare below turns no-op refinements into zero React work.          */

  const [layout, setLayout] = useState<RailLayout>(EMPTY_LAYOUT)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const heightsRef = useRef(new Map<string, number>())

  const syncTransform = useCallback((): void => {
    const track = trackRef.current
    const viewport = viewportRef.current
    const view = getView()
    if (track === null || viewport === null || view === null || !view.dom.isConnected) return
    // read both, then write — one layout pass per frame
    const y = view.documentTop - viewport.getBoundingClientRect().top
    track.style.transform = `translateY(${y}px)`
  }, [getView])

  const recomputeLayout = useCallback((): void => {
    const view = getView()
    const viewport = viewportRef.current
    if (view === null || viewport === null) {
      if (layoutRef.current !== EMPTY_LAYOUT) setLayout(EMPTY_LAYOUT)
      return
    }
    // hidden dock panel (dockview detaches inactive DOM) — keep the layout
    if (!view.dom.isConnected || viewport.getBoundingClientRect().height === 0) return

    const live = new Map(liveAnchors(view.state).map((a) => [a.id, a]))
    const entries: { id: string; desiredTop: number; height: number }[] = []
    for (const comment of anchored) {
      const anchor = live.get(comment.id)
      if (anchor === undefined) continue
      // rounded: sub-pixel churn from re-measures must not defeat the
      // same-layout compare below
      const desiredTop = Math.round(view.lineBlockAt(anchor.from).top)
      entries.push({
        id: comment.id,
        desiredTop,
        height: heightsRef.current.get(comment.id) ?? DEFAULT_CARD_HEIGHT
      })
    }
    // the draft composer aligns with its selection too
    let draftTop: number | null = null
    const currentDraft = useCommentsStore.getState().draft
    if (currentDraft !== null && currentDraft.target.kind === 'section') {
      const range = locate(view.state.doc.toString(), currentDraft.target.anchor)
      if (range !== null) {
        draftTop = Math.round(view.lineBlockAt(range.from).top)
        entries.push({
          id: '__draft__',
          desiredTop: draftTop,
          height: heightsRef.current.get('__draft__') ?? DEFAULT_CARD_HEIGHT * 2
        })
      }
    }
    const tops = layoutSlots(entries)
    const resolvedDraftTop = tops.get('__draft__') ?? draftTop
    tops.delete('__draft__')
    let bottom = Math.ceil(view.contentHeight)
    for (const [id, top] of tops) {
      bottom = Math.max(bottom, top + (heightsRef.current.get(id) ?? DEFAULT_CARD_HEIGHT))
    }
    const next: RailLayout = { tops, draftTop: resolvedDraftTop, trackHeight: bottom }
    // avoid render loops from the slot ResizeObserver: only set when moved
    const prev = layoutRef.current
    let same =
      prev.tops.size === next.tops.size &&
      prev.draftTop === next.draftTop &&
      prev.trackHeight === next.trackHeight
    if (same) {
      for (const [id, top] of next.tops) {
        if (prev.tops.get(id) !== top) {
          same = false
          break
        }
      }
    }
    if (!same) setLayout(next)
    syncTransform()
  }, [anchored, getView, syncTransform])

  const recomputeRef = useRef(recomputeLayout)
  recomputeRef.current = recomputeLayout
  const recomputePendingRef = useRef(false)
  const scheduleRecompute = useCallback((): void => {
    // coalesced: geometry ticks can arrive in bursts while content streams in
    if (recomputePendingRef.current) return
    recomputePendingRef.current = true
    requestAnimationFrame(() => {
      recomputePendingRef.current = false
      recomputeRef.current()
    })
  }, [])

  // layout recomputes on: comment set / doc changes (anchorsEpoch via
  // `anchored`), the draft appearing/moving, activation (card growth is
  // caught by the slot ResizeObserver, but re-measure eagerly anyway)
  useEffect(() => {
    scheduleRecompute()
  }, [anchored, draft, activeId, scheduleRecompute])

  // CodeMirror re-measured (estimates -> real line heights, image loads,
  // font settles): block tops may have shifted without any doc change.
  useEffect(() => {
    if (!visible) return
    return subscribeAnchorGeometry(scheduleRecompute)
  }, [visible, scheduleRecompute])

  // scroll -> ONE direct transform write per frame. Capture-phase on the
  // host row (the rail's parent contains the scroller), so ANY scrolling
  // element — .msdoc, CodeMirror's scrollDOM, anything nested — keeps the
  // track in lockstep; scroll events don't bubble but they do capture.
  useEffect(() => {
    if (!visible) return
    const host = railRef.current?.parentElement
    if (host === undefined || host === null) return
    let scheduled = false
    const onScroll = (): void => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        syncTransform()
      })
    }
    host.addEventListener('scroll', onScroll, { capture: true, passive: true })
    const resizeObserver = new ResizeObserver(() => scheduleRecompute())
    const scroller = getScrollElement()
    if (scroller !== null) resizeObserver.observe(scroller)
    if (viewportRef.current !== null) resizeObserver.observe(viewportRef.current)
    scheduleRecompute()
    return () => {
      host.removeEventListener('scroll', onScroll, { capture: true })
      resizeObserver.disconnect()
    }
  }, [visible, getScrollElement, syncTransform, scheduleRecompute])

  // ONE ResizeObserver for every slot: expanding a card (replies, composer)
  // pushes its neighbours down without a fresh observer per render.
  const slotObserverRef = useRef<ResizeObserver | null>(null)
  if (slotObserverRef.current === null && typeof ResizeObserver !== 'undefined') {
    slotObserverRef.current = new ResizeObserver((observed) => {
      let changed = false
      for (const entry of observed) {
        const id = (entry.target as HTMLElement).dataset['slotId']
        if (id === undefined) continue
        const height = Math.round(entry.contentRect.height)
        if (heightsRef.current.get(id) !== height) {
          heightsRef.current.set(id, height)
          changed = true
        }
      }
      if (changed) scheduleRecompute()
    })
  }
  useEffect(() => () => slotObserverRef.current?.disconnect(), [])
  const observeSlot = useCallback((el: HTMLElement | null): void => {
    if (el !== null) slotObserverRef.current?.observe(el)
    // detached elements are dropped by the observer automatically
  }, [])

  /* ---- store mirroring ------------------------------------------------------ */

  // The rail's focused thread mirrors into the editor's highlight. No rail
  // scrolling here: cards live at their anchors, so visibility follows the
  // document itself.
  useEffect(() => {
    const view = getView()
    if (view !== null) setActiveInView(view, activeId)
  }, [activeId, getView])

  // "scroll to the anchor" — one watcher for both surfaces, each
  // nonce consumed exactly once.
  const lastRevealNonceRef = useRef(0)
  useEffect(() => {
    if (revealRequest === null || revealRequest.nonce === lastRevealNonceRef.current) return
    lastRevealNonceRef.current = revealRequest.nonce
    const view = getView()
    if (view !== null) revealAnchorById(view, revealRequest.commentId)
  }, [revealRequest, getView])

  if (!visible) return null

  const activate = (comment: Comment): void => {
    const store = useCommentsStore.getState()
    const next = store.activeId === comment.id ? null : comment.id
    store.setActive(next)
    if (next !== null) {
      const view = getView()
      if (view !== null) revealAnchorById(view, comment.id)
    }
  }

  const startGripDrag = (event: React.PointerEvent): void => {
    event.preventDefault()
    const host = railRef.current?.parentElement
    const onMove = (e: PointerEvent): void => {
      const rect = host?.getBoundingClientRect()
      if (rect === undefined) return
      const max = Math.max(COMMENTS_RAIL_WIDTH_MIN, rect.width - HOST_MIN_DOCUMENT_PX)
      const next = Math.min(clampCommentsRailWidth(rect.right - e.clientX), max)
      useUiStore.getState().setCommentsRailWidth(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="cmt-rail" ref={railRef} style={{ flex: `0 0 ${width}px`, width }}>
      <div
        className="cmt-rail__grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize comments"
        onPointerDown={startGripDrag}
      />
      <div className="cmt-rail__header">
        <span className="cmt-rail__title">Comments</span>
        {openCount > 0 && <span className="cmt-rail__count">{openCount}</span>}
        <button
          className="cmt-rail__close"
          title="Hide comments"
          aria-label="Hide comments"
          onClick={() => useUiStore.getState().setCommentsRailVisible(false)}
        >
          ×
        </button>
      </div>
      <CommentsOutline comments={comments} activeId={activeId} getView={getView} />
      {unanchored.length > 0 && (
        <details
          className="cmt-rail__pinned"
          ref={pinnedRef}
          open={pinnedOpen}
          onToggle={(e) => setPinnedOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          {/* Only OPEN threads reach this group (resolved ones live in
              History below), so the count is honestly alarming. */}
          <summary>Detached / unanchored ({unanchored.length})</summary>
          <div className="cmt-rail__pinned-list">
            {unanchored.map((comment) => (
              <ThreadCard
                key={comment.id}
                comment={comment}
                active={comment.id === activeId}
                onActivate={() =>
                  useCommentsStore.getState().setActive(comment.id === activeId ? null : comment.id)
                }
                getView={getView}
                aiGate={aiGate}
              />
            ))}
          </div>
        </details>
      )}
      {anchored.length === 0 && unanchored.length === 0 && draft === null && docPath !== null && (
        <p className="cmt-rail__empty">
          Select text and press <b>⌘⇧M</b> to leave a comment.
        </p>
      )}
      {/* The aligned surface: clipped viewport, document-height track kept in
          lockstep with the scroller by a transform (see header comment). */}
      <div className="cmt-rail__viewport" ref={viewportRef}>
        <div className="cmt-rail__track" ref={trackRef} style={{ height: layout.trackHeight }}>
          {draft !== null && (
            <div
              className="cmt-rail__slot"
              data-slot-id="__draft__"
              ref={observeSlot}
              style={{ top: layout.draftTop ?? 0 }}
            >
              <DraftComposer key={draft.nonce} />
            </div>
          )}
          {anchored.map((comment) => (
            <div
              key={comment.id}
              className="cmt-rail__slot"
              data-slot-id={comment.id}
              ref={observeSlot}
              style={{ top: layout.tops.get(comment.id) ?? 0 }}
            >
              <ThreadCard
                comment={comment}
                active={comment.id === activeId}
                onActivate={() => activate(comment)}
                getView={getView}
                aiGate={aiGate}
              />
            </div>
          ))}
        </div>
      </div>
      {/* Resolved threads: out of the working surface, into a separately
          viewable history. Reopen puts one back in play; Delete (plus the
          lapsed undo toast) is the only way a thread truly disappears. */}
      {resolved.length > 0 && (
        <details className="cmt-rail__history">
          <summary>History ({resolved.length})</summary>
          <div className="cmt-rail__history-list">
            {resolved.map((comment) => (
              <ThreadCard
                key={comment.id}
                comment={comment}
                active={comment.id === activeId}
                onActivate={() =>
                  useCommentsStore.getState().setActive(comment.id === activeId ? null : comment.id)
                }
                getView={getView}
                aiGate={aiGate}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
