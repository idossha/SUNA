import { useEffect, useRef, type JSX } from 'react'
import { validateProjectName, validateTarget } from '../validation'
import type { StepProps } from '../types'

const CHECK_DEBOUNCE_MS = 250

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Step 1 — Where & what (DECISIONS 2026-08-15). Only shown in 'create' mode. */
export function Step1Location({ state, update }: StepProps): JSX.Element {
  const requestId = useRef(0)

  const nameCheck = validateProjectName(state.name)

  // Live filesystem check, debounced: re-run 'project:check-target' whenever
  // parentDir/name change and the name is at least syntactically valid.
  useEffect(() => {
    if (state.parentDir === null || !nameCheck.valid) {
      update({ targetExists: null, targetParentWritable: null, checkingTarget: false })
      return
    }
    const myId = ++requestId.current
    update({ checkingTarget: true })
    const timer = window.setTimeout(() => {
      void window.suna
        .invoke('project:check-target', { parentDir: state.parentDir as string, name: state.name })
        .then((res) => {
          if (requestId.current !== myId) return
          update({
            targetExists: res.exists,
            targetParentWritable: res.parentWritable,
            checkingTarget: false
          })
        })
        .catch(() => {
          if (requestId.current !== myId) return
          // Treat an unreadable/unwritable parent as "not writable" rather than stalling Next forever.
          update({ targetExists: null, targetParentWritable: false, checkingTarget: false })
        })
    }, CHECK_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.parentDir, state.name])

  const pickParent = async (): Promise<void> => {
    try {
      const { path } = await window.suna.invoke('dialog:pick-directory', {
        title: 'Choose a parent folder for the new project',
        allowCreate: true
      })
      if (path !== null) {
        // A new parent invalidates step 4's env scan (it ran against the old
        // one) — force it to re-run rather than showing stale results.
        update({
          parentDir: path,
          createError: null,
          envsScanned: false,
          detectedEnvs: [],
          uvAvailable: null,
          pythonChoice: 'skip',
          existingEnvPath: null
        })
      }
    } catch (error) {
      update({ createError: errorMessage(error) })
    }
  }

  const target = validateTarget(
    state.parentDir,
    state.name,
    state.targetExists === null || state.targetParentWritable === null
      ? null
      : { exists: state.targetExists, parentWritable: state.targetParentWritable }
  )
  const resultPath = state.parentDir !== null ? `${state.parentDir}/${state.name || '…'}` : null

  return (
    <div className="onboard__step-page">
      <h2 className="onboard__step-title">Where &amp; what</h2>
      <p className="onboard__step-sub">
        Choose a parent folder and a name — SUNA creates a new folder for the project there.
        Nothing is written until the last step.
      </p>

      <div className="onboard__field">
        <label>Parent folder</label>
        <div className="onboard__row">
          <button className="btn" onClick={() => void pickParent()}>
            Choose folder…
          </button>
          <span className="onboard__field-hint">{state.parentDir ?? 'No folder chosen yet.'}</span>
        </div>
      </div>

      <div className="onboard__field">
        <label htmlFor="onboard-name">Project name</label>
        <input
          id="onboard-name"
          type="text"
          autoFocus
          spellCheck={false}
          placeholder="ram-pressure-paper"
          value={state.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        {!nameCheck.valid && state.name !== '' && (
          <div className="onboard__field-error">{nameCheck.reason}</div>
        )}
      </div>

      {resultPath !== null && (
        <>
          <div className="onboard__field-hint">This will create:</div>
          <div className="onboard__path">{resultPath}</div>
        </>
      )}

      {state.checkingTarget && (
        <div className="onboard__field-hint" style={{ marginTop: 8 }}>
          Checking…
        </div>
      )}
      {!state.checkingTarget && target.reason !== null && (
        <div className="onboard__field-error" style={{ marginTop: 8 }}>
          {target.reason}
        </div>
      )}
    </div>
  )
}
