import { describe, expect, it } from 'vitest'
import { hunksFor } from './revisionDiff'

/**
 * `hunksFor` is what the review view paints and what accept/reject act on, so
 * two invariants matter more than any single case: a hunk's baseline range
 * must really hold the text it claims was removed, and its document range must
 * really hold the text that replaced it. Both are asserted everywhere below.
 */
function check(base: string, doc: string): ReturnType<typeof hunksFor> {
  const hunks = hunksFor(base, doc)
  let lastTo = -1
  for (const hunk of hunks) {
    expect(base.slice(hunk.baseFrom, hunk.baseTo)).toBe(hunk.removed)
    expect(hunk.to).toBeGreaterThanOrEqual(hunk.from)
    expect(hunk.to).toBeLessThanOrEqual(doc.length)
    expect(hunk.from).toBeGreaterThanOrEqual(lastTo)
    // a hunk must actually be a change
    expect(hunk.removed.length > 0 || hunk.to > hunk.from).toBe(true)
    lastTo = hunk.to
  }
  return hunks
}

describe('hunksFor', () => {
  it('reports nothing when the AI changed nothing', () => {
    expect(hunksFor('same text', 'same text')).toEqual([])
  })

  it('pairs a removal with the addition that replaced it as ONE hunk', () => {
    const base = 'The result was significant at 3 sigma.'
    const doc = 'The result was marginal at 3 sigma.'
    const hunks = check(base, doc)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.removed).toBe('significant')
    expect(doc.slice(hunks[0]!.from, hunks[0]!.to)).toBe('marginal')
  })

  it('reports a pure addition with no removed text', () => {
    const base = 'We find no correlation.'
    const doc = 'We find no significant correlation.'
    const hunks = check(base, doc)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.removed).toBe('')
    expect(doc.slice(hunks[0]!.from, hunks[0]!.to)).toBe(' significant')
  })

  it('reports a pure removal as a zero-width range carrying the words', () => {
    const base = 'We find no significant correlation.'
    const doc = 'We find no correlation.'
    const hunks = check(base, doc)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.from).toBe(hunks[0]!.to)
    expect(hunks[0]!.removed).toBe(' significant')
  })

  it('keeps two edits in one document as two separate hunks', () => {
    const base = 'alpha beta gamma delta epsilon'
    const doc = 'alpha BETA gamma delta EPSILON'
    const hunks = check(base, doc)
    expect(hunks).toHaveLength(2)
    expect(hunks.map((h) => h.removed)).toEqual(['beta', 'epsilon'])
  })

  it('marks only the changed word, not the sentence around it', () => {
    const base = 'a centroid of 6563.3 A was measured'
    const doc = 'a centroid of 6562.8 A was measured'
    const hunks = check(base, doc)
    // 6563 -> 6562 and 3 -> 8, punctuation being its own token
    expect(hunks.every((h) => h.to - h.from <= 4)).toBe(true)
    expect(hunks.map((h) => doc.slice(h.from, h.to)).join('|')).toBe('6562|8')
  })

  it('handles a whole paragraph the AI inserted', () => {
    const base = 'First para.\n\nThird para.\n'
    const doc = 'First para.\n\nSecond para.\n\nThird para.\n'
    const hunks = check(base, doc)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.removed).toBe('')
    expect(doc.slice(hunks[0]!.from, hunks[0]!.to)).toContain('Second para.')
  })

  it('survives the author having rewritten the AI text since', () => {
    // The point of deriving hunks instead of storing them: the base is old,
    // the document has moved on, and the answer is still well-formed.
    const base = 'one two three four five'
    check(base, 'one TWO three FOUR five')
    check(base, 'completely different prose entirely')
    check(base, '')
    check('', 'all new')
  })

  it('handles an empty document and an empty baseline', () => {
    expect(hunksFor('', '')).toEqual([])
    const added = check('', 'brand new')
    expect(added).toHaveLength(1)
    expect(added[0]!.removed).toBe('')
    const cleared = check('was here', '')
    expect(cleared).toHaveLength(1)
    expect(cleared[0]!.removed).toBe('was here')
  })
})
