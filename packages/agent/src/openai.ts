import type { ChatRequest, ChatResult, Provider, ProviderChatOptions } from './types'
import { postJson } from './http'

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_MODEL = 'gpt-4o'

/** Fetch-based adapter for the OpenAI Chat Completions API. */
export const openaiProvider: Provider = {
  id: 'openai',
  async chat(req: ChatRequest, opts: ProviderChatOptions): Promise<ChatResult> {
    if (!opts.apiKey) throw new Error('openai: no API key configured')
    const messages: { role: string; content: string }[] = []
    if (req.system !== '') messages.push({ role: 'system', content: req.system })
    messages.push(...req.messages)
    const data = await postJson({
      provider: 'openai',
      url: `${opts.baseUrl ?? DEFAULT_BASE_URL}/v1/chat/completions`,
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        'content-type': 'application/json'
      },
      body: {
        model: req.model ?? DEFAULT_MODEL,
        messages,
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {})
      }
    })
    return { text: extractChoiceText(data) }
  }
}

function extractChoiceText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return ''
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}
