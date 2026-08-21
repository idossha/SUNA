import { describe, expect, it } from 'vitest'
import { TOUR_BODY_MAX, TOUR_STEPS } from './steps'

describe('TOUR_STEPS', () => {
  it('has unique ids', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('says something on every card', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length, step.id).toBeGreaterThan(0)
      expect(step.body.length, step.id).toBeGreaterThan(0)
    }
  })

  it('keeps every body brief', () => {
    // The card is a floating box over the app, not a manual page: a body
    // that outgrows this is a step that wants splitting.
    for (const step of TOUR_STEPS) {
      expect(step.body.length, `${step.id} is too long`).toBeLessThanOrEqual(TOUR_BODY_MAX)
    }
  })

  it('opens and closes on a step that points at nothing', () => {
    expect(TOUR_STEPS[0]?.target).toBeNull()
    expect(TOUR_STEPS[TOUR_STEPS.length - 1]?.target).toBeNull()
  })

  it('gives every cue a hint to show', () => {
    for (const step of TOUR_STEPS) {
      if (step.cue === undefined) continue
      expect(step.cue.hint.length, step.id).toBeGreaterThan(0)
    }
  })

  it('never arranges the state its own cue asks the user to reach', () => {
    // Otherwise the step satisfies itself on entry and flashes past.
    for (const step of TOUR_STEPS) {
      if (step.cue === undefined) continue
      const cue = step.cue.when
      for (const effect of step.arrange ?? []) {
        if (cue.kind === 'view' && effect.kind === 'view') {
          expect(effect.view, `${step.id} arranges its own cue`).not.toBe(cue.view)
        }
        if (cue.kind === 'comments') {
          expect(
            effect.kind === 'comments' && effect.visible,
            `${step.id} arranges its own cue`
          ).not.toBe(true)
        }
        if (cue.kind === 'panel' && cue.component === 'settings') {
          expect(effect.kind, `${step.id} arranges its own cue`).not.toBe('settings')
        }
      }
    }
  })

  it('covers each sidebar view exactly once', () => {
    // The tour is meant to be extensive without being repetitive: every view
    // gets one stop, and no view gets two.
    const cued = TOUR_STEPS.flatMap((s) =>
      s.cue !== undefined && s.cue.when.kind === 'view' ? [s.cue.when.view] : []
    )
    expect([...cued].sort()).toEqual(
      ['agent', 'explorer', 'figures', 'git', 'manuscript', 'references'].sort()
    )
    expect(new Set(cued).size).toBe(cued.length)
  })
})
