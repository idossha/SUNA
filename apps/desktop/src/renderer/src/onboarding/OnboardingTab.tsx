import { useEffect, useRef, useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { HOUSE_PROFILE_ID } from '../state/renderProfile'
import { useProjectStore } from '../state/project'
import { useSettingsStore } from '../state/settings'
import { useUiStore } from '../state/ui'
import { useEditorSettings } from '../editor/settings'
import { openFileTab } from '../state/dock'
import { registerOnboardingProvider } from './devSeam'
import { stepGate } from './gating'
import {
  wizardSettingWrites,
  createInitialWizardState,
  INITIAL_CREATE_PROGRESS,
  type CreateProgress,
  type WizardMode,
  type WizardState
} from './types'
import { Step1Location } from './steps/Step1Location'
import { Step2Scaffold } from './steps/Step2Scaffold'
import { Step3Python } from './steps/Step3Python'
import { Step4Ai } from './steps/Step4Ai'
import { Step5Defaults } from './steps/Step5Defaults'
import { Step6Review } from './steps/Step6Review'
import './onboarding.css'

/** The Review step — the wizard's last, and the only one that writes anything. */
const LAST_STEP = 6

const STEP_TITLES = [
  'Where & what',
  'What to scaffold',
  'Python environment',
  'AI',
  'Defaults',
  'Review'
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseParams(params: Record<string, unknown>): { mode: WizardMode; dir: string | null } {
  return {
    mode: params['mode'] === 'setup' ? 'setup' : 'create',
    dir: typeof params['dir'] === 'string' ? params['dir'] : null
  }
}

/** Splits an absolute path into its parent directory and basename. */
function splitPath(path: string): { parent: string; name: string } {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return { parent: '/', name: trimmed.slice(idx + 1) }
  return { parent: trimmed.slice(0, idx), name: trimmed.slice(idx + 1) }
}

/**
 * Onboarding wizard (feature-plan-5 §5) — a full dock tab, component
 * 'onboarding'. Two entry points: {mode:'create'} starts from step 1;
 * {mode:'setup', dir} targets an existing suna.json-less folder and starts
 * at step 2 (steps 2-6 "against it", per the spec). Nothing is written to
 * disk before "Create project" on step 6.
 */
export function OnboardingTab({ api, params }: DockPanelProps): JSX.Element {
  const [wizard, setWizard] = useState<WizardState>(() => {
    const { mode, dir } = parseParams(params)
    if (mode === 'setup' && dir !== null) {
      const { parent, name } = splitPath(dir)
      return createInitialWizardState('setup', { parentDir: parent, name, step: 2 })
    }
    return createInitialWizardState('create')
  })
  const seededDefaults = useRef(false)

  const update = (patch: Partial<WizardState>): void => setWizard((s) => ({ ...s, ...patch }))

  // The Defaults step seeds from the user's current config — load once, then
  // seed once when it lands, so the wizard opens showing what SUNA is set to
  // rather than what it shipped with.
  useEffect(() => {
    void useSettingsStore.getState().load()
  }, [])
  const configuredSettings = useSettingsStore((s) => s.settings)
  const configLoaded = useSettingsStore((s) => s.loaded)
  useEffect(() => {
    if (seededDefaults.current || !configLoaded) return
    seededDefaults.current = true
    update({
      defaults: {
        defaultMode: configuredSettings['editor.defaultMode'],
        editorTheme: configuredSettings['editor.editorTheme'],
        fontSizePx: configuredSettings['editor.fontSizePx'],
        lineHeight: configuredSettings['editor.lineHeight'],
        contentWidthCh: configuredSettings['editor.contentWidthCh']
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, configuredSettings])

  /**
   * Live theme preview (Defaults step): the picked theme is applied to the whole
   * app as it is picked, because "SUNA Dark" and "Gruvbox" mean nothing as
   * words in a dropdown. The editor-settings store is localStorage-only, so
   * previewing writes no project or global setting — the create step is
   * still what commits the choice. Abandon the wizard and the theme the
   * user arrived with is put back.
   */
  const themeOnEntry = useRef(useEditorSettings.getState().editorTheme)
  const previewTheme = wizard.defaults.editorTheme
  useEffect(() => {
    useEditorSettings.getState().setEditorTheme(previewTheme)
  }, [previewTheme])
  const createdRef = useRef(false)
  useEffect(
    () => () => {
      if (!createdRef.current) useEditorSettings.getState().setEditorTheme(themeOnEntry.current)
    },
    []
  )

  // Escape cancels from anywhere in the wizard (feature-plan-5 §5) — but only
  // while this wizard is the panel on screen. dockview keeps hidden panels
  // mounted, so an ungated window listener would let an Escape pressed in a
  // completely different tab silently discard a half-filled wizard.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && api.isVisible) {
        e.preventDefault()
        api.close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [api])

  // Dev-only seam for e2e drivers: step 1's folder picker is a native dialog
  // CDP cannot drive, so a driver patches the state the picker would produce
  // and then presses the wizard's own buttons (see onboarding/devSeam.ts).
  const wizardRef = useRef(wizard)
  wizardRef.current = wizard
  useEffect(() => {
    if (!import.meta.env.DEV) return
    return registerOnboardingProvider({
      getState: () => wizardRef.current,
      patch: (next) => setWizard((s) => ({ ...s, ...next })),
      close: () => api.close(),
      isVisible: () => api.isVisible
    })
  }, [api])

  const firstStep = wizard.mode === 'setup' ? 2 : 1
  const visibleSteps = wizard.mode === 'setup' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]
  const gate = stepGate(wizard.step, wizard)
  const targetPath =
    wizard.parentDir !== null && wizard.name !== '' ? `${wizard.parentDir}/${wizard.name}` : null
  // 'create': env:detect runs against the parent (the project doesn't exist yet).
  // 'setup': the folder already exists, so scan it directly.
  const envScanDir = wizard.mode === 'setup' ? targetPath : wizard.parentDir
  /** Once dirs/files/git have succeeded, the project exists — Back/Cancel just closes. */
  const created = wizard.progress.dirs === 'done'
  createdRef.current = created

  const goBack = (): void => {
    if (created || wizard.step <= firstStep) {
      api.close()
      return
    }
    update({ step: wizard.step - 1 })
  }

  const goNext = (): void => {
    if (!gate.canAdvance || wizard.step >= LAST_STEP) return
    update({ step: wizard.step + 1 })
  }

  const runCreate = async (): Promise<void> => {
    if (targetPath === null) return
    const snapshot = wizard
    let progress: CreateProgress = { ...INITIAL_CREATE_PROGRESS, dirs: 'active', files: 'active' }
    const warnings: string[] = []
    update({ creating: true, createError: null, createWarnings: [], progress })

    const activeProfileId = HOUSE_PROFILE_ID

    let scaffoldResult: ResponseOf<'project:scaffold'>
    try {
      scaffoldResult = await window.suna.invoke('project:scaffold', {
        dir: targetPath,
        name: snapshot.name,
        activeProfileId,
        scaffold: snapshot.scaffold,
        documentPath: snapshot.scaffold === 'document' ? snapshot.documentPath : null
      })
    } catch (error) {
      progress = { ...progress, dirs: 'error', files: 'error' }
      update({ creating: false, createError: errorMessage(error), progress })
      return
    }

    // The Defaults and AI steps configure SUNA, not this one project: they go
    // into ~/.suna/config.yml. Sequential rather than concurrent because each
    // write re-reads and rewrites the same file, and a warning is enough — a
    // preference that did not stick must not fail a project that now exists.
    for (const write of wizardSettingWrites(snapshot)) {
      try {
        await useSettingsStore.getState().set(write.key, write.value as never)
      } catch (error) {
        warnings.push(`could not save ${write.key}: ${errorMessage(error)}`)
      }
    }

    warnings.push(...scaffoldResult.warnings)
    progress = {
      ...progress,
      dirs: 'done',
      files: 'done',
      git: scaffoldResult.gitInitialized ? 'done' : 'error'
    }
    if (!scaffoldResult.gitInitialized) {
      warnings.push('Git could not be initialized — continuing without version control.')
    }
    update({ progress, createWarnings: [...warnings] })

    // Publishing needs the local repository the previous substep just made, so
    // it is skipped rather than attempted when that failed. A failure here is a
    // warning, never a create failure: the project on disk is complete and the
    // remote can be added from Source Control at any time.
    if (snapshot.publishToGitHub && scaffoldResult.gitInitialized) {
      progress = { ...progress, publish: 'active' }
      update({ progress })
      try {
        const repo = await window.suna.invoke('github:create-repo', {
          dir: targetPath,
          name: snapshot.githubRepoName.trim(),
          visibility: snapshot.githubVisibility
        })
        await window.suna.invoke('git:push', { dir: targetPath })
        progress = { ...progress, publish: 'done' }
        update({ progress })
        void repo
      } catch (error) {
        warnings.push(`Could not publish to GitHub: ${errorMessage(error)}`)
        progress = { ...progress, publish: 'error' }
        update({ progress, createWarnings: [...warnings] })
      }
    } else {
      progress = { ...progress, publish: 'skipped' }
      update({ progress })
    }


    progress = { ...progress, env: 'active' }
    update({ progress })
    if (snapshot.pythonChoice === 'create-uv') {
      try {
        const res = await window.suna.invoke('env:create', { dir: targetPath })
        if (res.ok) {
          progress = { ...progress, env: 'done' }
        } else {
          warnings.push(res.error ?? 'Could not create a uv environment.')
          progress = { ...progress, env: 'error' }
        }
      } catch (error) {
        warnings.push(errorMessage(error))
        progress = { ...progress, env: 'error' }
      }
    } else if (snapshot.pythonChoice === 'existing' && snapshot.existingEnvPath !== null) {
      try {
        await window.suna.invoke('env:select', { dir: targetPath, envPath: snapshot.existingEnvPath })
        progress = { ...progress, env: 'done' }
      } catch (error) {
        warnings.push(errorMessage(error))
        progress = { ...progress, env: 'error' }
      }
    } else {
      progress = { ...progress, env: 'skipped' }
    }
    update({ progress, createWarnings: [...warnings] })

    // The agent layer (stubs, context/, .mcp.json) is written by the scaffold
    // itself now — this substep only reports how that went.
    progress = { ...progress, mcp: scaffoldResult.agentLayerWritten ? 'done' : 'error' }
    if (!scaffoldResult.agentLayerWritten) {
      warnings.push('Agent wiring could not be written — open the project to retry.')
    }

    update({ creating: false, progress, createWarnings: [...warnings] })

    // Adopt the freshly created project into the workbench either way — the
    // project itself exists once dirs/files/git succeeded, regardless of an
    // env/mcp hiccup. Only auto-close when there is nothing to read: a
    // warning must stay on screen, not vanish with the tab that reported it.
    useProjectStore.setState({ rootDir: targetPath, manifest: scaffoldResult.manifest, tree: null })
    await useProjectStore.getState().refreshTree()
    // A brand-new project's first job is to show what it just made. The
    // welcome screen collapses the left nav (nothing to list); a project
    // with a scaffolded tree behind it must open with the explorer showing,
    // or the starter's figure, bib and manuscript are invisible.
    useUiStore.getState().setSidebarVisible(true)
    openFileTab(`${targetPath}/manuscript/manuscript.md`)
    if (warnings.length === 0) api.close()
  }

  return (
    <div className="onboard">
      <div className="onboard__header">
        <div>
          <div className="onboard__eyebrow">SUNA</div>
          <div className="onboard__title">
            {wizard.mode === 'setup' ? 'Set up project' : 'New project'}
          </div>
        </div>
        <button className="onboard__cancel" onClick={() => api.close()}>
          Cancel (Esc)
        </button>
      </div>

      <div className="onboard__steps">
        {visibleSteps.map((n) => (
          <div
            key={n}
            className={
              'onboard__step' +
              (n === wizard.step ? ' onboard__step--active' : '') +
              (n < wizard.step ? ' onboard__step--done' : '')
            }
          >
            <span className="onboard__step-num">{n}</span>
            {STEP_TITLES[n - 1]}
          </div>
        ))}
      </div>

      <div className="onboard__body">
        {wizard.createError !== null && (
          <div className="onboard__error">{wizard.createError}</div>
        )}
        {wizard.step === 1 && wizard.mode === 'create' && (
          <Step1Location state={wizard} update={update} />
        )}
        {wizard.step === 2 && <Step2Scaffold state={wizard} update={update} />}
        {wizard.step === 3 && (
          <Step3Python state={wizard} update={update} scanDir={envScanDir} />
        )}
        {wizard.step === 4 && <Step4Ai state={wizard} update={update} />}
        {wizard.step === 5 && <Step5Defaults state={wizard} update={update} />}
        {wizard.step === 6 && (
          <Step6Review state={wizard} update={update} targetPath={targetPath} />
        )}
      </div>

      <div className="onboard__footer">
        <button className="onboard__back" onClick={goBack} disabled={wizard.creating}>
          {created ? 'Close' : wizard.step <= firstStep ? 'Cancel' : 'Back'}
        </button>
        <div className="onboard__footer-right">
          {wizard.step < LAST_STEP && (
            <button className="onboard__next" onClick={goNext} disabled={!gate.canAdvance}>
              Next
            </button>
          )}
          {wizard.step === LAST_STEP && !created && (
            <button
              className="onboard__create"
              onClick={() => void runCreate()}
              disabled={wizard.creating || targetPath === null}
            >
              {wizard.creating ? 'Creating…' : 'Create project'}
            </button>
          )}
          {wizard.step === LAST_STEP && created && (
            <button className="onboard__create" onClick={() => api.close()}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
