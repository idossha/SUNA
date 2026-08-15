import type { JSX } from 'react'
import { SETTINGS_LIMITS } from '@suna/core'
import type { StepProps, WizardDefaults } from '../types'

const MODE_LABELS: Record<WizardDefaults['defaultMode'], string> = {
  reading: 'Reading (live preview)',
  source: 'Source (plain markdown)'
}

const THEME_LABELS: Record<WizardDefaults['editorTheme'], string> = {
  'suna-dark': 'SUNA Dark',
  'suna-light': 'SUNA Light',
  'high-contrast': 'High Contrast'
}

/** Step 6 — Defaults (feature-plan-5 §5), seeded from global settings by the wizard shell. */
export function Step6Defaults({ state, update }: StepProps): JSX.Element {
  const set = <K extends keyof WizardDefaults>(key: K, value: WizardDefaults[K]): void =>
    update({ defaults: { ...state.defaults, [key]: value } })

  return (
    <div className="onboard__step-page">
      <h2 className="onboard__step-title">Defaults</h2>
      <p className="onboard__step-sub">
        Seeded from your global settings. Leave the checkbox off to update those global defaults;
        turn it on to pin these values to just this project instead.
      </p>

      <div className="onboard__field">
        <label htmlFor="onboard-default-mode">Default editor mode</label>
        <select
          id="onboard-default-mode"
          value={state.defaults.defaultMode}
          onChange={(e) => set('defaultMode', e.target.value as WizardDefaults['defaultMode'])}
        >
          {(Object.keys(MODE_LABELS) as WizardDefaults['defaultMode'][]).map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      <div className="onboard__field">
        <label htmlFor="onboard-theme">Editor theme</label>
        <select
          id="onboard-theme"
          value={state.defaults.editorTheme}
          onChange={(e) => set('editorTheme', e.target.value as WizardDefaults['editorTheme'])}
        >
          {(Object.keys(THEME_LABELS) as WizardDefaults['editorTheme'][]).map((theme) => (
            <option key={theme} value={theme}>
              {THEME_LABELS[theme]}
            </option>
          ))}
        </select>
      </div>

      <div className="onboard__field">
        <label htmlFor="onboard-font-size">
          Font size ({state.defaults.fontSizePx}px)
        </label>
        <input
          id="onboard-font-size"
          type="range"
          min={SETTINGS_LIMITS.fontSizePx.min}
          max={SETTINGS_LIMITS.fontSizePx.max}
          value={state.defaults.fontSizePx}
          onChange={(e) => set('fontSizePx', Number(e.target.value))}
        />
      </div>

      <div className="onboard__field">
        <label htmlFor="onboard-line-height">
          Line height ({state.defaults.lineHeight.toFixed(1)})
        </label>
        <input
          id="onboard-line-height"
          type="range"
          step={0.1}
          min={SETTINGS_LIMITS.lineHeight.min}
          max={SETTINGS_LIMITS.lineHeight.max}
          value={state.defaults.lineHeight}
          onChange={(e) => set('lineHeight', Number(e.target.value))}
        />
      </div>

      <div className="onboard__field">
        <label htmlFor="onboard-content-width">
          Content width ({state.defaults.contentWidthCh}ch)
        </label>
        <input
          id="onboard-content-width"
          type="range"
          min={SETTINGS_LIMITS.contentWidthCh.min}
          max={SETTINGS_LIMITS.contentWidthCh.max}
          value={state.defaults.contentWidthCh}
          onChange={(e) => set('contentWidthCh', Number(e.target.value))}
        />
      </div>

      <label className="onboard__choice" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={state.saveDefaultsToProject}
          onChange={(e) => update({ saveDefaultsToProject: e.target.checked })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">Save these to this project instead of globally</div>
          <div className="onboard__choice-hint">
            On: written into this project&apos;s suna.json — other projects keep their own values.
            Off: written into your global settings — future projects start with these too.
          </div>
        </div>
      </label>
    </div>
  )
}
