import type { JSX } from 'react'

/* ---------------------------------------------------------------------------
   Where your work currently is.

   git's four resting places have four different names and no shared picture,
   which is most of why version control feels opaque to people who did not
   grow up with it. This draws them as one left-to-right trail — edited,
   staged, committed, on the remote — with a count on each, so "what is
   actually saved where" is answered by looking rather than by remembering.
   --------------------------------------------------------------------------- */

export type StageTone = 'working' | 'staged' | 'local' | 'remote'

export interface TrailStage {
  tone: StageTone
  count: number
  label: string
  /** Shown in the tooltip; says what this place actually is. */
  hint: string
  /** Rendered instead of the count when the stage is the resting state. */
  doneLabel?: string
  /**
   * Only the final stage sets this. True means "everything is on the remote"
   * and earns the tick; false means there is no remote at all, which is the
   * opposite of safe and must never be drawn as a success.
   */
  ok?: boolean
}

/**
 * The stage the user's attention belongs on: the leftmost one with anything
 * in it. Everything to its left is empty; everything to its right is waiting
 * on it. Returns null when the whole trail is clear.
 */
export function activeStage(stages: TrailStage[]): StageTone | null {
  for (const stage of stages) {
    if (stage.count > 0) return stage.tone
  }
  return null
}

/**
 * Build the trail from the numbers the panel already has.
 *
 * `behind` is deliberately NOT a trail stage — it is not a place your work
 * passes through, it is other people's work waiting to come the other way.
 * It gets its own marker at the end instead.
 */
export function buildTrail(counts: {
  unstaged: number
  staged: number
  ahead: number
  hasRemote: boolean
}): TrailStage[] {
  return [
    {
      tone: 'working',
      count: counts.unstaged,
      label: counts.unstaged === 1 ? 'edited file' : 'edited files',
      hint: 'Changed on disk and not yet staged. Nothing here is recorded anywhere.',
      doneLabel: 'No edits'
    },
    {
      tone: 'staged',
      count: counts.staged,
      label: counts.staged === 1 ? 'staged file' : 'staged files',
      hint: 'Picked out for the next commit. Still not recorded — commit to keep them.',
      doneLabel: 'Nothing staged'
    },
    {
      tone: 'local',
      count: counts.ahead,
      label: counts.ahead === 1 ? 'commit to push' : 'commits to push',
      hint: 'Recorded in this repository, on this machine only. Push to put them on the remote.',
      doneLabel: 'Nothing to push'
    },
    {
      tone: 'remote',
      count: 0,
      ok: counts.hasRemote,
      label: counts.hasRemote ? 'on the remote' : 'no remote',
      hint: counts.hasRemote
        ? 'Everything up to this point is on the server and safe if this machine is lost.'
        : 'This project has no remote, so nothing is backed up off this machine. Add one below.',
      doneLabel: counts.hasRemote ? 'Backed up' : 'Not backed up'
    }
  ]
}

function Chevron(): JSX.Element {
  return (
    <svg className="trail__arrow" viewBox="0 0 8 16" aria-hidden="true">
      <path d="M2 3l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The trail itself. Each stage is a button so the panel can scroll to (or
 * open) the section it names — the count is a claim, and a claim you can
 * click through to check is worth more than one you cannot.
 */
export function SyncTrail({
  stages,
  behind,
  onSelect
}: {
  stages: TrailStage[]
  behind: number
  onSelect?: (tone: StageTone) => void
}): JSX.Element {
  const active = activeStage(stages)
  return (
    <div className="trail" role="group" aria-label="Where your work is">
      {stages.map((stage, index) => (
        <div className="trail__cell" key={stage.tone}>
          {index > 0 && <Chevron />}
          <button
            type="button"
            className={[
              'trail__stage',
              `trail__stage--${stage.tone}`,
              stage.count > 0 ? 'trail__stage--filled' : 'trail__stage--empty',
              stage.ok === false ? 'trail__stage--unsafe' : '',
              active === stage.tone ? 'trail__stage--active' : ''
            ]
              .filter((name) => name !== '')
              .join(' ')}
            title={stage.hint}
            onClick={() => onSelect?.(stage.tone)}
          >
            <span className="trail__count">
              {stage.count > 0 ? stage.count : stage.ok === true ? '✓' : stage.ok === false ? '!' : '—'}
            </span>
            <span className="trail__label">
              {stage.count > 0 ? stage.label : (stage.doneLabel ?? stage.label)}
            </span>
          </button>
        </div>
      ))}
      {behind > 0 && (
        <div className="trail__behind" title="Commits on the remote that you do not have yet. Pull to bring them down.">
          ↓ {behind} incoming
        </div>
      )}
    </div>
  )
}
