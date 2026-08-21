import type { JSX } from 'react'
import type { ScaffoldKind, StepProps } from '../types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const SCAFFOLD_OPTIONS: { id: ScaffoldKind; title: string; hint: string }[] = [
  {
    id: 'blank',
    title: 'Blank',
    hint: 'Just the project directories and an empty manuscript — write everything yourself.'
  },
  {
    id: 'starter',
    title: 'Starter',
    hint: 'A short manuscript with demo prose, a citation and a figure, plus a cover letter and a demonstration review round — one of everything, so you can see how the whole paper fits together.'
  },
  {
    id: 'document',
    title: 'From an existing manuscript',
    hint: 'Start from a .docx, .pdf or .html paper — its title, authors, abstract, sections and references are read into the new project.'
  }
]

/** Step 3 — What to scaffold (feature-plan-5 §5). */
export function Step2Scaffold({ state, update }: StepProps): JSX.Element {
  const pickDocument = async (): Promise<void> => {
    try {
      const { path } = await window.suna.invoke('dialog:pick-file', {
        title: 'Choose a manuscript to start from',
        extensions: ['docx', 'pdf', 'html', 'htm']
      })
      if (path === null) return
      update({ documentPath: path, createError: null })
    } catch (error) {
      update({ createError: errorMessage(error) })
    }
  }

  const documentPanel = (): JSX.Element => (
    <div className="onboard__sublist">
      <div className="onboard__row">
        <button className="btn" onClick={() => void pickDocument()}>
          Choose file…
        </button>
        <span className="onboard__field-hint">
          {state.documentPath ?? 'No file chosen yet.'}
        </span>
      </div>
      <div className="onboard__field-hint">
        A .docx keeps its figures and formatting; a .pdf has no structure to read, so headings
        and paragraphs are inferred and worth reviewing. Nothing is read until Create project.
      </div>
    </div>
  )

  return (
    <div className="onboard__step-page">
      <h2 className="onboard__step-title">What to scaffold</h2>
      <p className="onboard__step-sub">
        How the manuscript directory starts out. Nothing is copied or written until Create project.
      </p>

      {SCAFFOLD_OPTIONS.map((option) => (
        <div key={option.id}>
          <label className="onboard__choice">
            <input
              type="radio"
              name="onboard-scaffold"
              checked={state.scaffold === option.id}
              onChange={() => update({ scaffold: option.id })}
            />
            <div className="onboard__choice-body">
              <div className="onboard__choice-title">{option.title}</div>
              <div className="onboard__choice-hint">{option.hint}</div>
            </div>
          </label>
          {/* Each option's own controls sit directly under it — a file picker
              two options below the radio it belongs to reads as the wrong
              option's. */}
          {state.scaffold === option.id && option.id === 'document' && documentPanel()}
        </div>
      ))}
    </div>
  )
}
