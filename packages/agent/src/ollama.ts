import type { ChatRequest, ChatResult, Provider, ProviderChatOptions } from './types'
import { postJson } from './http'

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_MODEL = 'llama3.2'

/** Fetch-based adapter for the Ollama chat API (non-streaming). No key required. */
export const ollamaProvider: Provider = {
  id: 'ollama',
  async chat(req: ChatRequest, opts: ProviderChatOptions): Promise<ChatResult> {
    const messages: { role: string; content: string }[] = []
    if (req.system !== '') messages.push({ role: 'system', content: req.system })
    messages.push(...req.messages)
    const data = await postJson({
      provider: 'ollama',
      url: `${opts.baseUrl ?? DEFAULT_BASE_URL}/api/chat`,
      headers: { 'content-type': 'application/json' },
      body: {
        model: req.model ?? DEFAULT_MODEL,
        messages,
        stream: false,
        ...(req.maxTokens !== undefined ? { options: { num_predict: req.maxTokens } } : {})
      }
    })
    return { text: extractMessageContent(data) }
  }
}

function extractMessageContent(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const message = (data as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}
