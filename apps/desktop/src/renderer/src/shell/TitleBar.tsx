import { useRef, useState, type JSX } from 'react'
import { formatShortcut } from '../palette/shortcuts'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { ProjectMenu } from './ProjectMenu'
import { ChevronDownIcon, PanelLeftIcon } from './icons'
import { EnvPicker } from './EnvPicker'

const NAV_TOGGLE_TITLE = `Toggle left nav bar (${formatShortcut('Mod-Alt-KeyB')})`

/**
 * Title bar (DECISIONS 2026-08-15). The project name is a button opening
 * ProjectMenu.tsx: Recent projects, then Open project… / New project… /
 * Open example. Reads "Open project" with no chevron target changed — the
 * button itself always reflects the current project (or the fallback label
 * below) whether or not the menu is open.
 */
export function TitleBar(): JSX.Element {
  const manifest = useProjectStore((s) => s.manifest)
  const rootDir = useProjectStore((s) => s.rootDir)
  const railVisible = useUiStore((s) => s.railVisible)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="titlebar">
      {/* Never conditional: nav visibility persists, so the app can start
          with no left chrome at all and this is the way back. */}
      <button
        type="button"
        className="titlebar__nav-toggle"
        aria-pressed={railVisible}
        title={NAV_TOGGLE_TITLE}
        onClick={() => useUiStore.getState().toggleLeftNav()}
      >
        <PanelLeftIcon />
      </button>
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
      {/* Right column: the interpreter every terminal, run and kernel starts
          under. Top-right because it is a per-project MODE, not a status. */}
      <div className="titlebar__right">{rootDir !== null && <EnvPicker rootDir={rootDir} />}</div>
      {menuOpen && buttonRef.current && (
        <ProjectMenu anchorEl={buttonRef.current} onClose={() => setMenuOpen(false)} />
      )}
    </header>
  )
}
