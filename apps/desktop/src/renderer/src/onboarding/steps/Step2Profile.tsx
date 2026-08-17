import type { JSX } from 'react'
import { PICKER_PROFILE_IDS, getBundledProfile } from '@suna/formatter'
import type { CitationMode } from '@suna/core'
import type { StepProps } from '../types'

const CITATION_LABELS: Record<CitationMode, string> = {
  'numeric-superscript': 'Numeric superscript',
  'author-year': 'Author–year',
  'parenthetical-numeric': 'Parenthetical numeric'
}

function widthsLabel(widths: { single: number | null; onehalf: number | null; double: number | null }): string {
  const parts = [widths.single, widths.onehalf, widths.double].map((mm) =>
    mm === null ? '—' : `${mm}mm`
  )
  return `${parts[0]} / ${parts[1]} / ${parts[2]} (S/1.5/D)`
}

function abstractLimitLabel(profile: ReturnType<typeof getBundledProfile>): string {
  const limit = profile?.manuscript.articleTypes[0]?.abstractWordLimit ?? null
  return limit === null ? 'No abstract limit stated' : `${limit}-word abstract limit`
}

/** Step 2 — Target journal (feature-plan-5 §5): four bundled profiles as cards. */
export function Step2Profile({ state, update }: StepProps): JSX.Element {
  return (
    <div className="onboard__step-page">
      <h2 className="onboard__step-title">Target journal</h2>
      <p className="onboard__step-sub">
        Sets the citation style, figure widths, and manuscript limits SUNA checks against. You can
        change this later in the project&apos;s formatting settings.
      </p>

      <div className="onboard__cards">
        {PICKER_PROFILE_IDS.map((id) => {
          const profile = getBundledProfile(id)
          if (profile === null) return null
          const selected = state.profileId === id && !state.decideLater
          return (
            <button
              key={id}
              className={`onboard__card${selected ? ' onboard__card--selected' : ''}`}
              onClick={() => update({ profileId: id, decideLater: false })}
              aria-pressed={selected}
            >
              <div className="onboard__card-title">{profile.journalName}</div>
              <div className="onboard__card-meta">
                <div>
                  <span>Citations </span>
                  {CITATION_LABELS[profile.citations.mode]}
                </div>
                <div>
                  <span>Figure widths </span>
                  {widthsLabel(profile.figures.widthPresetsMm)}
                </div>
                <div>
                  <span>Abstract </span>
                  {abstractLimitLabel(profile)}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <label
        className="onboard__choice"
        style={{ borderBottom: 'none', maxWidth: 420 }}
      >
        <input
          type="radio"
          name="onboard-decide-later"
          checked={state.decideLater}
          onChange={() => update({ decideLater: true, profileId: null })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">Decide later</div>
          <div className="onboard__choice-hint">
            Starts with Nature Astronomy&apos;s formatting; change the target journal any time.
          </div>
        </div>
      </label>
    </div>
  )
}
