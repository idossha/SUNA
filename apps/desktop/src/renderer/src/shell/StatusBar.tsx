import type { JSX } from 'react'
import { getBundledProfile } from '@suna/formatter'
import { useUiStore } from '../state/ui'
import { useProjectStore } from '../state/project'

export function StatusBar(): JSX.Element {
  const statusNote = useUiStore((s) => s.statusNote)
  const manifest = useProjectStore((s) => s.manifest)
  const profile = manifest ? getBundledProfile(manifest.activeProfileId) : null

  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        <span>SUNA 0.1</span>
        {profile && <span className="statusbar__profile">{profile.journalName}</span>}
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
