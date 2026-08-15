import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefCallback
} from 'react'
import type { Comment, CommentTarget } from '@suna/core'
import { layoutCards, partitionByViewport, type CardAnchor } from './layout'
import { relativeTime } from './relativeTime'
import { useCommentsStore } from '../state/comments'
import './comments.css'

/** Vertical gap kept between two stacked cards (or dots), in px. */
const CARD_GAP = 10
const DOT_GAP = 6
const DOT_SIZE = 10
/** Assumed height for a card whose real height hasn't been measured yet. */
const DEFAULT_CARD_HEIGHT = 72
/** Anchors this far past the visible edge still render inline rather than collapsing into a badge — avoids a card flickering into/out of the badge right at the boundary. */
const EDGE_MARGIN = 24

function targetLabel(target: CommentTarget): string {
  if (target.kind === 'section') return target.path
  if (target.kind === 'figure') {
    return target.elementId !== undefined ? `${target.figureId} · ${target.elementId}` : target.figureId
  }
  return 'Manuscript'
}

function useMeasuredHeights(): [Map<string, number>, (id: string) => RefCallback<HTMLElement>] {
  const [heights, setHeights] = useState<Map<string, number>>(new Map())
  const observers = useRef(new Map<string, ResizeObserver>())

  const registerFor = useCallback(
    (id: string): RefCallback<HTMLElement> =>
      (el) => {
        const existing = observers.current.get(id)
        if (existing) {
          existing.disconnect()
          observers.current.delete(id)
        }
        if (el === null) return
        const ro = new ResizeObserver((entries) => {
          const entry = entries[0]
          if (entry === undefined) return
          const h = Math.round(entry.contentRect.height)
          setHeights((prev) => (prev.get(id) === h ? prev : new Map(prev).set(id, h)))
        })
        ro.observe(el)
        observers.current.set(id, ro)
      },
    []
  )

  useEffect(() => {
    const map = observers.current
    return () => map.forEach((ro) => ro.disconnect())
  }, [])

  return [heights, registerFor]
}

function AuthorBadge({ author }: { author: Comment['author'] }): JSX.Element {
  return (
    <span className={author.kind === 'agent' ? 'cmt__badge cmt__badge--agent' : 'cmt__badge'}>
      {author.kind === 'agent' ? (author.model ?? author.name) : author.name}
    </span>
  )
}

interface CommentCardProps {
  comment: Comment
  active: boolean
  onActivate: () => void
}

