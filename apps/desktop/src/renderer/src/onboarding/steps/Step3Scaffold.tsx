import { useRef, type JSX } from 'react'
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
    hint: 'A one-section manuscript with demo prose, a citation, and a figure script, so you can see how everything fits together.'
  },
  {
    id: 'import',
    title: 'Import existing',
    hint: 'Point at a folder of .md/.tex/.bib files and copy them into the new project.'
  }
]

/** Step 3 — What to scaffold (feature-plan-5 §5). */
export function Step3Scaffold({ state, update }: StepProps): JSX.Element {
  const requestId = useRef(0)

  const pickImportDir = async (): Promise<void> => {
    try {
      const { path } = await window.suna.invoke('dialog:pick-directory', {
        title: 'Choose a folder of .md/.tex/.bib files to import',
        allowCreate: false
      })
      if (path === null) return
      update({ importDir: path, importFiles: [], importScanning: true, createError: null })
      const myId = ++requestId.current
      const { files } = await window.suna.invoke('project:list-importable', { dir: path })
      if (requestId.current !== myId) return
      update({ importFiles: files, importScanning: false })
    } catch (error) {
      update({ importScanning: false, createError: errorMessage(error) })
    }
  }

  return (
    <div className="onboard__step-page">
      <h2 className="onboard__step-title">What to scaffold</h2>
      <p className="onboard__step-sub">
        How the manuscript directory starts out. Nothing is copied or written until Create project.
      </p>

      {SCAFFOLD_OPTIONS.map((option) => (
        <label className="onboard__choice" key={option.id}>
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
      ))}

      {state.scaffold === 'import' && (
        <div className="onboard__sublist">
          <div className="onboard__row">
            <button className="btn" onClick={() => void pickImportDir()}>
              Choose folder…
            </button>
            <span className="onboard__field-hint">
              {state.importDir ?? 'No folder chosen yet.'}
            </span>
          </div>
          {state.importScanning && <div className="onboard__field-hint">Scanning…</div>}
          {!state.importScanning && state.importDir !== null && (
            <>
              {state.importFiles.length === 0 ? (
                <div className="onboard__field-hint">
                  No .md/.tex/.bib files found in that folder.
                </div>
              ) : (
                <div className="onboard__filelist">
                  {state.importFiles.map((file) => (
                    <div className="onboard__filelist-row" key={file.path}>
                      <span className="onboard__filelist-ext">{file.ext}</span>
                      <span>{file.path}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
