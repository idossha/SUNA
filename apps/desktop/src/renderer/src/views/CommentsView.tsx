import { useEffect, useMemo, useState, type JSX } from 'react'
import type { Comment, CommentTarget } from '@suna/core'
import { relativeTime } from '../comments/relativeTime'
import { openManuscriptTab } from '../state/dock'
import {
  filteredComments,
  readLocalAuthorName,
  setLocalAuthorName,
  useCommentsStore,
  type CommentFilter
} from '../state/comments'
import { useManuscriptStore } from '../state/manuscript'
import { useManuscriptDocStore } from '../state/manuscriptDoc'
import { useProjectStore } from '../state/project'
import { flattenBody } from './outline'
import '../comments/comments.css'
import './views.css'

const FILTERS: { id: CommentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'mine', label: 'Mine' }
]

function targetLabel(target: CommentTarget): string {
  if (target.kind === 'section') return target.path
  if (target.kind === 'figure') {
    return target.elementId !== undefined ? `${target.figureId} · ${target.elementId}` : target.figureId
  }
  return 'Manuscript'
}

function AuthorBadge({ author }: { author: Comment['author'] }): JSX.Element {
  return (
    <span className={author.kind === 'agent' ? 'cmt__badge cmt__badge--agent' : 'cmt__badge'}>
      {author.kind === 'agent' ? (author.model ?? author.name) : author.name}
    </span>
  )
}

function DraftComposer({ onCancel }: { onCancel: () => void }): JSX.Element | null {
  const draft = useCommentsStore((s) => s.draft)
  const [body, setBody] = useState('')

  if (draft === null) return null

  const submit = async (): Promise<void> => {
    if (body.trim().length === 0) return
    await useCommentsStore.getState().add(draft.target, body)
    onCancel()
  }

  return (
    <div className="cmt__draft">
      <div className="cmt__target">On: “{draft.preview}”</div>
      <textarea
        className="view__textarea"
        autoFocus
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
      />
      <div className="cmt__draft-actions">
        <button className="cmt__btn" onClick={onCancel}>
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

function CommentCard({ comment, onOpen }: { comment: Comment; onOpen: () => void }): JSX.Element {
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
    <div className="cmt__card">
      <button className="cmt__card-main" onClick={onOpen} disabled={comment.target.kind !== 'section'}>
        <div className="cmt__card-head">
          <AuthorBadge author={comment.author} />
          <span className="cmt__time">{relativeTime(comment.createdAt)}</span>
          {comment.detached && (
            <span className="cmt__detached" title="The original text was not found — this comment is detached">
              detached
            </span>
          )}
          {comment.resolved && <span className="chip chip--accent">resolved</span>}
        </div>
        <div className="cmt__target">{targetLabel(comment.target)}</div>
        <div className="cmt__body">{comment.body}</div>
      </button>

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
            className="view__textarea"
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
    </div>
  )
}

/**
 * Comments sidebar view: filter chips with counts, comment cards (reply,
 * resolve, delete-with-confirm), and a draft composer that appears after a
 * selection-based "comment" request from a section editor
 * (manuscript/SectionEditor.tsx via comments/anchorExtension.ts). Clicking a
 * card opens the combined manuscript tab, scrolls to its section, and flashes
 * the anchored range there.
 */
export function CommentsView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const comments = useCommentsStore((s) => s.comments)
  const loaded = useCommentsStore((s) => s.loaded)
  const error = useCommentsStore((s) => s.error)
  const filter = useCommentsStore((s) => s.filter)
  const draft = useCommentsStore((s) => s.draft)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const [authorName, setAuthorName] = useState(readLocalAuthorName)

  useEffect(() => {
    if (rootDir !== null) void useCommentsStore.getState().load(rootDir)
  }, [rootDir, saveBump])

  const rows = useMemo(() => (manuscript === null ? [] : flattenBody(manuscript.body)), [manuscript])

  const visible = useMemo(
    () => filteredComments(comments, filter, authorName),
    [comments, filter, authorName]
  )

  const counts = useMemo(
    () => ({
      all: comments.length,
      open: comments.filter((c) => !c.resolved).length,
      resolved: comments.filter((c) => c.resolved).length,
      mine: comments.filter((c) => c.author.kind === 'human' && c.author.name === authorName).length
    }),
    [comments, authorName]
  )

  const openAndFlash = (comment: Comment): void => {
    if (rootDir === null || comment.target.kind !== 'section') return
    const path = comment.target.path
    const index = rows.findIndex((row) => row.contentPath === path)
    openManuscriptTab(rootDir)
    if (index >= 0) useManuscriptDocStore.getState().requestScroll(index)
    useCommentsStore.getState().requestFlash(comment.id)
  }

  const changeAuthorName = (): void => {
    const next = window.prompt('Comment as', authorName)
    if (next === null) return
    const trimmed = next.trim()
    if (trimmed.length === 0) return
    setLocalAuthorName(trimmed)
    setAuthorName(trimmed)
  }

  if (rootDir === null) {
    return <p className="sidebar__empty">Open a project to see its comments.</p>
  }

  return (
    <div className="view cmt">
      {error !== null && <div className="view__error">{error}</div>}

      <div className="cmt__filters" role="group" aria-label="Filter comments">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            className="cmt__filter-btn"
            aria-pressed={filter === id}
            onClick={() => useCommentsStore.getState().setFilter(id)}
          >
            {label} <span className="cmt__filter-count">{counts[id]}</span>
          </button>
        ))}
      </div>

      <button className="cmt__author-row" onClick={changeAuthorName} title="Change your comment author name">
        Commenting as <strong>{authorName}</strong>
      </button>

      <DraftComposer onCancel={() => useCommentsStore.getState().cancelDraft()} />

      <div className="cmt__list">
        {loaded && draft === null && visible.length === 0 && (
          <p className="view__hint">
            {comments.length === 0
              ? 'No comments yet. Select text in a section and press ⌘⇧M (Ctrl⇧M).'
              : 'No comments match this filter.'}
          </p>
        )}
        {visible.map((comment) => (
          <CommentCard key={comment.id} comment={comment} onOpen={() => openAndFlash(comment)} />
        ))}
      </div>
    </div>
  )
}