function CommentCard({ comment, active, onActivate }: CommentCardProps): JSX.Element {
  const [replying, setReplying] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const submitReply = async (): Promise<void> => {
    if (replyBody.trim().length === 0) return
    await useCommentsStore.getState().reply(comment.id, replyBody)
    setReplyBody('')
    setReplying(false)
  }

  return (
    <div className={`cmt-card${active ? ' cmt-card--active' : ' cmt-card--compact'}`}>
      <button className="cmt-card__main" onClick={onActivate}>
        <div className="cmt__card-head">
          <AuthorBadge author={comment.author} />
          <span className="cmt__time">{relativeTime(comment.createdAt)}</span>
          {comment.detached && (
            <span className="cmt__detached" title="The original text was not found — this comment is detached">
              detached
            </span>
          )}
          {comment.resolved && <span className="cmt__badge cmt__badge--resolved">resolved</span>}
        </div>
        <div className={`cmt-card__body${active ? '' : ' cmt-card__body--clamped'}`}>{comment.body}</div>
      </button>

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
                  if (e.key === 'Escape') setReplying(false)
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitReply()
                }}
              />
              <div className="cmt__draft-actions">
                <button className="cmt__btn" onClick={() => setReplying(false)}>
                  Cancel
                </button>
                <button className="cmt__btn cmt__btn--primary" onClick={() => void submitReply()}>
                  Reply
                </button>
              </div>
            </div>
          ) : (
            <div className="cmt__actions">
              <button className="cmt__btn" onClick={() => setReplying(true)}>
                Reply
              </button>
              <button
                className="cmt__btn"
                onClick={() => void useCommentsStore.getState().resolve(comment.id, !comment.resolved)}
              >
                {comment.resolved ? 'Unresolve' : 'Resolve'}
              </button>
              {confirmingDelete ? (
                <>
                  <span className="cmt__confirm-label">Delete?</span>
                  <button
                    className="cmt__btn cmt__btn--danger"
                    onClick={() => void useCommentsStore.getState().remove(comment.id)}
                  >
                    Confirm
                  </button>
                  <button className="cmt__btn" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="cmt__btn cmt__btn--danger" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
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
    // its own draft — without this it stays open over the comment it just
    // created and a second click adds a DUPLICATE on the same anchor.
    // Left open on failure so the typed body is not lost.
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

export interface CommentGutterProps {
  /** Every comment relevant to this document (any target kind — non-section and detached comments always land in the Unanchored group). */
  comments: readonly Comment[]
  /** commentId -> ideal top in px, viewport-diffed against this component's forwarded (track) element. A comment absent here is treated as unpositioned. */
  anchorTops: ReadonlyMap<string, number>
  /** Current height of the visible viewport strip, for above/below edge classification. */
  containerHeight: number
  /** Below ~1100px container width the gutter collapses to margin dots + a popover. */
  narrow?: boolean
  activeId: string | null
  onActiveIdChange: (id: string | null) => void
  /** Host-specific "scroll the document to this comment's anchor" (in addition to the shared flash/highlight, which the host's own flashRequest watcher already handles). */
  onAnchorActivate: (comment: Comment) => void
  /**
   * "My positioning track just moved — re-measure `anchorTops`."
   *
   * The track is a flow sibling below the gutter's header (the Unanchored
   * group, the Show-resolved chip, the draft composer), so whenever one of
   * those appears or disappears the track slides up or down while the
   * already-reported `anchorTops` — which are diffed against the track's
   * *old* rect — stay put. The visible symptom is every card sitting a
   * constant offset away from its anchor (measured at 29 px with a draft
   * composer open). Nothing else notices: a ResizeObserver on the track sees
   * no size change, and the document did not scroll.
   */
  onTrackMoved?: () => void
}

/**
 * Right-hand margin comment column. Purely presentational + layout — anchor
 * *positions* are computed by the host (manuscript/ManuscriptTab,
 * manuscript/SectionEditor, editor/EditorTab) via comments/anchorExtension's
 * coordsAtPos helpers, since only the host has the CodeMirror view(s). This
 * component owns collision layout (comments/layout.ts), card-height
 * measurement, the unanchored/resolved groups, and the narrow-viewport dot
 * fallback.
 *
 * The forwarded ref is the *track* element — the same element the host must
 * diff `coordsAtPos` against when computing `anchorTops`, so "top: 0" here
 * and "top: 0" there agree.
 */
export const CommentGutter = forwardRef<HTMLDivElement, CommentGutterProps>(function CommentGutter(
  { comments, anchorTops, containerHeight, narrow = false, activeId, onActiveIdChange, onAnchorActivate, onTrackMoved },
  trackRef
) {
  const [showResolved, setShowResolved] = useState(false)
  const [heights, registerHeightFor] = useMeasuredHeights()

  const { unanchored, positioned } = useMemo(() => {
    const unanchoredList: Comment[] = []
    const positionedList: Comment[] = []
    for (const comment of comments) {
      if (comment.target.kind !== 'section' || comment.detached || !anchorTops.has(comment.id)) {
        unanchoredList.push(comment)
      } else {
        positionedList.push(comment)
      }
    }
    return { unanchored: unanchoredList, positioned: positionedList }
  }, [comments, anchorTops])

  const resolvedCount = positioned.filter((c) => c.resolved).length
  const visible = showResolved ? positioned : positioned.filter((c) => !c.resolved)

  const cardHeight = (comment: Comment): number =>
    heights.get(comment.id) ?? (comment.id === activeId ? DEFAULT_CARD_HEIGHT * 2 : DEFAULT_CARD_HEIGHT)

  const anchors: CardAnchor[] = visible.map((c) => ({
    id: c.id,
    top: anchorTops.get(c.id) ?? 0,
    height: cardHeight(c)
  }))

  const dotHeight = narrow ? DOT_SIZE : 0
  const dotAnchors: CardAnchor[] = narrow ? visible.map((c) => ({ id: c.id, top: anchorTops.get(c.id) ?? 0, height: dotHeight })) : []

  const { above, below, inRange } = partitionByViewport(narrow ? dotAnchors : anchors, containerHeight, EDGE_MARGIN)
  const laidOut = narrow ? layoutCards(inRange, DOT_GAP) : layoutCards(inRange, CARD_GAP)
  const topById = new Map(laidOut.map((p) => [p.id, p.top]))
  const commentById = new Map(comments.map((c) => [c.id, c]))

  const activate = (comment: Comment): void => {
    onActiveIdChange(activeId === comment.id ? null : comment.id)
    onAnchorActivate(comment)
  }

  const draft = useCommentsStore((s) => s.draft)

  // Anything above the track in the flex column changes the track's own top,
  // which silently invalidates every reported anchorTop (see onTrackMoved).
  // useLayoutEffect so the host re-measures in the same frame the header
  // changed — a useEffect here would let one frame paint misaligned.
  const headerShape = `${unanchored.length}|${resolvedCount}|${showResolved}|${draft === null ? 0 : 1}|${narrow ? 1 : 0}`
  useLayoutEffect(() => {
    onTrackMoved?.()
  }, [headerShape, onTrackMoved])

  if (narrow) {
    const activeComment = activeId !== null ? commentById.get(activeId) : undefined
    const activeTop = activeId !== null ? (topById.get(activeId) ?? 0) : 0
    return (
      <div className="cmt-gutter cmt-gutter--narrow" ref={trackRef}>
        {draft !== null && (
          <div className="cmt-popover" style={{ top: 0 }}>
            <DraftComposer />
          </div>
        )}
        {above.length > 0 && (
          <div className="cmt-dot cmt-dot--edge cmt-dot--above" title={`${above.length} comment(s) above`}>
            {above.length}
          </div>
        )}
        {inRange.map((anchor) => {
          const comment = commentById.get(anchor.id)
          if (comment === undefined) return null
          return (
            <button
              key={anchor.id}
              className={`cmt-dot${comment.id === activeId ? ' cmt-dot--active' : ''}${
                comment.author.kind === 'agent' ? ' cmt-dot--agent' : ''
              }`}
              style={{ top: topById.get(anchor.id) }}
              title={comment.body.slice(0, 80)}
              onClick={() => activate(comment)}
            />
          )
        })}
        {below.length > 0 && (
          <div className="cmt-dot cmt-dot--edge cmt-dot--below" title={`${below.length} comment(s) below`}>
            {below.length}
          </div>
        )}
        {unanchored.length > 0 && (
          <button
            className="cmt-dot cmt-dot--unanchored"
            title={`${unanchored.length} unanchored comment(s)`}
            onClick={() => onActiveIdChange(activeId === '__unanchored__' ? null : '__unanchored__')}
          >
            !
          </button>
        )}
        {activeComment !== undefined && (
          <div className="cmt-popover" style={{ top: activeTop }}>
            <CommentCard comment={activeComment} active onActivate={() => activate(activeComment)} />
          </div>
        )}
        {activeId === '__unanchored__' && unanchored.length > 0 && (
          <div className="cmt-popover cmt-popover--list" style={{ top: 0 }}>
            {unanchored.map((c) => (
              <CommentCard key={c.id} comment={c} active={false} onActivate={() => onActiveIdChange(c.id)} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="cmt-gutter">
      {unanchored.length > 0 && (
        <details className="cmt-gutter__unanchored">
          <summary>Unanchored ({unanchored.length})</summary>
          <div className="cmt-gutter__unanchored-list">
            {unanchored.map((c) => (
              <div key={c.id} className="cmt-gutter__unanchored-item">
                <div className="cmt__target">{targetLabel(c.target)}</div>
                <CommentCard comment={c} active={c.id === activeId} onActivate={() => onActiveIdChange(c.id === activeId ? null : c.id)} />
              </div>
            ))}
          </div>
        </details>
      )}
      {resolvedCount > 0 && (
        <button className="cmt-gutter__resolved-toggle" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? 'Hide resolved' : `Show resolved (${resolvedCount})`}
        </button>
      )}
      <DraftComposer />
      <div className="cmt-gutter__track" ref={trackRef}>
        {above.length > 0 && (
          <div className="cmt-gutter__edge cmt-gutter__edge--above" style={{ top: 0 }}>
            {above.length} comment{above.length === 1 ? '' : 's'} above
          </div>
        )}
        {inRange.map((anchor) => {
          const comment = commentById.get(anchor.id)
          if (comment === undefined) return null
          const active = comment.id === activeId
          return (
            <div
              key={anchor.id}
              className="cmt-gutter__slot"
              // e2e drivers correlate a card with its anchor through this id
              // (the ±8px alignment criterion, feature-plan-3 §3).
              data-comment-id={anchor.id}
              style={{ top: topById.get(anchor.id) }}
              ref={registerHeightFor(anchor.id)}
            >
              <CommentCard comment={comment} active={active} onActivate={() => activate(comment)} />
            </div>
          )
        })}
        {below.length > 0 && (
          <div className="cmt-gutter__edge cmt-gutter__edge--below" style={{ top: containerHeight - 20 }}>
            {below.length} comment{below.length === 1 ? '' : 's'} below
          </div>
        )}
      </div>
    </div>
  )
})
