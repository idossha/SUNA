import type { JSX } from 'react'
import { getDocSession, useDocSessionMeta } from '../state/docSessions'

/**
 * One-line strip shown by both editing surfaces when the file changed on
 * disk while the shared buffer holds unsaved edits (state/docSessions'
 * divergence state). Clean buffers never see this — external changes apply
 * silently as a mapped minimal diff.
 */
export function DivergenceBanner({ path }: { path: string }): JSX.Element | null {
  const meta = useDocSessionMeta(path)
  if (meta === undefined || !meta.diverged) return null
  const fileName = path.split('/').pop() ?? path
  return (
    <div className="editor-diverged" role="alert">
      <span className="editor-diverged__text">
        {fileName} changed on disk while you have unsaved edits.
      </span>
      <button
        className="editor-diverged__btn"
        onClick={() => getDocSession(path)?.resolveDivergence('reloadDisk')}
      >
        Reload from disk
      </button>
      <button
        className="editor-diverged__btn"
        onClick={() => getDocSession(path)?.resolveDivergence('keepMine')}
      >
        Keep my version
      </button>
    </div>
  )
}
