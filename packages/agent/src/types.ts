export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  model?: string
  maxTokens?: number
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
