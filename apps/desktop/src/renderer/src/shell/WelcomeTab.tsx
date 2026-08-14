import type { JSX } from 'react'
import { useProjectStore } from '../state/project'

export function WelcomeTab(): JSX.Element {
  const createProject = useProjectStore((s) => s.createProject)
  const openProject = useProjectStore((s) => s.openProject)
  const openExampleProject = useProjectStore((s) => s.openExampleProject)

  return (
    <div className="welcome">
      <div className="welcome__page">
        <div className="welcome__eyebrow">SUNA</div>
        <h1 className="welcome__title">A workspace for the whole paper</h1>
        <p className="welcome__byline">
          manuscript · figures · references · data · versions
        </p>
        <div className="welcome__rule" />
        <div className="welcome__actions">
          <button className="btn btn--primary" onClick={() => void createProject()}>
            Create project
          </button>
          <button className="btn" onClick={() => void openProject()}>
            Open project…
          </button>
          <button className="btn" onClick={() => void openExampleProject()}>
            Open example
          </button>
        </div>
        <p className="welcome__hint">
          A project keeps sections in Markdown, references in BibTeX, figures as
          SVG with their generating code, and everything under git — publisher
          formatting is applied only on export.
        </p>
      </div>
    </div>
  )
}
