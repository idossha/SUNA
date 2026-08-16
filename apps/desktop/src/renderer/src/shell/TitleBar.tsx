import { useRef, useState, type JSX } from 'react'
import { useProjectStore } from '../state/project'
import { ProjectMenu } from './ProjectMenu'
import { ChevronDownIcon } from './icons'

/**
 * Title bar (feature-plan-7 §3). The project name is a button opening
 * ProjectMenu.tsx: Recent projects, then Open project… / New project… /
 * Open example. Reads "Open project" with no chevron target changed — the
 * button itself always reflects the current project (or the fallback label
 * below) whether or not the menu is open.
 */
export function TitleBar(): JSX.Element {
  const manifest = useProjectStore((s) => s.manifest)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__wordmark">SUNA</span>
        <button
          ref={buttonRef}
          type="button"
          className="titlebar__project"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="titlebar__project-name">
            {manifest ? manifest.name : 'Open project'}
          </span>
          <ChevronDownIcon />
        </button>
      </div>
      {menuOpen && buttonRef.current && (
        <ProjectMenu anchorEl={buttonRef.current} onClose={() => setMenuOpen(false)} />
      )}
    </header>
  )
}
