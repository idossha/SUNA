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
        <h1 className="welcome__title">Human-AI driven science</h1>
        <p className="welcome__byline">
          write · design · share · reproduce · collaborate
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
          SUNA is a workspace for the whole paper — writing, figures,
          references and data in one place, with an AI collaborator that works
          alongside you rather than behind you. Everything stays yours: open,
          readable files you can version, share and reproduce.
        </p>
      </div>
    </div>
  )
}
