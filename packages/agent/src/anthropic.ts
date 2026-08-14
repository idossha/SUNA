import type { ChatRequest, ChatResult, Provider, ProviderChatOptions } from './types'
import { postJson } from './http'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_MODEL = 'claude-sonnet-5'
const DEFAULT_MAX_TOKENS = 4096
const API_VERSION = '2023-06-01'

/** Fetch-based adapter for the Anthropic Messages API (no SDK dependency). */
export const anthropicProvider: Provider = {
  id: 'anthropic',
  async chat(req: ChatRequest, opts: ProviderChatOptions): Promise<ChatResult> {
    if (!opts.apiKey) throw new Error('anthropic: no API key configured')
    const data = await postJson({
      provider: 'anthropic',
      url: `${opts.baseUrl ?? DEFAULT_BASE_URL}/v1/messages`,
      headers: {
        'x-api-key': opts.apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json'
      },
      body: {
        model: req.model ?? DEFAULT_MODEL,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: req.system,
        messages: req.messages
      }
    })
    return { text: concatTextBlocks(data) }
  }
}

/** Concatenate the text blocks of a Messages API response `content` array. */
function concatTextBlocks(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const content = (data as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      text += (block as { text: string }).text
    }
  }
  return text
}
