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

export { ANTHROPIC_MODEL_IDS, anthropicModelId, anthropicProvider } from './anthropic'
export { ollamaProvider } from './ollama'
export { openaiProvider } from './openai'
export {
  ensureProjectAgentLayer,
  ensureGitignoreLine,
  ensureSunaConfig,
  type EnsureResult,
  type McpInvocation
} from './context/ensure'
export { sunaConfigDir } from './context/paths'
export { PROJECT_CONTEXT_DIR, PROJECT_CONTEXT_FILES } from './context/templates'
export {
  expandRoots,
  libraryConfigPath,
  loadLibraryConfig,
  saveLibraryConfig,
  type ExpandedRoots,
  type LibraryConfigOutcome,
  type LibraryConfigSource
} from './library/config'
export {
  BYTE_READ_CANDIDATES,
  SPOTLIGHT_MAX_RESULTS,
  SPOTLIGHT_TIMEOUT_MS,
  WALK_SKIP_DIRS,
  findLocalPdf,
  importPdfIntoProject,
  // Both hosts of the acquisition ladder gate on these three, so both import
  // them from here rather than each keeping its own rule: `isAutoCopyable`
  // decides which local match may be copied without asking, and
  // `quoteExternalPath` / `describeExternalError` are how a path from outside
  // the project — or an error naming one — reaches any report at all.
  //
  // `describeExternalError` belongs here for the same reason its sibling
  // does. While it was missing, the desktop host could quote a path but had
  // to hand-roll `error instanceof Error ? …` for the errno message beside
  // it, which is the door the quoting was closing (an errno message quotes
  // the path it failed on). An escaper the second host cannot import is a
  // rule the second host cannot follow.
  describeExternalError,
  isAutoCopyable,
  quoteExternalPath,
  runMdfind,
  savePdfBytes,
  type FindLocalPdfOptions,
  type FindLocalPdfResult,
  type PdfSaveOutcome,
  type SpotlightOutcome,
  type SpotlightRunner
} from './library/scan'
export type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  Provider,
  ProviderChatOptions
} from './types'
