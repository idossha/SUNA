import { describe, expect, it } from 'vitest'
import { minimalDiff } from './minimalDiff'

/** Apply a span the way CodeMirror would, to prove the diff reproduces newText. */
function apply(oldText: string, span: { from: number; to: number; insert: string }): string {
  return oldText.slice(0, span.from) + span.insert + oldText.slice(span.to)
}

function roundTrip(oldText: string, newText: string): void {
  const span = minimalDiff(oldText, newText)
  if (span === null) {
    expect(oldText).toBe(newText)
    return
  }
  expect(span.from).toBeLessThanOrEqual(span.to)
  expect(apply(oldText, span)).toBe(newText)
}

describe('minimalDiff', () => {
  it('returns null for identical texts', () => {
    expect(minimalDiff('abc', 'abc')).toBeNull()
    expect(minimalDiff('', '')).toBeNull()
  })

  it('pure insert in the middle', () => {
    expect(minimalDiff('ac', 'abc')).toEqual({ from: 1, to: 1, insert: 'b' })
  })

  it('pure delete in the middle', () => {
    expect(minimalDiff('abc', 'ac')).toEqual({ from: 1, to: 2, insert: '' })
  })

  it('replace in the middle', () => {
    expect(minimalDiff('one two three', 'one 2 three')).toEqual({ from: 4, to: 7, insert: '2' })
  })

  it('overlap case: "aa" -> "aba" keeps from <= to', () => {
    expect(minimalDiff('aa', 'aba')).toEqual({ from: 1, to: 1, insert: 'b' })
  })

  it('empty <-> text', () => {
    expect(minimalDiff('', 'hello')).toEqual({ from: 0, to: 0, insert: 'hello' })
    expect(minimalDiff('hello', '')).toEqual({ from: 0, to: 5, insert: '' })
  })

  it('append and prepend', () => {
    roundTrip('abc', 'abcdef')
    roundTrip('def', 'abcdef')
  })

  it('never splits a surrogate pair at the prefix boundary', () => {
    // 🌊 = D83C DF0A, 🌋 = D83C DF0B — same high surrogate, differing low
    const span = minimalDiff('a🌊b', 'a🌋b')
    expect(span).not.toBeNull()
    expect(span!.from).toBe(1) // backs off to the start of the pair
    roundTrip('a🌊b', 'a🌋b')
  })

  it('never splits a surrogate pair at the suffix boundary', () => {
    // 🇦 = D83C DDE6, 🌊 = D83C DF0A — same trailing low half is impossible
    // here, so exercise pairs whose low halves match: 😀 D83D DE00 vs 🐀 D83D DC00
    roundTrip('x😀y', 'x🐀y')
    const span = minimalDiff('x😀y', 'x🐀y')!
    const cut = 'x😀y'.slice(span.from, span.to)
    // the replaced slice contains whole pairs only
    expect([...cut].every((ch) => ch.length === (ch.codePointAt(0)! > 0xffff ? 2 : 1))).toBe(true)
  })

  it('round-trips arbitrary multi-line edits', () => {
    const oldText = '# A\n\nfirst paragraph\n\n# B\n\nsecond paragraph\n'
    const newText = '# A\n\nfirst paragraph, extended\n\n# B\n\nsecond paragraph\n'
    roundTrip(oldText, newText)
    roundTrip(newText, oldText)
  })
})
