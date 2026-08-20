import type { JSX } from 'react'
import { useCommentsStore } from '../state/comments'
import { useUiStore } from '../state/ui'
import './comments.css'

/**
 * Toolbar toggle for the comments rail, shared by both editing surfaces.
 * Carries the open-comment count as a badge (`|| null` semantics: zero
 * renders no badge at all).
 *
 * The count is scoped to ONE document (feature-plan-12 gap 5b). Every
 * document kind writes into the one project-wide `manuscript/comments.json`,
 * so an unscoped count would show a manuscript tab the badge for a cover
 * letter's open comments. `docPath` is the manuscript-relative prose path the
 * surface is showing; passing null counts nothing, which is what a surface
 * with no comment target should show.
 */
export function RailToggleButton({
  docPath,
  includeWholeManuscript = false
}: {
  docPath: string | null
  /**
   * Whole-manuscript comments (`target.kind === 'manuscript'`) carry no path,
   * so only the surface showing the manuscript itself may count them. This
   * mirrors ManuscriptTab's own rail filter rather than inventing a second
   * rule for the badge.
   */
  includeWholeManuscript?: boolean
}): JSX.Element {
  const visible = useUiStore((s) => s.commentsRailVisible)
  const openCount = useCommentsStore((s) =>
    docPath === null
      ? 0
      : s.comments.filter(
          (c) =>
            !c.resolved &&
            ((c.target.kind === 'section' && c.target.path === docPath) ||
              (includeWholeManuscript && c.target.kind === 'manuscript'))
        ).length
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
