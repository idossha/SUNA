import { describe, expect, it } from 'vitest'
import type { Comment } from '@suna/core'
import { commentsByPath, filteredComments } from './comments'

function comment(overrides: Partial<Comment> & Pick<Comment, 'id'>): Comment {
  return {
    target: {
      kind: 'section',
      path: 'sections/01-intro.md',
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

describe('filteredComments', () => {
  const list: Comment[] = [
    comment({ id: 'c1', resolved: false, author: { kind: 'human', name: 'Ada' } }),
    comment({ id: 'c2', resolved: true, author: { kind: 'human', name: 'Ada' } }),
    comment({ id: 'c3', resolved: false, author: { kind: 'agent', name: 'Claude Code' } })
  ]

  it('"all" returns every comment, unfiltered', () => {
    expect(filteredComments(list, 'all', 'Ada').map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('"open" returns only unresolved comments', () => {
    expect(filteredComments(list, 'open', 'Ada').map((c) => c.id)).toEqual(['c1', 'c3'])
  })

  it('"resolved" returns only resolved comments', () => {
    expect(filteredComments(list, 'resolved', 'Ada').map((c) => c.id)).toEqual(['c2'])
  })

  it('"mine" matches the given human author name and excludes agent comments', () => {
    expect(filteredComments(list, 'mine', 'Ada').map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(filteredComments(list, 'mine', 'Bob')).toEqual([])
  })

  it('does not mutate the input array', () => {
    const copy = [...list]
    filteredComments(list, 'open', 'Ada')
    expect(list).toEqual(copy)
  })
})

describe('commentsByPath', () => {
  it('groups section-target comments by path, preserving order', () => {
    const list: Comment[] = [
      comment({
        id: 'c1',
        target: { kind: 'section', path: 'sections/a.md', anchor: { quote: 'q1', prefix: '', suffix: '' } }
      }),
      comment({
        id: 'c2',
        target: { kind: 'section', path: 'sections/b.md', anchor: { quote: 'q2', prefix: '', suffix: '' } }
      }),
      comment({
        id: 'c3',
        target: { kind: 'section', path: 'sections/a.md', anchor: { quote: 'q3', prefix: '', suffix: '' } }
      })
    ]
    const grouped = commentsByPath(list)
    expect(grouped.get('sections/a.md')?.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(grouped.get('sections/b.md')?.map((c) => c.id)).toEqual(['c2'])
  })

  it('excludes figure- and manuscript-target comments', () => {
    const list: Comment[] = [
      comment({ id: 'c1', target: { kind: 'manuscript' } }),
      comment({ id: 'c2', target: { kind: 'figure', figureId: 'fig-1' } })
    ]
    expect(commentsByPath(list).size).toBe(0)
  })
})
