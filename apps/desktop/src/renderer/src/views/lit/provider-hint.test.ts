import { describe, expect, it } from 'vitest'
import { LIT_PROVIDER_IDS, UI_LIT_PROVIDER_IDS } from '@suna/core'
import { hintFor, suggestionFor } from './provider-hint'

describe('suggestionFor', () => {
  it('points every non-Crossref HTTP provider back at Crossref and Settings', () => {
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

  it('points an ai-cli failure at Crossref and at checking the CLI install, not at Settings keys', () => {
    const text = suggestionFor('ai-cli')
    expect(text).toContain('Crossref')
    expect(text).toMatch(/Claude Code|Codex/)
  })

  it('covers every UI provider id with no throw', () => {
    for (const provider of UI_LIT_PROVIDER_IDS) {
      expect(() => suggestionFor(provider)).not.toThrow()
    }
  })
})

describe('hintFor', () => {
  it('gives ai-cli the subscription/latency hint from feature-plan-3 §2', () => {
    expect(hintFor('ai-cli')).toBe('uses your Claude/Codex subscription · ~30–60s')
  })

  it('gives every HTTP provider its short cost/key hint', () => {
    expect(hintFor('crossref')).toBe('free, no key')
    expect(hintFor('openalex')).toBe('metered')
    expect(hintFor('biorxiv')).toBe('free, preprints')
  })

  it('covers every UI provider id with a non-empty hint', () => {
    for (const provider of UI_LIT_PROVIDER_IDS) {
      expect(hintFor(provider).length).toBeGreaterThan(0)
    }
  })
})
