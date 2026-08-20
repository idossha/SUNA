import type { ProjectSettings, ResponseOf } from '@suna/core'

/**
 * Onboarding wizard (feature-plan-5 §5). Two entry points share every step
 * after the first: 'create' starts from nothing (step 1 picks parent+name);
 * 'setup' targets an existing folder that is missing suna.json (step 1 is
 * skipped — `parentDir`/`name` are seeded from that folder and never re-picked).
 */
export type WizardMode = 'create' | 'setup'

export type ScaffoldKind = 'blank' | 'starter' | 'import' | 'document'

export type PythonChoice = 'skip' | 'existing' | 'create-uv'

export type AiChoice = 'cli' | 'api' | 'skip'

/** Mirrors the inline enum on 'agent:set-key' — core does not export a named const for it. */
export const AGENT_PROVIDER_IDS = ['anthropic', 'openai', 'ollama'] as const
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number]

export type ImportableFileRow = ResponseOf<'project:list-importable'>['files'][number]
export type DetectedEnvRow = ResponseOf<'env:detect'>['envs'][number]

export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'

export const CREATE_SUBSTEPS = ['dirs', 'files', 'git', 'publish', 'env', 'mcp'] as const
export type CreateSubstep = (typeof CREATE_SUBSTEPS)[number]

export type CreateProgress = Record<CreateSubstep, StepStatus>

export const INITIAL_CREATE_PROGRESS: CreateProgress = {
  dirs: 'pending',
  files: 'pending',
  git: 'pending',
  publish: 'pending',
  env: 'pending',
  mcp: 'pending'
}

export type GitHubVisibility = 'private' | 'public'

/**
 * A GitHub repository name from a project name — the same shape rule the
 * Source Control panel applies, so a project set up here and one published
 * later end up with the same suggestion.
 */
export function repoNameFromProjectName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned === '' ? 'manuscript' : cleaned.slice(0, 100)
}

/** Defaults step seed/output — the five resolved keys the spec names for "Defaults". */
export interface WizardDefaults {
  defaultMode: 'source' | 'reading'
  editorTheme: 'suna-dark' | 'suna-light' | 'gruvbox' | 'jellybeans'
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

  // Step 2 — What to scaffold
  scaffold: ScaffoldKind
  importDir: string | null
  importFiles: ImportableFileRow[]
  importScanning: boolean
  /** 'document' scaffold: the .docx/.pdf/.html manuscript to start from. */
  documentPath: string | null

  // Step 3 — Python environment
  pythonChoice: PythonChoice
  existingEnvPath: string | null
  detectedEnvs: DetectedEnvRow[]
  envsScanned: boolean
  uvAvailable: boolean | null

  // Step 4 — AI
  aiChoice: AiChoice
  detectedClis: ('claude' | 'codex')[]
  clisScanned: boolean
  aiCliCommand: string | null
  apiProvider: AgentProviderId | null
  apiKey: string

  // Step 5 — Defaults. Always written into this project's suna.json; the
  // wizard never touches global settings.
  defaults: WizardDefaults

  // Step 6 — Version control. The local repository is always created; this is
  // only about whether it also gets a remote on GitHub straight away.
  publishToGitHub: boolean
  githubRepoName: string
  githubVisibility: GitHubVisibility

  // Step 6 — Review / create
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

    scaffold: 'starter',
    importDir: null,
    importFiles: [],
    importScanning: false,
    documentPath: null,

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

    defaults: FALLBACK_DEFAULTS,

    publishToGitHub: false,
    githubRepoName: '',
    githubVisibility: 'private',

    creating: false,
    createError: null,
    createWarnings: [],
    progress: INITIAL_CREATE_PROGRESS,

    ...overrides
  }
}

/** The project-settings `editor` block the Defaults step contributes. */
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
 * The Review step's full scaffold `settings` patch: the AI choice and the
 * Defaults block, both written into this project's suna.json. The wizard
 * defines project-level values only — global settings are the Settings tab's
 * business, and a new project must not quietly rewrite them.
 */
export function buildScaffoldSettings(state: WizardState): ProjectSettings {
  return {
    ai: {
      mode: state.aiChoice === 'skip' ? 'none' : state.aiChoice,
      cliCommand: state.aiChoice === 'cli' ? state.aiCliCommand : null
    },
    editor: defaultsToProjectSettings(state.defaults).editor
  }
}
