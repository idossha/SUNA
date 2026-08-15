import type { JSX } from 'react'
import { getBundledProfile } from '@suna/formatter'
import {
  buildScaffoldSettings,
  CREATE_SUBSTEPS,
  type CreateSubstep,
  type StepProps
} from '../types'
import { buildProjectManifest } from '../manifest'
import { projectTreeLines } from '../preview'

interface Step7Props extends StepProps {
  targetPath: string | null
}

const SUBSTEP_LABELS: Record<CreateSubstep, string> = {
  dirs: 'Creating directories',
  files: 'Writing manuscript files',
  git: 'Initializing git',
  env: 'Python environment',
  mcp: '.mcp.json'
}

function scaffoldSummary(state: StepProps['state']): string {
  if (state.scaffold === 'blank') return 'Blank — no demo prose.'
  if (state.scaffold === 'starter') return 'Starter — demo section, citation, and figure script.'
  const n = state.importFiles.length
  return `Import existing — ${n} file${n === 1 ? '' : 's'} from ${state.importDir ?? '?'}.`
}

function pythonSummary(state: StepProps['state']): string {
  if (state.pythonChoice === 'skip') return 'Skipped — set up later.'
  if (state.pythonChoice === 'create-uv') return 'Create a new environment with uv.'
  return state.existingEnvPath ?? 'Use an existing environment.'
}

function aiSummary(state: StepProps['state']): string {
  if (state.aiChoice === 'skip') return 'Skipped — set up later from Settings.'
  if (state.aiChoice === 'cli') {
    return `Agent CLI${state.aiCliCommand ? ` (${state.aiCliCommand})` : ''}.`
  }
  return `API key (${state.apiProvider ?? 'no provider chosen'}).`
}

/** Step 7 — Review (feature-plan-5 §5). Presentational only; the Create button lives in the footer. */
export function Step7Review({ state, targetPath }: Step7Props): JSX.Element {
  const activeProfileId = state.profileId ?? 'nature-astronomy'
  const profile = getBundledProfile(activeProfileId)
  // createdAt is necessarily a preview — the real write timestamps at Create
  // time — but it must still be a valid ISO datetime for the schema to accept
  // it (this is a snapshot for reading, not the value that gets written).
  const manifestPreview =
    targetPath !== null
      ? buildProjectManifest({
          name: state.name || (targetPath.split('/').pop() ?? 'project'),
          activeProfileId,
          settings: buildScaffoldSettings(state)
        })
      : null

  return (
    <div className="onboard__step-page" style={{ maxWidth: 880 }}>
      <h2 className="onboard__step-title">Review</h2>
      <p className="onboard__step-sub">
        Nothing has been written yet. Create project runs these steps in order.
      </p>

      <div className="onboard__review-summary" style={{ marginBottom: 20 }}>
        <div>
          <span>Location</span> {targetPath ?? '—'}
        </div>
        <div>
          <span>Journal</span> {profile?.journalName ?? activeProfileId}
          {state.decideLater && ' (decide later — starts with Nature Astronomy)'}
        </div>
        <div>
          <span>Scaffold</span> {scaffoldSummary(state)}
        </div>
        <div>
          <span>Python</span> {pythonSummary(state)}
        </div>
        <div>
          <span>AI</span> {aiSummary(state)}
          {state.writeMcpConfig && ' + .mcp.json'}
        </div>
        <div>
          <span>Defaults</span>{' '}
          {state.saveDefaultsToProject ? 'Saved to this project' : 'Saved to global settings'}
        </div>
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
          {CREATE_SUBSTEPS.map((key) => (
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
