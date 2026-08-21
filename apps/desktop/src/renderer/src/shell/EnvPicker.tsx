import { useEffect, useRef, useState, type JSX } from 'react'
import { envLabelFor, useEnvsStore } from '../state/envs'
import './envpicker.css'

/**
 * The python environment chip, in the title bar's right column. One
 * selection serves every place SUNA starts an interpreter: new terminals
 * (main/services/terminal.ts puts its bin/ first on PATH), the editor's run
 * button, and notebook kernels. Changing it never touches a RUNNING process —
 * shells and kernels keep the env they started under, which is why the
 * popover says so rather than pretending the switch is retroactive.
 */
export function EnvPicker({ rootDir }: { rootDir: string }): JSX.Element {
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
    <div className="envpicker" ref={wrapRef}>
      <button
        className={hasEnv ? 'envpicker__chip' : 'envpicker__chip envpicker__chip--none'}
        title="Python environment for terminals, runs and notebook kernels"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className={hasEnv ? 'envpicker__dot' : 'envpicker__dot envpicker__dot--none'} />
        {label}
      </button>
      {open && (
        <div className="envpicker__popover" role="menu" aria-label="Python environments">
          <div className="envpicker__popover-title">Python environment</div>
          {detecting && <div className="envpicker__popover-hint">Scanning project…</div>}
          {!detecting && error !== null && <div className="envpicker__popover-hint">{error}</div>}
          {!detecting &&
            envs.map((env) => (
              <button
                key={env.path}
                className="envpicker__popover-item"
                role="menuitem"
                aria-pressed={env.path === selectedPath}
                title={env.path}
                onClick={() => choose(env.path)}
              >
                <span className="envpicker__popover-kind">{env.kind}</span>
                <span className="envpicker__popover-name">{env.name}</span>
              </button>
            ))}
          {!detecting && envs.length === 0 && error === null && (
            <div className="envpicker__popover-hint">
              No environments found (uv, .venv, conda).
            </div>
          )}
          <button
            className="envpicker__popover-item"
            role="menuitem"
            aria-pressed={selectedPath === null}
            onClick={() => choose(null)}
          >
            <span className="envpicker__popover-kind">—</span>
            <span className="envpicker__popover-name">none</span>
          </button>
          <div className="envpicker__popover-hint">
            Applies to terminals, runs and kernels started from now on.
          </div>
        </div>
      )}
    </div>
  )
}
