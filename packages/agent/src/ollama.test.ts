import { afterEach, describe, expect, it, vi } from 'vitest'
import { ollamaProvider } from './ollama'

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

describe('ollamaProvider', () => {
  it('sends a non-streaming /api/chat request with system as first message; no key needed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { message: { role: 'assistant', content: 'Local hello' }, done: true })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await ollamaProvider.chat(
      { system: 'Be helpful.', messages: [{ role: 'user', content: 'hi' }] },
      {}
    )

    expect(result).toEqual({ text: 'Local hello' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:11434/api/chat')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      model: 'llama3.2',
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'hi' }
      ],
      stream: false
    })
  })

  it('honors model, maxTokens (options.num_predict), and baseUrl overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { message: { content: '' } }))
    vi.stubGlobal('fetch', fetchMock)

    await ollamaProvider.chat(
      { system: '', messages: [{ role: 'user', content: 'q' }], model: 'qwen3', maxTokens: 256 },
      { baseUrl: 'http://ollama.lan:11434' }
    )

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://ollama.lan:11434/api/chat')
    expect(JSON.parse(init.body)).toEqual({
      model: 'qwen3',
      messages: [{ role: 'user', content: 'q' }],
      stream: false,
      options: { num_predict: 256 }
    })
  })

  it('maps non-200 to an error carrying the API error string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { error: "model 'nope' not found" }))
    )
    await expect(
      ollamaProvider.chat({ system: '', messages: [{ role: 'user', content: 'hi' }] }, {})
    ).rejects.toThrow("ollama request failed (HTTP 404): model 'nope' not found")
  })

  it('maps network failures to a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(
      ollamaProvider.chat({ system: '', messages: [{ role: 'user', content: 'hi' }] }, {})
    ).rejects.toThrow('ollama: request to http://127.0.0.1:11434/api/chat failed: fetch failed')
  })
})
