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
export {
  ensureProjectAgentLayer,
  ensureSunaConfig,
  type EnsureResult,
  type McpInvocation
} from './context/ensure'
export { sunaConfigDir } from './context/paths'
export { PROJECT_CONTEXT_DIR, PROJECT_CONTEXT_FILES } from './context/templates'
export type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  Provider,
  ProviderChatOptions
} from './types'
