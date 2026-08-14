import type { Provider } from './types'
import { anthropicProvider } from './anthropic'
import { ollamaProvider } from './ollama'
import { openaiProvider } from './openai'

const PROVIDERS = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  ollama: ollamaProvider
} as const satisfies Record<string, Provider>

export type ProviderId = keyof typeof PROVIDERS

export function getProvider(id: ProviderId): Provider {
  const provider = PROVIDERS[id]
  if (!provider) throw new Error(`unknown provider: ${String(id)}`)
  return provider
}

export { anthropicProvider } from './anthropic'
export { ollamaProvider } from './ollama'
export { openaiProvider } from './openai'
export type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  Provider,
  ProviderChatOptions
} from './types'
