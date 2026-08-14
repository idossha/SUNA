import { describe, expect, it } from 'vitest'
import { anthropicProvider, getProvider, ollamaProvider, openaiProvider } from './index'

describe('getProvider', () => {
  it('returns the registered adapter for each provider id', () => {
    expect(getProvider('anthropic')).toBe(anthropicProvider)
    expect(getProvider('openai')).toBe(openaiProvider)
    expect(getProvider('ollama')).toBe(ollamaProvider)
  })

  it('adapters carry their own ids', () => {
    expect(anthropicProvider.id).toBe('anthropic')
    expect(openaiProvider.id).toBe('openai')
    expect(ollamaProvider.id).toBe('ollama')
  })
})
