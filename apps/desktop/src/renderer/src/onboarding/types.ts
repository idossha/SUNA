import { SETTING_KEYS, type ProjectSettings, type ResponseOf } from '@suna/core'

/**
 * Onboarding wizard (feature-plan-5 §5). Two entry points share every step
 * after the first: 'create' starts from nothing (step 1 picks parent+name);
 * 'setup' targets an existing folder that is missing suna.json (step 1 is
 * skipped — `parentDir`/`name` are seeded from that folder and never re-picked).
 */
export type WizardMode = 'create' | 'setup'

export type ScaffoldKind = 'blank' | 'starter' | 'import'

export type PythonChoice = 'skip' | 'existing' | 'create-uv'

export type AiChoice = 'cli' | 'api' | 'skip'

/** Mirrors the inline enum on 'agent:set-key' — core does not export a named const for it. */
export const AGENT_PROVIDER_IDS = ['anthropic', 'openai', 'ollama'] as const
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number]

export type ImportableFileRow = ResponseOf<'project:list-importable'>['files'][number]
export type DetectedEnvRow = ResponseOf<'env:detect'>['envs'][number]

export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'

export const CREATE_SUBSTEPS = ['dirs', 'files', 'git', 'env', 'mcp'] as const
export type CreateSubstep = (typeof CREATE_SUBSTEPS)[number]

export type CreateProgress = Record<CreateSubstep, StepStatus>

export const INITIAL_CREATE_PROGRESS: CreateProgress = {
  dirs: 'pending',
  files: 'pending',
  git: 'pending',
  env: 'pending',
  mcp: 'pending'
}

/** Step 6 seed/output — the five resolved keys the spec names for "Defaults". */
export interface WizardDefaults {
  defaultMode: 'source' | 'reading'
  editorTheme: 'suna-dark' | 'suna-light' | 'high-contrast'
  fontSizePx: number
  lineHeight: number
  contentWidthCh: number
}

/** Every step component's props: the whole state, and a shallow patcher. */
export interface StepProps {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

export interface WizardState {
  mode: WizardMode
  step: number

  // Step 1 — Where & what
  parentDir: string | null
  name: string
  targetExists: boolean | null
  targetParentWritable: boolean | null
  checkingTarget: boolean

  // Step 2 — Target journal
  profileId: string | null
  decideLater: boolean

  // Step 3 — What to scaffold
  scaffold: ScaffoldKind
  importDir: string | null
  importFiles: ImportableFileRow[]
  importScanning: boolean

  // Step 4 — Python environment
  pythonChoice: PythonChoice
  existingEnvPath: string | null
  detectedEnvs: DetectedEnvRow[]
  envsScanned: boolean
  uvAvailable: boolean | null

  // Step 5 — AI
  aiChoice: AiChoice
  detectedClis: ('claude' | 'codex')[]
  clisScanned: boolean
  aiCliCommand: string | null
  apiProvider: AgentProviderId | null
  apiKey: string
  writeMcpConfig: boolean

  // Step 6 — Defaults
  defaults: WizardDefaults
  saveDefaultsToProject: boolean

  // Step 7 — Review / create
  creating: boolean
  createError: string | null
  createWarnings: string[]
  progress: CreateProgress
}

/**
 * Fallback step-6 seed, matching @suna/core's SETTINGS_DEFAULTS — used before
 * the real resolved-global values load, and by tests that don't need them.
 */
export const FALLBACK_DEFAULTS: WizardDefaults = {
  defaultMode: 'reading',
  editorTheme: 'suna-dark',
  fontSizePx: 14,
  lineHeight: 1.6,
  contentWidthCh: 140
}

/** A fresh wizard state; pass overrides for whatever a caller/test cares about. */
export function createInitialWizardState(
  mode: WizardMode,
  overrides: Partial<WizardState> = {}
): WizardState {
  return {
    mode,
    step: 1,

    parentDir: null,
    name: '',
    targetExists: null,
    targetParentWritable: null,
    checkingTarget: false,

    profileId: null,
    decideLater: false,

    scaffold: 'starter',
    importDir: null,
    importFiles: [],
    importScanning: false,

    pythonChoice: 'skip',
    existingEnvPath: null,
    detectedEnvs: [],
    envsScanned: false,
    uvAvailable: null,

    aiChoice: 'cli',
    detectedClis: [],
    clisScanned: false,
    aiCliCommand: null,
    apiProvider: null,
    apiKey: '',
    writeMcpConfig: false,

    defaults: FALLBACK_DEFAULTS,
    saveDefaultsToProject: false,

    creating: false,
    createError: null,
    createWarnings: [],
    progress: INITIAL_CREATE_PROGRESS,

    ...overrides
  }
}

/** The project-settings `editor` block step 6 contributes when its checkbox is on. */
export function defaultsToProjectSettings(defaults: WizardDefaults): ProjectSettings {
  return {
    editor: {
      defaultMode: defaults.defaultMode,
      editorTheme: defaults.editorTheme,
      fontSizePx: defaults.fontSizePx,
      lineHeight: defaults.lineHeight,
      contentWidthCh: defaults.contentWidthCh
    }
  }
}

/**
 * The GLOBAL-settings patch step 6 contributes when its "save to this project
 * instead" checkbox is off — same five values, keyed by each setting's
 * canonical global key (SETTING_KEYS' alias handling: 'editor.editorTheme'
 * writes the legacy 'editor.theme' slot, matching the Settings page).
 */
export function defaultsToGlobalPatch(defaults: WizardDefaults): Record<string, unknown> {
  return {
    [SETTING_KEYS['editor.defaultMode'].globalKeys[0]]: defaults.defaultMode,
    [SETTING_KEYS['editor.editorTheme'].globalKeys[0]]: defaults.editorTheme,
    [SETTING_KEYS['editor.fontSizePx'].globalKeys[0]]: defaults.fontSizePx,
    [SETTING_KEYS['editor.lineHeight'].globalKeys[0]]: defaults.lineHeight,
    [SETTING_KEYS['editor.contentWidthCh'].globalKeys[0]]: defaults.contentWidthCh
  }
}

/**
 * Step 7's full scaffold `settings` patch: the AI choice (step 5) is always a
 * per-project setting (there is no global fallback for it), while the
 * Defaults block (step 6) is included only when its "save to this project"
 * checkbox is on — otherwise those five values go to global settings instead
 * (see defaultsToGlobalPatch), called separately at create time.
 */
export function buildScaffoldSettings(state: WizardState): ProjectSettings {
  const settings: ProjectSettings = {
    ai: {
      mode: state.aiChoice === 'skip' ? 'none' : state.aiChoice,
      cliCommand: state.aiChoice === 'cli' ? state.aiCliCommand : null
    }
  }
  if (state.saveDefaultsToProject) {
    settings.editor = defaultsToProjectSettings(state.defaults).editor
  }
  return settings
}
