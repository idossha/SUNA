import type { JSX } from 'react'

export function TitleBar(): JSX.Element {
  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__wordmark">SUNA</span>
        <span className="titlebar__project">no project open</span>
      </div>
    </header>
  )
}
