import { useEffect, type JSX } from 'react'
import type { StepProps } from '../types'

interface Step4Props extends StepProps {
  /** Where 'env:detect' runs — the chosen parent folder in 'create' mode, the target folder itself in 'setup' mode. */
  scanDir: string | null
}

/** Step 4 — Python environment (DECISIONS 2026-08-15). Nothing runs until Create project. */
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
          // Default the kernel install OFF here: this environment is the
          // user's and may be shared with other projects, so installing into
          // it is a side effect on something SUNA did not create (D9).
          onChange={() => update({ pythonChoice: 'existing', installKernel: false })}
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
          // SUNA creates this env, so provisioning it is not a surprise.
          onChange={() => update({ pythonChoice: 'create-uv', installKernel: true })}
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

      <KernelOffer state={state} update={update} />
    </div>
  )
}

/**
 * The notebook runtime, offered rather than assumed (ROADMAP item 5, §20.6).
 *
 * Without `ipykernel` in the selected environment the first notebook cell a
 * new user runs fails with `no-jupyter-client` and a remedy they have to go
 * and type themselves — which is a poor thing to discover at the moment you
 * wanted to run a cell. So the wizard offers to do it, and, per D5, does
 * nothing until Create project is pressed.
 *
 * It is a checkbox and not an automatic step because the three branches are
 * not equivalent, and the copy says which one you are on:
 *
 *  - "Create with uv" — SUNA's own fresh env; checked by default.
 *  - an existing environment — the USER's env, possibly shared with other
 *    projects; unchecked by default, and it names the path being written to.
 *  - "Skip" — there is no environment, so there is nothing to install into
 *    and the offer is not shown at all. Saying so beats an inert checkbox.
 */
function KernelOffer({ state, update }: Pick<StepProps, 'state' | 'update'>): JSX.Element {
  if (state.pythonChoice === 'skip') {
    return (
      <p className="onboard__step-sub">
        Notebooks need <code>ipykernel</code> in an environment. With no environment there is
        nothing to install it into — pick one here, or install it yourself later with{' '}
        <code>pip install ipykernel</code>.
      </p>
    )
  }

  const target =
    state.pythonChoice === 'create-uv'
      ? 'the new .venv'
      : (state.existingEnvPath ?? 'the selected environment')

  return (
    <label className="onboard__choice">
      <input
        type="checkbox"
        checked={state.installKernel}
        onChange={(event) => update({ installKernel: event.target.checked })}
      />
      <div className="onboard__choice-body">
        <div className="onboard__choice-title">Install the notebook runtime (ipykernel)</div>
        <div className="onboard__choice-hint">
          {state.pythonChoice === 'create-uv'
            ? 'Into the environment SUNA is about to create, so notebook cells run straight away. Needs a network; if it fails, creation still finishes and SUNA tells you the command to run.'
            : `Writes into ${target} — an environment SUNA did not create, and one other projects may share. Off unless you ask for it.`}
        </div>
      </div>
    </label>
  )
}
