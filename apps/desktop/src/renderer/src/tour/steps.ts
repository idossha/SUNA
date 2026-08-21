/**
 * The guided tour of the workspace — data only.
 *
 * A step says WHAT to point at and WHAT to say; the state a step needs and
 * the gesture that moves it on are described as small descriptors
 * (`TourEffect` / `TourCue`) rather than callbacks, so this module has no
 * runtime dependency on the stores and stays testable in the desktop
 * package's DOM-less test runner. `effects.ts` is the interpreter.
 *
 * Editing rules, so the tour keeps its shape:
 * - one idea per step, and the body stays under ~360 characters;
 * - show a surface, never enumerate its controls (Settings gets one card,
 *   not one per preference);
 * - a step with a `cue` must not `arrange` the very state the cue asks the
 *   user to reach — that would satisfy it before they touched anything.
 */
import type { SidebarView } from '../state/ui'
import type { Side } from './anchor'

export type { SidebarView }

/** UI state a step needs before it can point at anything. */
export type TourEffect =
  | { kind: 'chrome' }
  | { kind: 'view'; view: SidebarView }
  | { kind: 'manuscript' }
  | { kind: 'figure' }
  | { kind: 'settings' }
  | { kind: 'comments'; visible: boolean }

/** The gesture that ends a step. Polled; the tour advances when it is true. */
export type TourCue =
  | { kind: 'view'; view: SidebarView }
  | { kind: 'panel'; component: string }
  | { kind: 'comments' }

export interface TourStep {
  readonly id: string
  /** CSS selector for the element to point at; null renders a centred card. */
  readonly target: string | null
  readonly title: string
  readonly body: string
  /** Preferred sides for the card, best first. */
  readonly prefer?: readonly Side[]
  /** Applied on entry, forwards and backwards — must be idempotent. */
  readonly arrange?: readonly TourEffect[]
  /** What the user can do instead of pressing Next. */
  readonly cue?: { readonly hint: string; readonly when: TourCue }
}

