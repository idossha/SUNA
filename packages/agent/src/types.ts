import type { AiEffort } from '@suna/core'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  model?: string
  maxTokens?: number
  /**
   * Reasoning effort for the turn (@suna/core's AiEffort). Anthropic sends it
   * as `output_config.effort`; providers with no equivalent knob ignore it.
   */
  effort?: AiEffort
}

export interface ProviderChatOptions {
  apiKey?: string
  baseUrl?: string
}

export interface ChatResult {
  text: string
}

export interface Provider {
  id: string
  chat(req: ChatRequest, opts: ProviderChatOptions): Promise<ChatResult>
}
