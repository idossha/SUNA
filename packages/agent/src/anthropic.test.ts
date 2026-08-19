import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANTHROPIC_MODEL_IDS, anthropicModelId, anthropicProvider } from './anthropic'

function jsonResponse(status: number, body: unknown): { ok: boolean; status: number; text: () => Promise<string> } {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('anthropicProvider', () => {
  it('sends the exact Messages API request shape with defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { content: [{ type: 'text', text: 'Hello' }] })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await anthropicProvider.chat(
      { system: 'You are terse.', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'sk-test-123' }
    )

    expect(result).toEqual({ text: 'Hello' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'x-api-key': 'sk-test-123',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    })
    expect(JSON.parse(init.body)).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: 'You are terse.',
      messages: [{ role: 'user', content: 'hi' }]
    })
  })

  it('honors model, maxTokens, and baseUrl overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { content: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await anthropicProvider.chat(
      {
        system: 's',
        messages: [{ role: 'user', content: 'q' }],
        model: 'claude-opus-5',
        maxTokens: 128
      },
      { apiKey: 'k', baseUrl: 'https://proxy.example' }
    )

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://proxy.example/v1/messages')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-opus-5')
    expect(body.max_tokens).toBe(128)
  })

  it('concatenates only text blocks from content[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} },
            { type: 'text', text: ' world' }
          ]
        })
      )
    )
    const result = await anthropicProvider.chat(
      { system: '', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'k' }
    )
    expect(result.text).toBe('Hello world')
  })

  it('maps non-200 to an error carrying the API error.message, never the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'max_tokens is required' }
        })
      )
    )
    const promise = anthropicProvider.chat(
      { system: '', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'sk-super-secret' }
    )
    await expect(promise).rejects.toThrow('anthropic request failed (HTTP 400): max_tokens is required')
    await promise.catch((error: unknown) => {
      expect(String(error)).not.toContain('sk-super-secret')
    })
  })

  it('sends the effort as output_config, and omits it when unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { content: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await anthropicProvider.chat(
      { system: 's', messages: [{ role: 'user', content: 'q' }], effort: 'low' },
      { apiKey: 'k' }
    )
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).output_config).toEqual({ effort: 'low' })

    await anthropicProvider.chat({ system: 's', messages: [{ role: 'user', content: 'q' }] }, { apiKey: 'k' })
    expect('output_config' in JSON.parse(fetchMock.mock.calls[1]![1].body)).toBe(false)
  })

  it('rejects when no API key is provided', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      anthropicProvider.chat({ system: '', messages: [{ role: 'user', content: 'hi' }] }, {})
    ).rejects.toThrow('anthropic: no API key configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('anthropicModelId', () => {
  it('maps every tier the settings surface can hold', () => {
    expect(anthropicModelId('opus')).toBe(ANTHROPIC_MODEL_IDS.opus)
    expect(anthropicModelId('sonnet')).toBe('claude-sonnet-5')
    expect(anthropicModelId('haiku')).toBe(ANTHROPIC_MODEL_IDS.haiku)
  })

  it('falls back to the shipped default tier, which is what the provider sends bare', () => {
    expect(anthropicModelId(undefined)).toBe('claude-sonnet-5')
  })
})
