import type { JSX } from 'react'
import { useUiStore } from '../state/ui'

export function StatusBar(): JSX.Element {
  const statusNote = useUiStore((s) => s.statusNote)

  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        <span>SUNA 0.1</span>
        {statusNote && <span className="statusbar__note">{statusNote}</span>}
      </div>
      <div className="statusbar__group">
        <span>
          Electron {window.suna.versions.electron} · Chrome{' '}
          {window.suna.versions.chrome}
        </span>
      </div>
    </footer>
  )
}
