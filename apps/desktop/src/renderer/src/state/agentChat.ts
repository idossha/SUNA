import { create } from 'zustand'
import { currentManuscriptTitle } from './manuscript'
import { useProjectStore } from './project'

export type AgentProvider = 'anthropic' | 'openai' | 'ollama'

export const AGENT_PROVIDERS: ReadonlyArray<{ id: AgentProvider; label: string }> = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'ollama', label: 'Ollama' }
]

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SYSTEM_PROMPT =
  "You are SUNA's writing collaborator. The user is writing an academic manuscript; be concise and concrete."

interface AgentChatState {
  provider: AgentProvider
  configured: Record<AgentProvider, boolean>
  statusLoaded: boolean
  messages: ChatMessage[]
  busy: boolean
  error: string | null
  setProvider: (provider: AgentProvider) => void
  refreshStatus: () => Promise<void>
  saveKey: (key: string) => Promise<void>
  send: (text: string) => Promise<void>
  pushExternalExchange: (prompt: string, answer: string) => void
}

export const useAgentChatStore = create<AgentChatState>((set, get) => ({
  provider: 'anthropic',
  configured: { anthropic: false, openai: false, ollama: true },
  statusLoaded: false,
  messages: [],
  busy: false,
  error: null,

  setProvider: (provider) => set({ provider, error: null }),

  /**
   * Append a prompt/answer pair produced OUTSIDE this store's own `send()`
   * round trip — the command palette's `?` prefix (DECISIONS 2026-08-14) drops
   * its ai-cli answer here so the Agent view transcript stays the single
   * place a user reviews every AI answer, whichever entry point produced it
   * (and so the answer isn't a floating reply with no visible question).
   */
  pushExternalExchange: (prompt, answer) => {
    set((s) => ({
      messages: [
        ...s.messages,
        { role: 'user', content: prompt },
        { role: 'assistant', content: answer }
      ]
    }))
  },

  refreshStatus: async () => {
    try {
      const { providers } = await window.suna.invoke('agent:provider-status', {})
      const configured = { ...get().configured }
      for (const p of providers) configured[p.id] = p.hasKey
      set({ configured, statusLoaded: true })
    } catch (error) {
      set({
        statusLoaded: true,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },

  saveKey: async (key) => {
    const trimmed = key.trim()
    if (trimmed === '') return
    try {
      await window.suna.invoke('agent:set-key', { provider: get().provider, key: trimmed })
      set({ error: null })
      await get().refreshStatus()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  send: async (text) => {
    const content = text.trim()
    if (content === '' || get().busy) return
    const messages: ChatMessage[] = [...get().messages, { role: 'user', content }]
    set({ messages, busy: true, error: null })
    try {
      const title = await currentManuscriptTitle()
      const system =
        title !== null ? `${SYSTEM_PROMPT} The manuscript is titled "${title}".` : SYSTEM_PROMPT
      const { text: reply } = await window.suna.invoke('agent:chat', {
        provider: get().provider,
        system,
        messages,
        // Main resolves ai.model/ai.effort against this project first.
        dir: useProjectStore.getState().rootDir
      })
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: reply }],
        busy: false
      }))
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}))
