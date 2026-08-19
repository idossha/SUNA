import { useEffect, useRef, type JSX } from 'react'
import { AI_EFFORTS, AI_MODELS, type AiEffort, type AiModel } from '@suna/core'
import { useResolved, useSettingsStore } from '../state/settings'
import { AI_EFFORT_LABELS, AI_MODEL_LABELS } from '../settings/aiChoice'
import {
  EDITOR_SETTINGS_LIMITS,
  EDITOR_THEME_LABELS,
  useEditorSettings,
  type EditorFontFamily,
  type EditorThemeName
} from './settings'
import type { ContentKind } from './contentKind'

const FONT_FAMILY_LABELS: Record<EditorFontFamily, string> = {
  serif: 'Serif',
  sans: 'Sans',
  mono: 'Mono'
}

interface SettingsPopoverProps {
  onClose: () => void
  /**
   * 'code' hides the Content width and Font controls: neither has an effect
   * on a code/data tab (width never applies, font is always monospace), so
   * showing them would just be dead UI. Defaults to 'prose' for callers
   * (e.g. the manuscript tab) that are always prose.
   */
  contentKind?: ContentKind
}

export function SettingsPopover({
  onClose,
  contentKind = 'prose'
}: SettingsPopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const settings = useEditorSettings()
  const isCode = contentKind === 'code'
  // vim lives in the two-level settings hierarchy (shared with the Settings
  // tab), not in the editor-local appearance store — so this shows the
  // RESOLVED value and names the level it came from, instead of implying the
  // popover owns a value a project may be overriding. The checkbox still
  // writes the global level; the project level is the Settings tab's job.
  const { value: vimMotions, source: vimSource } = useResolved('editor.vimMotions')
  // Same story for the AI's model and effort: resolved value shown, global
  // level written, locked while a project overrides.
  const { value: aiModel, source: aiModelSource } = useResolved('ai.model')
  const { value: aiEffort, source: aiEffortSource } = useResolved('ai.effort')
  const setGlobal = useSettingsStore((s) => s.setGlobal)
  const overriddenByProject = vimSource === 'project'

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // The gear button toggles; let its own click handler close the popover.
      if (target.closest('.editor-tab__gear')) return
      if (ref.current && !ref.current.contains(target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div ref={ref} className="editor-settings" role="dialog" aria-label="Editor appearance">
      {!isCode && (
        <div className="editor-settings__row">
          <label htmlFor="ed-set-width">
            Content width{' '}
            <span className="editor-settings__value">{settings.contentWidthCh}ch</span>
          </label>
          <input
            id="ed-set-width"
            type="range"
            min={EDITOR_SETTINGS_LIMITS.contentWidthCh.min}
            max={EDITOR_SETTINGS_LIMITS.contentWidthCh.max}
            step={1}
            value={settings.contentWidthCh}
            onChange={(event) => settings.setContentWidthCh(Number(event.target.value))}
          />
        </div>
      )}
      <div className="editor-settings__row">
        <label htmlFor="ed-set-size">
          Font size <span className="editor-settings__value">{settings.fontSizePx}px</span>
        </label>
        <input
          id="ed-set-size"
          type="range"
          min={EDITOR_SETTINGS_LIMITS.fontSizePx.min}
          max={EDITOR_SETTINGS_LIMITS.fontSizePx.max}
          step={1}
          value={settings.fontSizePx}
          onChange={(event) => settings.setFontSizePx(Number(event.target.value))}
        />
      </div>
      <div className="editor-settings__row">
        <label htmlFor="ed-set-leading">
          Line height{' '}
          <span className="editor-settings__value">{settings.lineHeight.toFixed(2)}</span>
        </label>
        <input
          id="ed-set-leading"
          type="range"
          min={EDITOR_SETTINGS_LIMITS.lineHeight.min}
          max={EDITOR_SETTINGS_LIMITS.lineHeight.max}
          step={0.05}
          value={settings.lineHeight}
          onChange={(event) => settings.setLineHeight(Number(event.target.value))}
        />
      </div>
      {!isCode && (
        <div className="editor-settings__row editor-settings__row--select">
          <label htmlFor="ed-set-family">Font</label>
          <select
            id="ed-set-family"
            value={settings.fontFamily}
            onChange={(event) => settings.setFontFamily(event.target.value as EditorFontFamily)}
          >
            {(Object.keys(FONT_FAMILY_LABELS) as EditorFontFamily[]).map((family) => (
              <option key={family} value={family}>
                {FONT_FAMILY_LABELS[family]}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="editor-settings__row editor-settings__row--select">
        <label htmlFor="ed-set-theme">Theme</label>
        <select
          id="ed-set-theme"
          value={settings.editorTheme}
          onChange={(event) => settings.setEditorTheme(event.target.value as EditorThemeName)}
        >
          {(Object.keys(EDITOR_THEME_LABELS) as EditorThemeName[]).map((theme) => (
            <option key={theme} value={theme}>
              {EDITOR_THEME_LABELS[theme]}
            </option>
          ))}
        </select>
      </div>
      <div className="editor-settings__row editor-settings__row--toggle">
        <label htmlFor="ed-set-vim">Vim motions</label>
        {/* Disabled while a project override is in force. The control shows
            the RESOLVED value but writes the GLOBAL level, so with an override
            present every click re-resolves back to the project's value and the
            box visibly snaps back — a checkbox that cannot be checked. The
            tooltip says where to change it; which level a value came from is
            Settings-page detail, not something this popover spells out. */}
        <input
          id="ed-set-vim"
          type="checkbox"
          checked={vimMotions}
          disabled={overriddenByProject}
          title={
            overriddenByProject
              ? 'Set by this project — change it in Settings → This project'
              : undefined
          }
          onChange={(event) => void setGlobal('editor.vimMotions', event.target.checked)}
        />
      </div>
      <div className="editor-settings__group">AI</div>
      <div className="editor-settings__row editor-settings__row--select">
        <label htmlFor="ed-set-ai-model">Model</label>
        <select
          id="ed-set-ai-model"
          value={aiModel}
          disabled={aiModelSource === 'project'}
          title={
            aiModelSource === 'project'
              ? 'Set by this project — change it in Settings → This project'
              : undefined
          }
          onChange={(event) => void setGlobal('ai.model', event.target.value as AiModel)}
        >
          {AI_MODELS.map((id) => (
            <option key={id} value={id}>
              {AI_MODEL_LABELS[id]}
            </option>
          ))}
        </select>
      </div>
      <div className="editor-settings__row editor-settings__row--select">
        <label htmlFor="ed-set-ai-effort">Effort</label>
        <select
          id="ed-set-ai-effort"
          value={aiEffort}
          disabled={aiEffortSource === 'project'}
          title={
            aiEffortSource === 'project'
              ? 'Set by this project — change it in Settings → This project'
              : undefined
          }
          onChange={(event) => void setGlobal('ai.effort', event.target.value as AiEffort)}
        >
          {AI_EFFORTS.map((id) => (
            <option key={id} value={id}>
              {AI_EFFORT_LABELS[id]}
            </option>
          ))}
        </select>
      </div>
      <div className="editor-settings__footer">
        <button
          className="editor-settings__reset"
          title="Resets the appearance controls above. Vim motions live in the app-wide settings and are left alone."
          onClick={() => settings.reset()}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
