import { describe, expect, it, vi } from 'vitest'
import type { CoverLetterMeta } from '@suna/core'
import { buildLetterHtml, letterBlocks, stripLetterDirectives } from './export-letter'

/** Same reason as export-notes.test: no BrowserWindow, no printed PDF. */
vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: () => '/tmp' }
}))

function meta(overrides: Partial<CoverLetterMeta> = {}): CoverLetterMeta {
  return {
    documentId: 'cover-science',
    letterKind: 'submission',
    targetProfileId: 'science',
    assertions: [],
    ...overrides
  } as CoverLetterMeta
}

describe('stripLetterDirectives', () => {
  it('puts the author’s own sentence where the directive is', () => {
    const text = 'Before.\n\n::assert{competingInterests}\n\nAfter.'
    const out = stripLetterDirectives(
      text,
      meta({
        assertions: [
          {
            id: 'competingInterests',
            placement: 'directive',
            text: 'The authors declare no competing interests.',
            reason: null
          }
        ]
      })
    )
    expect(out).toContain('The authors declare no competing interests.')
    expect(out).not.toContain('::assert')
  })

  it('drops an assertion the author routed to the submission form', () => {
    const out = stripLetterDirectives(
      '::assert{competingInterests}',
      meta({
        assertions: [
          {
            id: 'competingInterests',
            placement: 'submission-form',
            text: 'Declared in the portal.',
            reason: null
          }
        ]
      })
    )
    expect(out.trim()).toBe('')
  })

  it('leaves nothing behind for an assertion with no answer at all', () => {
    expect(stripLetterDirectives('::assert{competingInterests}', meta()).trim()).toBe('')
  })
})

describe('letterBlocks', () => {
  it('strips the seeded HTML comment — it is a note to the author, not the editor', () => {
    const blocks = letterBlocks('Dear Editor,\n\n<!-- write the case here -->\n\nSincerely,')
    expect(blocks.map((b) => b.text)).toEqual(['Dear Editor,', 'Sincerely,'])
  })

  it('reads ATX headings as headings and everything else as paragraphs', () => {
    const blocks = letterBlocks('## Related work\n\nOne paragraph.')
    expect(blocks[0]).toEqual({ kind: 'heading', level: 2, text: 'Related work' })
    expect(blocks[1]?.kind).toBe('paragraph')
  })
})

describe('buildLetterHtml', () => {
  it('escapes the prose rather than letting it become markup', () => {
    const html = buildLetterHtml('Cover letter', 'submission · addressed to Science', [
      { kind: 'paragraph', level: 0, text: '5 < 6 & "quoted"' }
    ])
    expect(html).toContain('5 &lt; 6 &amp; &quot;quoted&quot;')
    expect(html).toContain('addressed to Science')
  })
})

describe('stripLetterDirectives with a stale marker', () => {
  it('clears the marker for an answered assertion', () => {
    const out = stripLetterDirectives(
      '⟦ unanswered — competingInterests ⟧ ::assert{competingInterests}',
      meta({
        assertions: [
          { id: 'competingInterests', placement: 'directive', text: 'None declared.', reason: null }
        ]
      })
    )
    expect(out.trim()).toBe('None declared.')
    expect(out).not.toContain('unanswered')
  })
})

describe('stripLetterDirectives with nothing answered', () => {
  it('leaves no marker and no directive behind', () => {
    // The export writes the author's letter WITHOUT the missing sentences —
    // never a marker, and never an invented sentence. There is no gate.
    const out = stripLetterDirectives(
      'Dear Editor,\n\n⟦ unanswered — competingInterests ⟧ ::assert{competingInterests}\n\nSincerely,',
      meta()
    )
    expect(out).not.toContain('unanswered')
    expect(out).not.toContain('::assert')
    expect(out).toContain('Dear Editor,')
    expect(out).toContain('Sincerely,')
  })
})
