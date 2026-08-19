import { useCallback, useEffect, useState, type JSX } from 'react'
import type { EditorView } from '@codemirror/view'
import { useResolved } from '../state/settings'
import { useRevision } from '../state/revisions'
import { onDiffChanged, revisionHunks } from './revisionDiff'
import { acceptAll, gotoHunk, rejectAll } from './revisionReview'

/**
 * The strip that says the AI has changed something and lets the author deal
 * with it (feature-plan-11 §11f).
 *
 * It shows only when there is an open baseline AND `review.aiDiffs` resolves
 * to 'inline' — turning the setting off hides the paint, and hiding the paint
 * without hiding this bar would leave an Accept-all button for changes the
 * author can no longer see.
 *
 * The count is live: it recounts on every document change and whenever the
 * baseline moves, so accepting one hunk visibly leaves the rest.
 */
export function ReviewBar({
  sectionPath,
  getView
}: {
  sectionPath: string | null
  getView: () => EditorView | null
}): JSX.Element | null {
  const revision = useRevision(sectionPath)
  const mode = useResolved('review.aiDiffs').value
  const [count, setCount] = useState(0)

  const recount = useCallback(() => {
    const view = getView()
    setCount(view === null ? 0 : revisionHunks(view).length)
  }, [getView])

  useEffect(() => {
    recount()
    return onDiffChanged(recount)
  }, [recount, revision?.base])

  if (revision === null || sectionPath === null || mode !== 'inline') return null
  // A run that changed nothing leaves a baseline equal to the file; there is
  // nothing to review, so say nothing.
  if (count === 0) return null

  const view = getView()
  const label = revision.author.label
  return (
    <div className="editor-review" role="status">
      <span className="editor-review__dot" aria-hidden="true" />
      <span className="editor-review__text">
        {count === 1 ? '1 AI change' : `${count} AI changes`}
        {label === '' ? '' : ` · ${label}`}
      </span>
      <button
        className="editor-review__btn"
        title="Jump to the next change (Alt-])"
        onClick={() => {
          const v = getView()
          if (v !== null) {
            gotoHunk(v, 1)
            v.focus()
          }
        }}
      >
        Next
      </button>
      <button
        className="editor-review__btn"
        title="Keep every AI change (the prose is already this)"
        disabled={view === null}
        onClick={() => {
          const v = getView()
          if (v !== null) void acceptAll(v, sectionPath)
        }}
      >
        Accept all
      </button>
      <button
        className="editor-review__btn editor-review__btn--reject"
        title="Put the manuscript back the way it was before this run"
        disabled={view === null}
        onClick={() => {
          const v = getView()
          if (v !== null) void rejectAll(v, sectionPath)
        }}
      >
        Reject all
      </button>
    </div>
  )
}
