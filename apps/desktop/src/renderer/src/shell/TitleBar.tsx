import type { JSX } from 'react'
import { useProjectStore } from '../state/project'

export function TitleBar(): JSX.Element {
  const manifest = useProjectStore((s) => s.manifest)

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__wordmark">SUNA</span>
        <span className="titlebar__project">
          {manifest ? manifest.name : 'no project open'}
        </span>
      </div>
    </header>
  )
}
