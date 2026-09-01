import { useEffect, type JSX } from 'react'
import { getBundledProfile } from '@suna/formatter'
import { useUiStore } from '../state/ui'
import { useProjectStore } from '../state/project'
import { useEnvsStore } from '../state/envs'
import { useSettingsStore } from '../state/settings'
import { useTerminalPanelStore } from '../state/terminal'
import { useVimModeStore } from '../state/vimMode'
import { openSettingsTab } from '../state/dock'
import './statusbar.css'

function TerminalIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4.5 6l2.5 2-2.5 2M8.5 10.5h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.2h11M2.5 10.8h11"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <circle cx="6" cy="5.2" r="1.7" stroke="currentColor" strokeWidth="1.1" fill="var(--s-bg-raised)" />
      <circle
        cx="10.4"
        cy="10.8"
        r="1.7"
        stroke="currentColor"
        strokeWidth="1.1"
        fill="var(--s-bg-raised)"
      />
    </svg>
  )
}

export function StatusBar(): JSX.Element {
  const statusNote = useUiStore((s) => s.statusNote)
  const vimMode = useVimModeStore((s) => s.mode)
  const manifest = useProjectStore((s) => s.manifest)
  const rootDir = useProjectStore((s) => s.rootDir)
  const termOpen = useTerminalPanelStore((s) => s.open)
  const toggleTerm = useTerminalPanelStore((s) => s.toggle)
  const profile = manifest ? getBundledProfile(manifest.activeProfileId) : null

  // app-wide settings load once from the always-mounted status bar
  useEffect(() => {
    void useSettingsStore.getState().load()
  }, [])

  // the env selection follows the open project
  useEffect(() => {
    if (rootDir !== null) void useEnvsStore.getState().loadSelected(rootDir)
  }, [rootDir])

  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        <span>SUNA 0.1</span>
        {profile && <span className="statusbar__profile">{profile.journalName}</span>}
        {/* Nothing at all when no editor has vim installed — the only feedback
            that normal mode is swallowing plain typing, so it must be there
            the moment vim is. */}
        {vimMode !== null && (
          <span className="statusbar__vim" title="Vim mode">
            {vimMode}
          </span>
        )}
        {statusNote && <span className="statusbar__note">{statusNote}</span>}
      </div>
      <div className="statusbar__group">
        <button
          className="statusbar__btn"
          aria-label="Keyboard shortcuts"
          // '?' is the only chord-free door; inside a vim buffer it is vim's
          // search-backward, and :help is the way in (DECISIONS 2026-08-17).
          title="Keyboard shortcuts (?)"
          onClick={() => useUiStore.getState().setHelpOpen(true)}
        >
          ?
        </button>
        <button
          className="statusbar__btn"
          aria-pressed={termOpen}
          title="Toggle terminal (⌃`)"
          onClick={toggleTerm}
        >
          <TerminalIcon />
          Terminal
        </button>
        <button
          className="statusbar__btn"
          data-tour="settings"
          title="Settings"
          onClick={openSettingsTab}
        >
          <GearIcon />
          Settings
        </button>
        <span>
          Electron {window.suna.versions.electron} · Chrome{' '}
          {window.suna.versions.chrome}
        </span>
      </div>
    </footer>
  )
}
