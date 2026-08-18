import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { Comment } from '@suna/core'
import {
  ANCHOR_VIEWPORT_FRACTION,
  anchorScrollDelta,
  anchorYMargin,
  commentHighlightExtension,
  liveAnchors,
  setActiveComment,
  setSectionComments
} from './anchorExtension'

/**
 * Headless tests of the mapped-StateField anchor model: anchors are located
 * with locate() only on setSectionComments and MAPPED through document
 * changes in between. EditorState works without a DOM (only EditorView
 * needs one), so the fields are testable directly.
 */

function comment(id: string, quote: string, prefix = '', suffix = ''): Comment {
  return {
    id,
    target: { kind: 'section', path: 'manuscript.md', anchor: { quote, prefix, suffix } },
    body: 'b',
    author: { kind: 'human', name: 'Ada' },
    createdAt: '2026-08-16T00:00:00.000Z',
    resolved: false,
    detached: false,
    replies: []
  }
}

function stateWith(doc: string): EditorState {
  return EditorState.create({ doc, extensions: commentHighlightExtension(() => undefined) })
}

describe('anchor StateField', () => {
  it('locates anchors when the comment list is set', () => {
    let state = stateWith('one two three')
    state = state.update({ effects: setSectionComments.of([comment('c1', 'two')]) }).state
    expect(liveAnchors(state)).toEqual([{ id: 'c1', from: 4, to: 7 }])
  })

  it('maps anchors through edits instead of re-locating', () => {
    let state = stateWith('one two three')
    state = state.update({ effects: setSectionComments.of([comment('c1', 'two')]) }).state
    // insert before the anchor: the range shifts by the insert length
    state = state.update({ changes: { from: 0, insert: 'zero ' } }).state
    expect(liveAnchors(state)).toEqual([{ id: 'c1', from: 9, to: 12 }])
  })

  it('drops an anchor whose quoted text is deleted', () => {
    let state = stateWith('keep DELETE keep')
    state = state.update({ effects: setSectionComments.of([comment('c1', 'DELETE')]) }).state
    state = state.update({ changes: { from: 5, to: 12, insert: '' } }).state
    expect(liveAnchors(state)).toEqual([])
  })

  it('sorts anchors by position and keeps ids distinct', () => {
    let state = stateWith('alpha beta gamma')
    state = state
      .update({
        effects: setSectionComments.of([comment('late', 'gamma'), comment('early', 'alpha')])
      })
      .state
    expect(liveAnchors(state).map((a) => a.id)).toEqual(['early', 'late'])
  })

  it('re-locating on a fresh list replaces mapped positions', () => {
    let state = stateWith('one two')
    state = state.update({ effects: setSectionComments.of([comment('c1', 'two')]) }).state
    state = state.update({ effects: setSectionComments.of([comment('c2', 'one')]) }).state
    expect(liveAnchors(state)).toEqual([{ id: 'c2', from: 0, to: 3 }])
  })

  it('tracks the active id via its effect', () => {
    let state = stateWith('one two')
    state = state.update({ effects: setSectionComments.of([comment('c1', 'two')]) }).state
    // no direct accessor for the active field; assert through the decoration
    // rebuild not throwing and the effect round-tripping
    state = state.update({ effects: setActiveComment.of('c1') }).state
    state = state.update({ effects: setActiveComment.of(null) }).state
    expect(liveAnchors(state)).toHaveLength(1)
  })
})

describe('anchor boundary mapping', () => {
  it('excludes text inserted exactly at an anchor boundary (mark parity)', () => {
    let state = stateWith('one two three')
    state = state.update({ effects: setSectionComments.of([comment('c1', 'two')]) }).state
    state = state.update({ changes: { from: 4, insert: 'X' } }).state
    expect(liveAnchors(state)).toEqual([{ id: 'c1', from: 5, to: 8 }])
    state = state.update({ changes: { from: 8, insert: 'Y' } }).state
    expect(liveAnchors(state)).toEqual([{ id: 'c1', from: 5, to: 8 }])
  })
})

describe('anchorYMargin', () => {
  it('lands the anchor 10% above the middle of a bare scrollport', () => {
    // 40% of 1000 — dead centre would be 500
    expect(anchorYMargin(1000, 0)).toBe(400)
  })

  it('measures the fraction inside the READABLE height, below sticky chrome', () => {
    // 40px toolbar: readable is 960, so 40 + 384
    expect(anchorYMargin(1000, 40)).toBe(424)
    // and that is still 10% above the readable middle (40 + 480 = 520)
    expect(anchorYMargin(1000, 40)).toBe(40 + 960 / 2 - 960 * 0.1)
  })

  it('never returns a negative or inset-crossing margin when chrome exceeds the port', () => {
    expect(anchorYMargin(30, 40)).toBe(40)
  })

  it('is the same fraction whatever the viewport height — the consistency rule', () => {
    for (const h of [400, 900, 1600]) {
      expect(anchorYMargin(h, 0) / h).toBeCloseTo(ANCHOR_VIEWPORT_FRACTION, 10)
    }
  })
})

describe('anchorScrollDelta', () => {
  // a 1000px port with a 40px sticky toolbar: the target line is at y=424
  const target = 424

  it('is zero when the block already sits on the target line', () => {
    expect(anchorScrollDelta(target, 0, 1000, 40)).toBe(0)
  })

  it('scrolls down (positive) for a block below the target', () => {
    expect(anchorScrollDelta(target + 300, 0, 1000, 40)).toBe(300)
  })

  it('scrolls up (negative) for a block above the target', () => {
    expect(anchorScrollDelta(target - 120, 0, 1000, 40)).toBe(-120)
  })

  it('measures against the port, not the window — an offset port shifts the target with it', () => {
    expect(anchorScrollDelta(target + 200, 200, 1000, 40)).toBe(0)
  })

  it('converges: applying the delta puts the block exactly on target', () => {
    // the pin loop applies delta to scrollTop, which moves the block by -delta
    let blockTop = 1700
    for (let i = 0; i < 3; i++) blockTop -= anchorScrollDelta(blockTop, 0, 1000, 40)
    expect(blockTop).toBe(target)
  })

  it('re-corrects by exactly the amount the document shifted under it', () => {
    // a figure above the anchor finishes loading and adds 275px
    const drifted = target + 275
    expect(anchorScrollDelta(drifted, 0, 1000, 40)).toBe(275)
  })
})
