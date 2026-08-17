import type { JSX } from 'react'
import { useCommentsStore } from '../state/comments'
import { useUiStore } from '../state/ui'
import './comments.css'

/**
 * Toolbar toggle for the comments rail, shared by both editing surfaces.
 * Carries the open-comment count as a badge (`|| null` semantics: zero
 * renders no badge at all).
 */
export function RailToggleButton(): JSX.Element {
  const visible = useUiStore((s) => s.commentsRailVisible)
  const openCount = useCommentsStore(
    (s) => s.comments.filter((c) => !c.resolved).length
  )
  return (
    <button
      className={`cmt-rail-toggle${visible ? ' cmt-rail-toggle--on' : ''}`}
      onClick={() => useUiStore.getState().toggleCommentsRail()}
      title="Toggle comments (⌘⌥M)"
      aria-label="Toggle comments"
      aria-pressed={visible}
    >
      💬
      {openCount > 0 && <span className="cmt-rail-toggle__badge">{openCount}</span>}
    </button>
  )
}
