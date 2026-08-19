import { describe, expect, it } from 'vitest'
import { describeIpcFailure, notesAsMarkdown } from './ReadingNotesTab'

/**
 * The pure halves of the cross-paper reading notes tab (ADR-008).
 */

describe('describeIpcFailure', () => {
  it('names the real fix for a channel the main process does not know', () => {
    // Electron's main process does not hot-swap, so this is a stale process
    // rather than a bug — and the raw message says nothing about restarting.
    const text = describeIpcFailure(
      new Error("Error invoking remote method 'refnotes:list-all': No handler registered")
    )
    expect(text).toContain('restart')
    expect(text).not.toContain('No handler registered')
  })

  it('passes any other failure through, rather than guessing', () => {
    expect(describeIpcFailure(new Error('EACCES: permission denied'))).toContain(
      'EACCES: permission denied'
    )
  })

  it('survives a thrown value that is not an Error', () => {
    expect(describeIpcFailure('something odd')).toContain('something odd')
  })
})

describe('notesAsMarkdown', () => {
  const group = {
    citekey: 'gunn1972',
    entry: undefined,
    notes: [
      {
        id: 'n1',
        color: 'green' as const,
        runs: [{ page: 3, quote: 'Ram pressure strips the gas.', prefix: '', suffix: '', detached: false }],
        body: 'Cite in the intro.',
        tags: [],
        author: { kind: 'human' as const, name: 'You' },
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
        ambiguous: false,
        embed: []
      }
    ]
  }

  it('writes a literature note that cites every passage', () => {
    const md = notesAsMarkdown([group])
    expect(md).toContain('# Reading notes')
    expect(md).toContain('[@gunn1972]')
    expect(md).toContain('Ram pressure strips the gas [@gunn1972, p. 3].')
    expect(md).toContain('Cite in the intro.')
  })

  it('is empty-safe', () => {
    expect(notesAsMarkdown([])).toBe('# Reading notes\n')
  })
})
