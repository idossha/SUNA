import type { AiModel } from '@suna/core'
import type { ChatRequest, ChatResult, Provider, ProviderChatOptions } from './types'
import { postJson } from './http'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'

/**
 * Tier ('sonnet') → the model id this app sends today. The settings surface
 * stores the tier, so bumping a generation is this table and nothing else —
 * no committed suna.json has to be rewritten.
 */
export const ANTHROPIC_MODEL_IDS: Record<AiModel, string> = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5'
}

/** The model id for a tier; falls back to the shipped default tier. */
export function anthropicModelId(model: AiModel | undefined): string {
  return ANTHROPIC_MODEL_IDS[model ?? 'sonnet']
}

const DEFAULT_MODEL = ANTHROPIC_MODEL_IDS.sonnet
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
        messages: req.messages,
        // GA on the Messages API, no beta header; omitted means the API's own
        // default (high), so only send it when the caller picked a level.
        ...(req.effort !== undefined ? { output_config: { effort: req.effort } } : {})
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
