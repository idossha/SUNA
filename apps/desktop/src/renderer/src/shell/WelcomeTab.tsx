import type { JSX } from 'react'
import { useProjectStore } from '../state/project'
import { openOnboardingTab } from '../state/dock'
import { startAppTour } from '../state/tour'
import { RecentProjects } from './RecentProjects'

export function WelcomeTab(): JSX.Element {
  const openProject = useProjectStore((s) => s.openProject)

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
          <button
            className="btn btn--primary"
            onClick={() => openOnboardingTab({ mode: 'create' })}
          >
            Create project
          </button>
          <button className="btn" onClick={() => void openProject()}>
            Open project…
          </button>
          {/* Opens the shipped example project and walks it — see
              tour/steps.ts. Third in the row because it is what you want on
              your first day and never again. */}
          <button className="btn welcome__tour" onClick={() => void startAppTour()}>
            Take the app tour
          </button>
        </div>
        <RecentProjects />
        <p className="welcome__hint">
          A project keeps sections in Markdown, references in BibTeX, figures as
          SVG with their generating code, and everything under git — publisher
          formatting is applied only on export. Have a manuscript already? New
          project can start from a .docx, .pdf or .html file.
        </p>
      </div>
    </div>
  )
}
