import { useEffect, type JSX } from 'react'
import type { StepProps } from '../types'

interface Step4Props extends StepProps {
  /** Where 'env:detect' runs — the chosen parent folder in 'create' mode, the target folder itself in 'setup' mode. */
  scanDir: string | null
}

/** Step 4 — Python environment (feature-plan-5 §5). Nothing runs until Create project. */
export function Step3Python({ state, update, scanDir }: Step4Props): JSX.Element {
  useEffect(() => {
    if (state.envsScanned || scanDir === null) return
    update({ envsScanned: true })
    void window.suna
      .invoke('env:detect', { dir: scanDir })
      .then((res) => update({ detectedEnvs: res.envs }))
      .catch(() => update({ detectedEnvs: [] }))
    void window.suna
      .invoke('env:uv-available', {})
      .then((res) => update({ uvAvailable: res.available }))
      .catch(() => update({ uvAvailable: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanDir, state.envsScanned])

  return (
    <div className="onboard__step-page">
      <h2 className="onboard__step-title">Python environment</h2>
      <p className="onboard__step-sub">
        For running figure-generating scripts and analysis code from the project&apos;s terminal.
        Detected near {scanDir ?? 'the project'}.
      </p>

      <label className="onboard__choice">
        <input
          type="radio"
          name="onboard-python"
          checked={state.pythonChoice === 'skip'}
          onChange={() => update({ pythonChoice: 'skip' })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">Skip</div>
          <div className="onboard__choice-hint">Set one up later from the terminal panel.</div>
        </div>
      </label>

      <label className="onboard__choice" style={{ opacity: state.detectedEnvs.length === 0 ? 0.5 : 1 }}>
        <input
          type="radio"
          name="onboard-python"
          disabled={state.detectedEnvs.length === 0}
          checked={state.pythonChoice === 'existing'}
          onChange={() => update({ pythonChoice: 'existing' })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">Use an existing environment</div>
          <div className="onboard__choice-hint">
            {state.detectedEnvs.length === 0
              ? 'No uv/venv/conda environments detected there.'
              : `${state.detectedEnvs.length} found nearby.`}
          </div>
        </div>
      </label>

      {state.pythonChoice === 'existing' && state.detectedEnvs.length > 0 && (
        <div className="onboard__sublist">
          {state.detectedEnvs.map((env) => (
            <label className="onboard__choice" key={env.path} style={{ padding: '6px 0' }}>
              <input
                type="radio"
                name="onboard-python-existing"
                checked={state.existingEnvPath === env.path}
                onChange={() => update({ existingEnvPath: env.path })}
              />
              <div className="onboard__choice-body">
                <div className="onboard__choice-title">
                  {env.name} <span style={{ color: 'var(--s-ink-faint)' }}>({env.kind})</span>
                </div>
                <div className="onboard__choice-hint">{env.path}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      <label className="onboard__choice" style={{ opacity: state.uvAvailable === false ? 0.5 : 1 }}>
        <input
          type="radio"
          name="onboard-python"
          disabled={state.uvAvailable === false}
          checked={state.pythonChoice === 'create-uv'}
          onChange={() => update({ pythonChoice: 'create-uv' })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">Create with uv</div>
          <div className="onboard__choice-hint">
            {state.uvAvailable === null && 'Checking for uv…'}
            {state.uvAvailable === true && 'Runs "uv venv" in the new project once it is created.'}
            {state.uvAvailable === false &&
              'uv was not found on PATH — install it first, or choose Skip.'}
          </div>
        </div>
      </label>
    </div>
  )
}
