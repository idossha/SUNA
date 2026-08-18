import { describe, expect, it } from 'vitest'
import {
  commentFixPrompt,
  figureEditPrompt,
  shortTitle,
  uiRepairPrompt,
  type CommentFixPromptInput,
  type FigureEditPromptInput,
  type UiRepairPromptInput
} from './templates'

/**
 * The prompts ARE the interface to the headless CLI (feature-plan-8 §2c), so
 * the tests pin three things: every context field lands in the output, the
 * forbidden-action lines are present, and the skeleton's section order is
 * stable — a reordered template silently changes agent behaviour with no
 * type error to catch it.
 */

const CLOSING =
  'Reply with a concise summary of exactly what you changed; it is shown to the author in the app.'
const GIT_RULE = 'Never run destructive git commands, never commit.'

/** Asserts role → TASK → CONTEXT → RULES → closing, each exactly once. */
function expectSkeleton(prompt: string): void {
  const task = prompt.indexOf('\nTASK\n')
  const context = prompt.indexOf('\nCONTEXT\n')
  const rules = prompt.indexOf('\nRULES\n')
  const closing = prompt.indexOf(CLOSING)
  expect(task).toBeGreaterThan(0)
  expect(context).toBeGreaterThan(task)
  expect(rules).toBeGreaterThan(context)
  expect(closing).toBeGreaterThan(rules)
  // Exactly one of each section header — a duplicated section is a bug.
  expect(prompt.match(/\nTASK\n/g)).toHaveLength(1)
  expect(prompt.match(/\nCONTEXT\n/g)).toHaveLength(1)
  expect(prompt.match(/\nRULES\n/g)).toHaveLength(1)
  expect(prompt.endsWith(CLOSING)).toBe(true)
}

/* ------------------------------------------------------------- figure ---- */

const figureInput: FigureEditPromptInput = {
  figureId: 'fig-density',
  svgPath: '/proj/figures/fig-density/figure.svg',
  artboardMm: { width: 85, height: 110 },
  selectedIds: ['ax0.title', 'ax0.xlabel'],
  screenshotPath: '/tmp/suna-captures/cap-1.png',
  profileName: 'nature',
  complianceIssues: ['min font size 5pt violated by ax0.ticks', 'stroke below 0.25pt'],
  instruction: 'Make the title bold and enlarge tick labels'
}

describe('figureEditPrompt', () => {
  const prompt = figureEditPrompt(figureInput)

  it('has the skeleton in stable order', () => {
    expectSkeleton(prompt)
  })

  it('lands every context field', () => {
    expect(prompt).toContain('fig-density')
    expect(prompt).toContain('/proj/figures/fig-density/figure.svg')
    expect(prompt).toContain('85 × 110 mm')
    expect(prompt).toContain('ax0.title, ax0.xlabel')
    expect(prompt).toContain('/tmp/suna-captures/cap-1.png')
    expect(prompt).toContain('nature')
    expect(prompt).toContain('min font size 5pt violated by ax0.ticks')
    expect(prompt).toContain('stroke below 0.25pt')
    expect(prompt).toContain('Make the title bold and enlarge tick labels')
  })

  it('carries the forbidden-action and verification rules', () => {
    expect(prompt).toContain('Never regenerate the figure from source/plot.py')
    expect(prompt).toContain('Preserve all element ids')
    expect(prompt).toContain('mcp__suna__check_figure_compliance')
    expect(prompt).toContain(GIT_RULE)
  })

  it('explains the gold selection overlay when a screenshot exists', () => {
    expect(prompt).toContain('the gold overlay marks the selection')
  })

  it('falls back to whole-figure targeting and drops screenshot lines', () => {
    const bare = figureEditPrompt({
      ...figureInput,
      selectedIds: [],
      screenshotPath: null,
      profileName: null,
      complianceIssues: []
    })
    expect(bare).toContain('none — the whole figure is the target')
    expect(bare).not.toContain('Screenshot')
    expect(bare).not.toContain('gold overlay')
    expect(bare).toContain('- Journal profile: none')
    expect(bare).toContain('- Current compliance issues: none')
    expectSkeleton(bare)
  })
})

/* ------------------------------------------------------------ comment ---- */

const commentInput: CommentFixPromptInput = {
  manuscriptPath: '/proj/manuscript/manuscript.md',
  commentId: 'c-abc123',
  anchor: { quote: 'the results suggest', prefix: 'Overall ', suffix: ' that' },
  thread: [
    { author: 'Reviewer 2', when: '2026-08-15', body: 'Hedge this claim.' },
    { author: 'Ido Haber', when: '2026-08-16', body: 'Agreed, will soften.' }
  ],
  surrounding: 'Overall the results suggest that the effect is robust.',
  detached: false
}

