import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@suna/formatter'
import { splitDiagnosticSources } from './diagSources'

function diag(message: string): Diagnostic {
  return { id: 'ms.test', severity: 'error', surface: 'manuscript', message }
}

describe('splitDiagnosticSources', () => {
  it('strips the trailing source citation from a message', () => {
    const { rows } = splitDiagnosticSources([
      diag('Required section "Discussion" is missing (per https://www.jneurosci.org/content/information-authors)'),
    ])
    expect(rows[0]?.message).toBe('Required section "Discussion" is missing')
  })

  it('collects each distinct source once, in first-seen order', () => {
    const { sources } = splitDiagnosticSources([
      diag('a (per https://example.org/one)'),
      diag('b (per https://example.org/one)'),
      diag('c (per https://example.org/two)'),
    ])
    expect(sources).toEqual(['https://example.org/one', 'https://example.org/two'])
  })

  it('leaves a message with no source, or a non-URL parenthetical, untouched', () => {
    const { rows, sources } = splitDiagnosticSources([
      diag('Figure 2 is never referenced in the text'),
      diag('Abstract is 250 words (per the article type it is 200)'),
    ])
    expect(rows.map((r) => r.message)).toEqual([
      'Figure 2 is never referenced in the text',
      'Abstract is 250 words (per the article type it is 200)',
    ])
    expect(sources).toEqual([])
  })
})
