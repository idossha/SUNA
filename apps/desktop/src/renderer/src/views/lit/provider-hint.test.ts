import { describe, expect, it } from 'vitest'
import { LIT_PROVIDER_IDS } from '@suna/core'
import { suggestionFor } from './provider-hint'

describe('suggestionFor', () => {
  it('points every non-Crossref provider back at Crossref and Settings', () => {
    for (const provider of LIT_PROVIDER_IDS) {
      if (provider === 'crossref') continue
      const text = suggestionFor(provider)
      expect(text).toContain('Crossref')
      expect(text).toContain('Settings')
    }
  })

  it('gives Crossref itself a retry hint, not a self-referential suggestion', () => {
    const text = suggestionFor('crossref')
    expect(text.toLowerCase()).not.toContain('try crossref')
  })

  it('covers every provider id with no throw', () => {
    for (const provider of LIT_PROVIDER_IDS) {
      expect(() => suggestionFor(provider)).not.toThrow()
    }
  })
})
