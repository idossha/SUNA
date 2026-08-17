import { describe, expect, it } from 'vitest'
import type { Comment } from '@suna/core'
import { commentsByPath } from './comments'

function comment(overrides: Partial<Comment> & Pick<Comment, 'id'>): Comment {
  return {
    target: {
      kind: 'section',
      path: 'manuscript.md',
      anchor: { quote: 'q', prefix: '', suffix: '' }
    },
    body: 'body',
    author: { kind: 'human', name: 'Ada' },
    createdAt: '2026-08-14T00:00:00.000Z',
    resolved: false,
    detached: false,
    replies: [],
    ...overrides
  }
}

describe('commentsByPath', () => {
  it('groups section-target comments by path, preserving order', () => {
    const list: Comment[] = [
      comment({
        id: 'c1',
        target: { kind: 'section', path: 'manuscript.md', anchor: { quote: 'q1', prefix: '', suffix: '' } }
      }),
      comment({
        id: 'c2',
        target: { kind: 'section', path: 'other.md', anchor: { quote: 'q2', prefix: '', suffix: '' } }
      }),
      comment({
        id: 'c3',
        target: { kind: 'section', path: 'manuscript.md', anchor: { quote: 'q3', prefix: '', suffix: '' } }
      })
    ]
    const grouped = commentsByPath(list)
    expect(grouped.get('manuscript.md')?.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(grouped.get('other.md')?.map((c) => c.id)).toEqual(['c2'])
  })

  it('excludes figure- and manuscript-target comments', () => {
    const list: Comment[] = [
      comment({ id: 'c1', target: { kind: 'manuscript' } }),
      comment({ id: 'c2', target: { kind: 'figure', figureId: 'fig-1' } })
    ]
    expect(commentsByPath(list).size).toBe(0)
  })
})
