import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { EditorView } from '@codemirror/view'
import type { Comment } from '@suna/core'
import { useCommentsStore } from '../state/comments'
import { revealAnchorById } from './anchorExtension'
import { relativeTime } from './relativeTime'
import { OUTLINE_IDLE_MS, outlineEntries, outlineStartsCollapsed } from './outline'

export interface CommentsOutlineProps {
  comments: readonly Comment[]
  activeId: string | null
  getView: () => EditorView | null
}

/**
 * The chronological index at the head of the rail. Small type, one row per
 * open thread, click to jump. Long lists start collapsed and — because an
 * outline left open would keep eating the rail — re-collapse themselves after
 * OUTLINE_IDLE_MS of no interaction. Short lists stay open and never time
 * out: there is nothing to save there.
 */
export function CommentsOutline({ comments, activeId, getView }: CommentsOutlineProps): JSX.Element | null {
  const entries = useMemo(() => outlineEntries(comments), [comments])
  const collapsible = outlineStartsCollapsed(entries.length)
  const [open, setOpen] = useState(!collapsible)
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The list can grow past the threshold (or shrink back under it) while the
  // rail is mounted; follow the rule rather than the mount-time snapshot.
  useEffect(() => {
    setOpen(!collapsible)
  }, [collapsible])

  const clearIdle = (): void => {
    if (idleRef.current !== null) clearTimeout(idleRef.current)
    idleRef.current = null
  }
  const armIdle = (): void => {
    clearIdle()
    if (!collapsible) return
    idleRef.current = setTimeout(() => setOpen(false), OUTLINE_IDLE_MS)
  }

  // arm on every open, disarm on close/unmount — a pending timer that fires
  // after the user re-collapsed by hand would be a no-op, but one that
  // survives unmount leaks a setState into a dead component
  useEffect(() => {
    if (open && collapsible) armIdle()
    else clearIdle()
    return clearIdle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collapsible])

  if (entries.length === 0) return null

  const jump = (id: string): void => {
    useCommentsStore.getState().setActive(id)
    const view = getView()
    if (view !== null) revealAnchorById(view, id)
    // Deliberately NOT collapsing here. Collapsing on click pulls the row out
    // from under the pointer, so a second click on the same row lands on
    // whatever slid into that spot — the list has to stay put while it is
    // being used. The idle timer (restarted here) closes it soon enough.
    armIdle()
  }

  return (
    <div
      className="cmt-outline"
      // any interaction inside restarts the idle countdown, so reading a long
      // list never gets yanked shut mid-scan
      onPointerMove={armIdle}
      onPointerDown={armIdle}
      onKeyDown={armIdle}
      onScroll={armIdle}
    >
      <button
        className="cmt-outline__summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={collapsible ? 'Outline of open comments — collapses when idle' : 'Outline of open comments'}
      >
        <span className={`cmt-outline__caret${open ? ' cmt-outline__caret--open' : ''}`}>▸</span>
        Outline ({entries.length})
      </button>
      {open && (
        <ol className="cmt-outline__list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                className={`cmt-outline__row${entry.id === activeId ? ' cmt-outline__row--active' : ''}`}
                data-comment-id={entry.id}
                onClick={() => jump(entry.id)}
                title={`${entry.label} — ${relativeTime(entry.createdAt)}`}
              >
                <span className="cmt-outline__index">{entry.index}</span>
                <span className="cmt-outline__label">{entry.label}</span>
                {entry.replies > 0 && <span className="cmt-outline__replies">{entry.replies}</span>}
                {entry.detached && <span className="cmt-outline__detached">detached</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
