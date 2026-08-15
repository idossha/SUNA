import { useState, type JSX } from 'react'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { openOnboardingTab } from '../state/dock'
import { RecentProjects } from './RecentProjects'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function WelcomeTab(): JSX.Element {
  const openProject = useProjectStore((s) => s.openProject)
  const openExampleProject = useProjectStore((s) => s.openExampleProject)
  const [settingUp, setSettingUp] = useState(false)

  // "Set up project" (feature-plan-5 §5): pick an existing folder and, when it
  // is missing suna.json, launch the wizard against it (steps 2-7). A folder
  // that already IS a SUNA project is left to "Open project…" — this entry
  // point never opens a project on its own.
  const setUpProject = async (): Promise<void> => {
    setSettingUp(true)
    try {
      const { path } = await window.suna.invoke('dialog:pick-directory', {
        title: 'Choose a project folder to set up',
        allowCreate: false
      })
      if (path === null) return
      const { manifestPresent } = await window.suna.invoke('project:scaffold-status', { dir: path })
      if (manifestPresent) {
        useUiStore
          .getState()
          .setStatusNote(`${path} is already a SUNA project — use “Open project…” instead.`)
        return
      }
      openOnboardingTab({ mode: 'setup', dir: path })
    } catch (error) {
      useUiStore.getState().setStatusNote(`Could not set up that folder: ${errorMessage(error)}`)
    } finally {
      setSettingUp(false)
    }
  }

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
          <button className="btn" onClick={() => void openExampleProject()}>
            Open example
          </button>
          <button className="btn" disabled={settingUp} onClick={() => void setUpProject()}>
            Set up project…
          </button>
        </div>
        <RecentProjects />
        <p className="welcome__hint">
          A project keeps sections in Markdown, references in BibTeX, figures as
          SVG with their generating code, and everything under git — publisher
          formatting is applied only on export.
        </p>
      </div>
    </div>
  )
}
