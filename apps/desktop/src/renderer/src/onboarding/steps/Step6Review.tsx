import type { JSX } from 'react'
import {
  CREATE_SUBSTEPS,
  type CreateSubstep,
  type StepProps
} from '../types'
import { HOUSE_PROFILE_ID } from '../../state/renderProfile'
import { buildProjectManifest } from '../manifest'
import { projectTreeLines } from '../preview'
import { GitHubPublish } from './GitHubPublish'

interface Step6Props extends StepProps {
  targetPath: string | null
}

const SUBSTEP_LABELS: Record<CreateSubstep, string> = {
  dirs: 'Creating directories',
  files: 'Writing manuscript files',
  git: 'Initializing git',
  publish: 'Publishing to GitHub',
  env: 'Python environment',
  mcp: 'Agent wiring'
}

function scaffoldSummary(state: StepProps['state']): string {
  if (state.scaffold === 'blank') return 'Blank — no demo prose.'
  if (state.scaffold === 'starter') return 'Starter — demo section, citation, and figure script.'
  return `From an existing manuscript — ${state.documentPath ?? 'no file chosen'}.`
}

function pythonSummary(state: StepProps['state']): string {
  if (state.pythonChoice === 'skip') return 'Skipped — set up later.'
  // The kernel install is a write into an environment, so it belongs on the
  // page where the user confirms what Create will do (D5) — most of all on
  // the existing-environment branch, where the env is theirs.
  const kernel = state.installKernel ? ' Plus ipykernel, so notebooks run.' : ''
  if (state.pythonChoice === 'create-uv') return `Create a new environment with uv.${kernel}`
  return `${state.existingEnvPath ?? 'Use an existing environment.'}${kernel}`
}

function aiSummary(state: StepProps['state']): string {
  if (state.aiChoice === 'skip') return 'Skipped — set up later from Settings.'
  if (state.aiChoice === 'cli') {
    return `Agent CLI${state.aiCliCommand ? ` (${state.aiCliCommand})` : ''}.`
  }
  return `API key (${state.apiProvider ?? 'no provider chosen'}).`
}

/** Step 6 — Review (DECISIONS 2026-08-15). Presentational only; the Create button lives in the footer. */
export function Step6Review({ state, update, targetPath }: Step6Props): JSX.Element {
  // createdAt is necessarily a preview — the real write timestamps at Create
  // time — but it must still be a valid ISO datetime for the schema to accept
  // it (this is a snapshot for reading, not the value that gets written).
  const manifestPreview =
    targetPath !== null
      ? buildProjectManifest({
          name: state.name || (targetPath.split('/').pop() ?? 'project'),
          activeProfileId: HOUSE_PROFILE_ID,
          scaffold: state.scaffold
        })
      : null

  return (
    <div className="onboard__step-page" style={{ maxWidth: 1040 }}>
      <h2 className="onboard__step-title">Review</h2>
      <p className="onboard__step-sub">
        Nothing has been written yet. Create project runs these steps in order.
      </p>

      {/* Summary left, version control right: the summary's last line is the
          VCS choice, so the panel that changes it reads best beside it. */}
      <div className="onboard__review-top">
        <div className="onboard__review-summary">
          <div>
            <span>Location</span> {targetPath ?? '—'}
          </div>
          <div>
            <span>Scaffold</span> {scaffoldSummary(state)}
          </div>
          <div>
            <span>Python</span> {pythonSummary(state)}
          </div>
          <div>
            <span>AI</span> {aiSummary(state)}
          </div>
          <div>
            <span>Defaults</span> Saved to this project
          </div>
          <div>
            <span>Version control</span>{' '}
            {state.publishToGitHub
              ? `git, published to GitHub as ${state.githubRepoName} (${state.githubVisibility})`
              : 'git repository on this machine'}
          </div>
        </div>

        <GitHubPublish state={state} update={update} />
      </div>

      <div className="onboard__review-grid">
        <div className="onboard__review-section">
          <div className="onboard__review-label">Directory tree</div>
          <div className="onboard__tree">{projectTreeLines(state).join('\n')}</div>
        </div>
        <div className="onboard__review-section">
          <div className="onboard__review-label">suna.json</div>
          <pre className="onboard__review-json">
            {manifestPreview !== null ? JSON.stringify(manifestPreview, null, 2) : '—'}
          </pre>
        </div>
      </div>

      {(state.progress.dirs !== 'pending' || state.creating || state.createError !== null) && (
        <div className="onboard__progress">
          {CREATE_SUBSTEPS.filter((key) => key !== 'publish' || state.publishToGitHub).map((key) => (
            <div className={`onboard__progress-row onboard__progress-row--${state.progress[key]}`} key={key}>
              <span className="onboard__progress-dot" />
              {SUBSTEP_LABELS[key]}
            </div>
          ))}
        </div>
      )}

      {state.createWarnings.length > 0 && (
        <div className="onboard__warning">
          {state.createWarnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
    </div>
  )
}
