import { afterEach, describe, expect, it, vi } from 'vitest'
import { openaiProvider } from './openai'

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

describe('openaiProvider', () => {
  it('sends the exact chat/completions request shape with system as first message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { role: 'assistant', content: 'Hi there' } }] })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await openaiProvider.chat(
      {
        system: 'Be brief.',
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
          { role: 'user', content: 'c' }
        ]
      },
      { apiKey: 'sk-oa-test' }
    )

    expect(result).toEqual({ text: 'Hi there' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer sk-oa-test',
      'content-type': 'application/json'
    })
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' }
      ]
    })
  })

  it('honors model, maxTokens, and baseUrl overrides and omits empty system', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await openaiProvider.chat(
      { system: '', messages: [{ role: 'user', content: 'q' }], model: 'gpt-4o-mini', maxTokens: 64 },
      { apiKey: 'k', baseUrl: 'http://localhost:8080' }
    )

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/v1/chat/completions')
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'q' }],
      max_tokens: 64
    })
  })

  it('maps non-200 to an error carrying the API error.message, never the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } })
      )
    )
    const promise = openaiProvider.chat(
      { system: '', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'sk-oa-secret' }
    )
    await expect(promise).rejects.toThrow('openai request failed (HTTP 401): Incorrect API key provided')
    await promise.catch((error: unknown) => {
      expect(String(error)).not.toContain('sk-oa-secret')
    })
  })

  it('returns empty text when choices are missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})))
    const result = await openaiProvider.chat(
      { system: '', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'k' }
    )
    expect(result.text).toBe('')
  })

  it('rejects when no API key is provided', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      openaiProvider.chat({ system: '', messages: [{ role: 'user', content: 'hi' }] }, {})
    ).rejects.toThrow('openai: no API key configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
