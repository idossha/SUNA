import { describe, expect, it } from 'vitest'
import type { Comment } from '@suna/core'
import { OUTLINE_COLLAPSE_THRESHOLD, outlineEntries, outlineStartsCollapsed } from './outline'

function make(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    target: {
      kind: 'section',
      path: 'manuscript.md',
      anchor: { quote: `quote ${id}`, prefix: '', suffix: '' }
    },
    body: `body ${id}`,
    author: { kind: 'human', name: 'Ido' },
    createdAt: '2026-08-17T10:00:00.000Z',
    resolved: false,
    detached: false,
    replies: [],
    ...over
  } as Comment
}

describe('outlineEntries', () => {
  it('is chronological, oldest first, and numbered from 1', () => {
    const entries = outlineEntries([
      make('b', { createdAt: '2026-08-17T12:00:00.000Z' }),
      make('a', { createdAt: '2026-08-17T09:00:00.000Z' })
    ])
    expect(entries.map((e) => [e.id, e.index])).toEqual([
      ['a', 1],
      ['b', 2]
    ])
  })

  it('breaks timestamp ties by id so the order never flickers', () => {
    const entries = outlineEntries([make('z'), make('a')])
    expect(entries.map((e) => e.id)).toEqual(['a', 'z'])
  })

  it('leaves resolved threads out — History owns those', () => {
    const entries = outlineEntries([make('a'), make('b', { resolved: true })])
    expect(entries.map((e) => e.id)).toEqual(['a'])
  })

  it('labels with the anchored quote, and with the body when there is none', () => {
    const [quoted, plain] = outlineEntries([
      make('a'),
      make('b', {
        createdAt: '2026-08-17T11:00:00.000Z',
        target: { kind: 'figure', figureId: 'fig-1' }
      })
    ])
    expect(quoted?.label).toBe('quote a')
    expect(plain?.label).toBe('body b')
  })

  it('flattens whitespace and truncates a long label', () => {
    const entry = outlineEntries([
      make('a', {
        target: {
          kind: 'section',
          path: 'manuscript.md',
          anchor: { quote: `  multi\n line ${'x'.repeat(100)}`, prefix: '', suffix: '' }
        }
      })
    ])[0]
    expect(entry?.label).not.toContain('\n')
    expect(entry?.label.length).toBeLessThanOrEqual(52)
    expect(entry?.label.endsWith('…')).toBe(true)
  })

  it('carries the reply count and the detached flag for the row', () => {
    const entry = outlineEntries([
      make('a', {
        detached: true,
        replies: [
          {
            id: 'r1',
            body: 'x',
            author: { kind: 'human', name: 'Ido' },
            createdAt: '2026-08-17T10:01:00.000Z'
          }
        ]
      })
    ])[0]
    expect(entry?.replies).toBe(1)
    expect(entry?.detached).toBe(true)
  })
})

describe('outlineStartsCollapsed', () => {
  it('stays open up to the threshold and collapses past it', () => {
    expect(outlineStartsCollapsed(OUTLINE_COLLAPSE_THRESHOLD)).toBe(false)
    expect(outlineStartsCollapsed(OUTLINE_COLLAPSE_THRESHOLD + 1)).toBe(true)
  })
})
