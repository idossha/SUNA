import type { JSX } from 'react'
import { getDocSession, useDocSessionMeta } from '../state/docSessions'

/**
 * One-line strip shown by both editing surfaces when the file changed on disk
 * in a way the three-way merge could not settle by itself (state/docSessions'
 * checkDisk).
 *
 * It is deliberately rare now. A clean buffer takes external changes silently;
 * a dirty buffer merges them, so an agent editing a paragraph the human is not
 * in never surfaces here at all. Reaching this strip means both sides changed
 * the SAME paragraph — and even then the buffer already holds the human's
 * version, so nothing is at risk while they decide.
 */
export function DivergenceBanner({ path }: { path: string }): JSX.Element | null {
  const meta = useDocSessionMeta(path)
  if (meta === undefined || !meta.diverged) return null
  const fileName = path.split('/').pop() ?? path
  const n = meta.conflicts
  const where = n === 1 ? 'one paragraph' : `${n} paragraphs`
  return (
    <div className="editor-diverged" role="alert">
      <span className="editor-diverged__text">
        {fileName} changed on disk in {where} you were also editing. Yours is showing.
      </span>
      <button
        className="editor-diverged__btn"
        onClick={() => getDocSession(path)?.resolveDivergence('keepMine')}
      >
        Keep mine
      </button>
      <button
        className="editor-diverged__btn"
        onClick={() => getDocSession(path)?.resolveDivergence('takeTheirs')}
      >
        Use the file&rsquo;s version
      </button>
    </div>
  )
}