describe('commentFixPrompt', () => {
  const prompt = commentFixPrompt(commentInput)

  it('has the skeleton in stable order', () => {
    expectSkeleton(prompt)
  })

  it('lands every context field', () => {
    expect(prompt).toContain('/proj/manuscript/manuscript.md')
    expect(prompt).toContain('c-abc123')
    expect(prompt).toContain(JSON.stringify('the results suggest'))
    expect(prompt).toContain(JSON.stringify('Overall '))
    expect(prompt).toContain(JSON.stringify(' that'))
    expect(prompt).toContain('Overall the results suggest that the effect is robust.')
  })

  it('renders the thread as "author (when): body" lines in order', () => {
    const first = prompt.indexOf('Reviewer 2 (2026-08-15): Hedge this claim.')
    const second = prompt.indexOf('Ido Haber (2026-08-16): Agreed, will soften.')
    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(first)
  })

  it('orders the MCP steps edit → reply, forbids resolving and write_manuscript', () => {
    const edit = prompt.indexOf('mcp__suna__edit_manuscript')
    const reply = prompt.indexOf('mcp__suna__reply_comment')
    expect(edit).toBeGreaterThan(0)
    expect(reply).toBeGreaterThan(edit)
    expect(prompt).toContain('never write_manuscript')
    expect(prompt).toContain('Never resolve the thread')
    expect(prompt).not.toContain('mcp__suna__resolve_comment')
    expect(prompt).toContain('Touch nothing outside the quoted region')
    expect(prompt).toContain(GIT_RULE)
  })

  it('states the anchor state for both attached and detached', () => {
    expect(prompt).toContain('Anchor state: attached')
    const detached = commentFixPrompt({ ...commentInput, detached: true })
    expect(detached).toContain('Anchor state: detached')
    expect(detached).toContain('re-locate the intended region')
  })

  it('uses the comment body as the instruction unless one is given', () => {
    expect(prompt).toContain('The comment body is the instruction')
    const explicit = commentFixPrompt({ ...commentInput, instruction: 'Only fix the tense.' })
    expect(explicit).toContain('Only fix the tense.')
    expect(explicit).not.toContain('The comment body is the instruction')
  })
})

/* ------------------------------------------------------------- repair ---- */

const repairInput: UiRepairPromptInput = {
  bundleDir: '/repo/bug-reports/20260817-093000-statusbar',
  shotPath: '/repo/bug-reports/20260817-093000-statusbar/shot.png',
  context: { domPath: 'div.status-bar > span.status-note', appVersion: '0.8.0' },
  report: 'The status note overlaps the terminal chip'
}

describe('uiRepairPrompt', () => {
  const prompt = uiRepairPrompt(repairInput)

  it('has the skeleton in stable order', () => {
    expectSkeleton(prompt)
  })

  it('lands every context field including the context JSON', () => {
    expect(prompt).toContain('/repo/bug-reports/20260817-093000-statusbar')
    expect(prompt).toContain('/repo/bug-reports/20260817-093000-statusbar/shot.png')
    expect(prompt).toContain('div.status-bar > span.status-note')
    expect(prompt).toContain('"appVersion": "0.8.0"')
    expect(prompt).toContain('The status note overlaps the terminal chip')
  })

  it('carries the repo mapping, verification, and no-commit rules', () => {
    expect(prompt).toContain('apps/desktop/src/renderer/src')
    expect(prompt).toContain('Make a minimal fix.')
    expect(prompt).toContain('pnpm typecheck')
    expect(prompt).toContain('Do NOT commit; list the files you changed')
    expect(prompt).toContain(GIT_RULE)
  })

  it('adapts the read rule when no screenshot was captured', () => {
    const noShot = uiRepairPrompt({ ...repairInput, shotPath: null })
    expect(noShot).toContain('Screenshot: none was captured')
    expect(noShot).toContain('- Read context.json in the bundle')
    expect(noShot).not.toContain('shot.png and')
  })
})

/* --------------------------------------------------------- shortTitle ---- */

describe('shortTitle', () => {
  it('collapses whitespace into one line', () => {
    expect(shortTitle('✦ Fix comment', 'hedge\n  this   claim')).toBe(
      '✦ Fix comment: hedge this claim'
    )
  })

  it('truncates past 60 chars with an ellipsis', () => {
    const long = 'x'.repeat(80)
    const title = shortTitle('✦ Edit figure', long)
    expect(title).toBe(`✦ Edit figure: ${'x'.repeat(59)}…`)
  })

  it('keeps a 60-char text untruncated and degrades to the bare prefix', () => {
    const exact = 'y'.repeat(60)
    expect(shortTitle('✦ Repair UI', exact)).toBe(`✦ Repair UI: ${exact}`)
    expect(shortTitle('✦ Repair UI', '   ')).toBe('✦ Repair UI')
  })
})
