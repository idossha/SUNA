import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { Comment } from '@suna/core'
import {
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
