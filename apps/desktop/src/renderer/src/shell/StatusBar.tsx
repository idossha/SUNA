import { useEffect, useRef, useState, type JSX } from 'react'
import { getBundledProfile } from '@suna/formatter'
import { useUiStore } from '../state/ui'
import { useProjectStore } from '../state/project'
import { envLabelFor, useEnvsStore } from '../state/envs'
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
        d="M8 5.25A2.75 2.75 0 1 0 8 10.75 2.75 2.75 0 0 0 8 5.25Zm0-3.75.9 1.9 2.05-.55.55 2.05 1.9.9-1.35 1.6 1.35 1.6-1.9.9-.55 2.05-2.05-.55-.9 1.9-.9-1.9-2.05.55-.55-2.05-1.9-.9L3.95 8 2.6 6.4l1.9-.9.55-2.05 2.05.55.9-1.9Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function EnvChip({ rootDir }: { rootDir: string }): JSX.Element {
  const selectedPath = useEnvsStore((s) => s.selectedPath)
  const envs = useEnvsStore((s) => s.envs)
  const detecting = useEnvsStore((s) => s.detecting)
  const error = useEnvsStore((s) => s.error)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (wrapRef.current && !wrapRef.current.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const label = envLabelFor(selectedPath, envs)
  const hasEnv = selectedPath !== null

  const toggleOpen = (): void => {
    setOpen((wasOpen) => {
      if (!wasOpen) void useEnvsStore.getState().detect(rootDir)
      return !wasOpen
    })
  }

  const choose = (envPath: string | null): void => {
    void useEnvsStore.getState().select(rootDir, envPath)
    setOpen(false)
  }

  return (
    <div className="statusbar__env" ref={wrapRef}>
      <button
        className={hasEnv ? 'statusbar__env-chip' : 'statusbar__env-chip statusbar__env-chip--none'}
        title="Python environment for new terminals"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span
          className={hasEnv ? 'statusbar__env-dot' : 'statusbar__env-dot statusbar__env-dot--none'}
        />
        {label}
      </button>
      {open && (
        <div className="statusbar__popover" role="menu" aria-label="Python environments">
          <div className="statusbar__popover-title">Python environment</div>
          {detecting && <div className="statusbar__popover-hint">Scanning project…</div>}
          {!detecting && error !== null && (
            <div className="statusbar__popover-hint">{error}</div>
          )}
          {!detecting &&
            envs.map((env) => (
              <button
                key={env.path}
                className="statusbar__popover-item"
                role="menuitem"
                aria-pressed={env.path === selectedPath}
                title={env.path}
                onClick={() => choose(env.path)}
              >
                <span className="statusbar__popover-kind">{env.kind}</span>
                <span className="statusbar__popover-name">{env.name}</span>
              </button>
            ))}
          {!detecting && envs.length === 0 && error === null && (
            <div className="statusbar__popover-hint">
              No environments found (uv, .venv, conda).
            </div>
          )}
          <button
            className="statusbar__popover-item"
            role="menuitem"
            aria-pressed={selectedPath === null}
            onClick={() => choose(null)}
          >
            <span className="statusbar__popover-kind">—</span>
            <span className="statusbar__popover-name">none</span>
          </button>
          <div className="statusbar__popover-hint">Applies to newly opened terminals.</div>
        </div>
      )}
    </div>
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
        {rootDir !== null && <EnvChip rootDir={rootDir} />}
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
          aria-pressed={termOpen}
          title="Toggle terminal (⌃`)"
          onClick={toggleTerm}
        >
          <TerminalIcon />
          Terminal
        </button>
        <button className="statusbar__btn" title="Settings" onClick={openSettingsTab}>
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