/** Longest a step body may be; enforced by steps.test.ts. */
export const TOUR_BODY_MAX = 360

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    target: null,
    title: 'A short tour of SUNA',
    body: 'This is Hello SUNA — a small, finished paper with real figures, references and a returned round of peer review. It is a copy, so nothing you do here can break anything. Follow each card, or move with the arrows below. Esc leaves at any point.',
    arrange: [{ kind: 'chrome' }, { kind: 'manuscript' }]
  },
  {
    id: 'activity-bar',
    target: '.activitybar',
    prefer: ['right'],
    title: 'Six views, one rail',
    body: 'Files, writing, figures, references, version control and the agent. The rail switches what the panel beside it shows; the tabs on the right stay where you left them.',
    arrange: [{ kind: 'chrome' }]
  },
  {
    id: 'explorer-icon',
    target: '.activitybar__item[data-view="explorer"]',
    prefer: ['right'],
    title: 'Start with the folder',
    body: 'A SUNA project is an ordinary directory. Open the Explorer and see what is actually on disk.',
    cue: { hint: 'Click Explorer in the rail', when: { kind: 'view', view: 'explorer' } }
  },
  {
    id: 'explorer',
    target: '.sidebar',
    prefer: ['right'],
    title: 'Plain text, all the way down',
    body: 'manuscript/ holds Markdown, JSON and BibTeX. figures/ keeps each figure as an SVG beside the script that drew it. data/ → analysis/ → results/ is the chain the numbers in the paper come from. There is no SUNA file format.',
    arrange: [{ kind: 'view', view: 'explorer' }]
  },
  {
    id: 'writing-icon',
    target: '.activitybar__item[data-view="manuscript"]',
    prefer: ['right'],
    title: 'The writing view',
    body: 'A paper is rarely one document. This view lists all of them.',
    cue: { hint: 'Click Writing in the rail', when: { kind: 'view', view: 'manuscript' } }
  },
  {
    id: 'writing-panel',
    target: '.sidebar',
    prefer: ['right'],
    title: 'Manuscript, letters, review, versions',
    body: 'The manuscript sits on top; below it the cover letter, the supplement, the peer-review rounds and the versions you have logged. Picking one hands the lower half of the panel that document’s outline.',
    arrange: [{ kind: 'view', view: 'manuscript' }]
  },
  {
    id: 'manuscript-open',
    target: '[data-tour="doc-manuscript"]',
    prefer: ['right'],
    title: 'One tab for the whole paper',
    body: 'Title page, prose and reference list together, not a file per section — the outline below is derived from the Markdown headings, so it can never fall out of step with the text.',
    arrange: [{ kind: 'view', view: 'manuscript' }, { kind: 'manuscript' }]
  },
  {
    id: 'title-page',
    target: '.msdoc__authors',
    prefer: ['bottom', 'top'],
    title: 'The byline is data',
    body: 'Authors and affiliations live in manuscript/authors.json, so the ordering, the superscripts and the corresponding-author mark are worked out for you. Click any of it to edit in place.',
    arrange: [{ kind: 'manuscript' }]
  },
  {
    id: 'modes',
    target: '.msdoc__modes',
    prefer: ['bottom'],
    title: 'Three views of one file',
    body: 'Source is the Markdown you type. Reading renders it live — citations, maths, figures and code. Pages lays it out the way the active journal profile will print it, so you can see the real shape before exporting.',
    arrange: [{ kind: 'manuscript' }]
  },
  {
    id: 'numbering',
    target: '.msdoc__references',
    prefer: ['top', 'left'],
    title: 'Nothing carries a number',
    body: 'You cite by BibTeX key — [@knuth1984] — and point at figures, tables and equations by name. Every number and this whole reference list are derived at format time from what you actually cited, so inserting a figure renumbers the paper for you.',
    arrange: [{ kind: 'manuscript' }]
  },
  {
    id: 'comments-toggle',
    target: '.cmt-rail-toggle',
    prefer: ['bottom', 'left'],
    title: 'Review lives beside the prose',
    body: 'This button opens the comment gutter and carries the count of what is still open. Select any sentence and ⌘⇧M leaves a note on it.',
    arrange: [{ kind: 'manuscript' }]
  },
  {
    id: 'comments-rail',
    target: '.cmt-rail',
    prefer: ['left'],
    title: 'A thread beside the sentence',
    body: 'Yours and the agent’s appear in the same rail, each keeping its history. The agent can raise a comment and answer one, but only you ever resolve it — an unresolved thread is a decision still owed.',
    arrange: [{ kind: 'manuscript' }, { kind: 'comments', visible: true }]
  },
  {
    id: 'export',
    target: '.msdoc__export-btn',
    prefer: ['bottom', 'left'],
    title: 'Formatting happens on the way out',
    body: 'Word, PDF or LaTeX, built from the same Markdown against the journal profile you chose. The files on disk are never restyled — a change of target journal is a change of export, not a rewrite.',
    arrange: [{ kind: 'manuscript' }]
  },
  {
    id: 'figures-icon',
    target: '.activitybar__item[data-view="figures"]',
    prefer: ['right'],
    title: 'Figures',
    body: 'Both figures in this paper are SVG, and one of them was written by a script.',
    cue: { hint: 'Click Figures in the rail', when: { kind: 'view', view: 'figures' } }
  },
  {
    id: 'figures',
    target: '.sidebar',
    prefer: ['right'],
    title: 'A figure and its provenance',
    body: 'figures/timesheet/ was generated by source/plot.py from data/timesheet.csv, so the picture and the numbers cannot drift apart. figures/hello/ was drawn by hand — and says so. Rerun either and the manuscript follows.',
    arrange: [{ kind: 'view', view: 'figures' }]
  },
  {
    id: 'figure-open',
    target: '.figs__card',
    prefer: ['right', 'bottom'],
    title: 'Open one on the canvas',
    body: 'The SVG on disk is the document — the canvas edits it directly rather than importing it.',
    cue: { hint: 'Click a figure', when: { kind: 'panel', component: 'canvas' } }
  },
  {
    id: 'canvas',
    target: '.canvas-tab',
    prefer: ['left', 'top'],
    title: 'Editing the file itself',
    body: 'Move an axis label, retype a tick, nudge a panel: every gesture goes through the same command bus the agent uses, and undo is byte-exact. Compliance runs against the journal’s stated rules and flags what is off instead of restyling it.',
    arrange: [{ kind: 'figure' }]
  },
  {
    id: 'references-icon',
    target: '.activitybar__item[data-view="references"]',
    prefer: ['right'],
    title: 'References',
    body: 'One BibTeX file, and a view that knows which of it you are using.',
    cue: { hint: 'Click References in the rail', when: { kind: 'view', view: 'references' } }
  },
  {
    id: 'references',
    target: '.sidebar',
    prefer: ['right'],
    title: 'The library, and what it renders as',
    body: 'manuscript/references.bib is the library; the panel filters it by what the manuscript actually cites, flags keys you cite but do not have, and previews any entry the way the chosen journal will print it.',
    arrange: [{ kind: 'view', view: 'references' }]
  },
  {
    id: 'peer-review',
    target: '[data-tour="doc-peer-review"]',
    prefer: ['right'],
    title: 'Peer review is a stage, not a document',
    body: 'A returned round is a ledger: the referees’ words cut into points, each a verbatim slice of what they sent, with your reply and the change you made recorded against it. Round 1 here is part-answered.',
    arrange: [{ kind: 'view', view: 'manuscript' }],
    cue: { hint: 'Click Peer review, then Round 1', when: { kind: 'panel', component: 'round' } }
  },
  {
    id: 'versions',
    target: '.activitybar__item[data-view="git"]',
    prefer: ['right'],
    title: 'Version control, built in',
    body: 'The project is a git repository from the moment it is created. Log a version when you send something out, and a round points at the version it reviewed — so every diff is derived from real commits, never stored as a second copy.',
    cue: { hint: 'Click Source Control in the rail', when: { kind: 'view', view: 'git' } }
  },
  {
    id: 'agent',
    target: '.activitybar__item[data-view="agent"]',
    prefer: ['right'],
    title: 'The agent is a peer, not a plugin',
    body: 'It reads and writes the same files through the same commands your clicks do, and its work shows up as comments and diffs you review. Nothing it does lands silently.',
    cue: { hint: 'Click Agent in the rail', when: { kind: 'view', view: 'agent' } }
  },
  {
    id: 'statusbar',
    target: '.statusbar',
    prefer: ['top'],
    title: 'The strip along the bottom',
    body: 'The active journal profile and the Python environment this project runs its scripts in, a terminal rooted at the project, and the door to settings.',
    cue: { hint: 'Click Settings, at the right of this strip', when: { kind: 'panel', component: 'settings' } }
  },
  {
    id: 'settings',
    target: '.settings-tab',
    prefer: ['left', 'top'],
    title: 'Settings, grouped by what they touch',
    body: 'Target journal, editor behaviour, export defaults, environments and the agent — project settings live in suna.json beside the paper, so a collaborator who clones the repo gets them too. We will not walk the knobs.',
    arrange: [{ kind: 'settings' }]
  },
  {
    id: 'done',
    target: null,
    title: 'That is the workspace',
    body: 'Press ⌘K for any command, ? for the shortcuts of whatever surface you are on, and keep this example around to experiment in — the tour is in the command palette whenever you want it again.',
    arrange: [{ kind: 'manuscript' }]
  }
]
