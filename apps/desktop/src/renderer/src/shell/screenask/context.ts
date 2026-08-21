/**
 * What the app knew it was showing at the moment of a screen-ask, as
 * markdown. Pure — every fact is passed in, so the whole thing is testable
 * without a dock, a window or a project.
 *
 * The point of this file is that a screenshot alone is ambiguous. A model
 * looking at a pixel grid can see that a properties panel is open; it cannot
 * see that the panel belongs to `figures/fig2.svg`, that the project renders
 * against the Nature Astronomy profile, or that three other tabs are open
 * behind this one. Those are the facts that turn "make this look better"
 * into an instruction the agent can act on, and the app already has all of
 * them — so it states them rather than making the model guess.
 *
 * Everything here is a FACT, never an instruction: the rules the agent must
 * follow live in ai/templates.ts's prompt, which quotes this block as its
 * CONTEXT section. Keeping the two apart is what lets the same context
 * describe a dev's UI question and an author's figure question.
 */

/** One open dock tab, as state/dock.ts's `openPanelSummaries` reports it. */
export interface ScreenPanel {
  component: string
  title: string
  /** Absolute; rendered project-relative when it sits inside the project. */
  path: string | null
  active: boolean
}

export interface ScreenContextInput {
  /** Where the agent will be cd'd: the project, or the SUNA checkout. */
  target: 'project' | 'repo'
  /** cwd for the agent run — the project root or the repo root. */
  cwd: string
  /** The open project, when there is one. Null in a repo-target ask with none open. */
  rootDir: string | null
  projectName: string | null
  panels: ScreenPanel[]
  /** Which sidebar view is showing ('explorer', 'figures', …). */
  activeView: string
  activeRoundId: string | null
  /** Manuscript render profile in force, when a project is open. */
  profileId: string | null
  editorTheme: string
  viewport: { width: number; height: number; dpr: number }
  /** Whether the shot is the whole window or a rectangle the user dragged. */
  shot: 'window' | 'region' | 'none'
  platform: string
}

/** Path relative to the project when it sits inside it, absolute otherwise. */
export function relativeToRoot(path: string, rootDir: string | null): string {
  if (rootDir === null) return path
  const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/**
 * The front tab named the way a person would name it — "the canvas showing
 * figures/fig2.svg" rather than a component id. This is the single most
 * useful line in the block, so it gets its own function and its own test.
 */
export function describeActivePanel(input: ScreenContextInput): string {
  const active = input.panels.find((panel) => panel.active)
  if (active === undefined) return 'nothing (the dock is empty)'
  const where = active.path === null ? null : relativeToRoot(active.path, input.rootDir)
  const kind = PANEL_KINDS[active.component] ?? active.component
  return where === null ? `${kind} — "${active.title}"` : `${kind} — ${where}`
}

/** Dock component ids in the words the UI uses for them. */
const PANEL_KINDS: Record<string, string> = {
  editor: 'the text editor',
  canvas: 'the figure canvas',
  manuscript: 'the manuscript workspace',
  pdf: 'the PDF viewer',
  round: 'a review-round workspace',
  compare: 'the version comparison',
  version: 'a logged version',
  letter: 'a cover letter',
  supplement: 'the supplement',
  export: 'the export dialog',
  settings: 'Settings',
  trash: 'the Trash',
  welcome: 'the Welcome screen',
  onboarding: 'the new-project wizard'
}

function bullet(label: string, value: string | null): string | null {
  return value === null || value === '' ? null : `- ${label}: ${value}`
}

/**
 * The CONTEXT block, also written to the bundle as context.md so the run
 * stays a readable record when no CLI ever starts.
 */
export function contextMarkdown(input: ScreenContextInput): string {
  const shot =
    input.shot === 'none'
      ? 'no screenshot was captured for this ask'
      : input.shot === 'region'
        ? 'a rectangle the user dragged around what they are asking about'
        : 'the whole SUNA window, including its sidebars and status bar'

  const facts = [
    bullet('Looking at', describeActivePanel(input)),
    bullet('Screenshot shows', shot),
    bullet('Sidebar view', input.activeView),
    bullet('Project', input.projectName),
    bullet('Project root', input.rootDir),
    bullet('Review round in focus', input.activeRoundId),
    bullet('Rendered-as profile', input.profileId),
    bullet('Editor theme', input.editorTheme),
    bullet(
      'Window',
      `${Math.round(input.viewport.width)}×${Math.round(input.viewport.height)} CSS px @ ${input.viewport.dpr}× on ${input.platform}`
    )
  ].filter((line): line is string => line !== null)

  const tabs =
    input.panels.length === 0
      ? ['- (none)']
      : input.panels.map((panel) => {
          const where = panel.path === null ? null : relativeToRoot(panel.path, input.rootDir)
          const mark = panel.active ? ' **← front**' : ''
          return `- ${panel.title}${where === null ? '' : ` (${where})`} — ${panel.component}${mark}`
        })

  return [
    '# What the user is looking at',
    '',
    ...facts,
    '',
    '## Open tabs',
    '',
    ...tabs,
    ''
  ].join('\n')
}
