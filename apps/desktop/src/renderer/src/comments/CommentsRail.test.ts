import { describe, expect, it } from 'vitest'
import type { Comment } from '@suna/core'
import { commentThreadEntries, surroundingText } from './CommentsRail'

/**
 * The pure halves of the comment card's ✦ AI button (DECISIONS 2026-08-17):
 * the ±400-char context slice and the thread flattening the prompt template
 * renders as "author (when): body" lines. The click handler itself needs a
 * live EditorView and the IPC bridge — its anchor-snapshot idiom is the same
 * one toggleResolved uses and is exercised by the e2e probes instead.
 */

describe('surroundingText', () => {
  const text = 'abcdefghij'

  it('slices radius chars each side of the range', () => {
    expect(surroundingText(text, 4, 6, 2)).toBe('cdefgh')
  })

  it('clamps at the start — a small `from` must not wrap to a negative index', () => {
    // slice(-…) counts from the END; unclamped this would return 'j' + head
    expect(surroundingText(text, 1, 2, 5)).toBe('abcdefg')
  })

  it('clamps at the end', () => {
    expect(surroundingText(text, 8, 9, 5)).toBe('defghij')
  })

  it('always contains the range itself', () => {
    expect(surroundingText(text, 3, 7, 0)).toBe('defg')
  })

  it('defaults to the 400-char radius of the plan', () => {
    const long = 'x'.repeat(2000)
    expect(surroundingText(long, 1000, 1010)).toHaveLength(400 + 10 + 400)
    expect(surroundingText(long, 0, 10)).toHaveLength(10 + 400)
  })
})

describe('commentThreadEntries', () => {
  const base: Comment = {
    id: 'c-2026-08-17-abc',
    target: {
      kind: 'section',
      path: 'manuscript.md',
      anchor: { quote: 'q', prefix: 'p', suffix: 's' }
    },
    body: 'Tighten this claim.',
    author: { kind: 'human', name: 'Ido' },
    createdAt: '2026-08-17T10:00:00.000Z',
    resolved: false,
    detached: false,
    replies: [
      {
        id: 'r-2026-08-17-def',
        body: 'Which claim exactly?',
        author: { kind: 'agent', name: 'Agent', model: 'claude-opus-4' },
        createdAt: '2026-08-17T10:05:00.000Z'
      },
      {
        id: 'r-2026-08-17-ghi',
        body: 'The second sentence.',
        author: { kind: 'agent', name: 'Agent' },
        createdAt: '2026-08-17T10:06:00.000Z'
      }
    ]
  }

  it('puts the comment first, then replies in order, timestamps verbatim', () => {
    expect(commentThreadEntries(base)).toEqual([
      { author: 'Ido', when: '2026-08-17T10:00:00.000Z', body: 'Tighten this claim.' },
      {
        author: 'claude-opus-4',
        when: '2026-08-17T10:05:00.000Z',
        body: 'Which claim exactly?'
      },
      { author: 'Agent', when: '2026-08-17T10:06:00.000Z', body: 'The second sentence.' }
    ])
  })

  it('names agents by model, falling back to name — the AuthorBadge rule', () => {
    const entries = commentThreadEntries(base)
    expect(entries[1]?.author).toBe('claude-opus-4')
    expect(entries[2]?.author).toBe('Agent')
  })

  it('a bare comment yields exactly one entry', () => {
    expect(commentThreadEntries({ ...base, replies: [] })).toHaveLength(1)
  })
})
