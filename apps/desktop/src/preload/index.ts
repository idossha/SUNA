import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS } from '@suna/core'
import type { ChannelName, RequestOf, ResponseOf } from '@suna/core'

// The typed IPC surface. The main process re-validates every request and
// response against the @suna/core channel contracts.
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  invoke: <C extends ChannelName>(
    channel: C,
    request: RequestOf<C>
  ): Promise<ResponseOf<C>> => ipcRenderer.invoke(channel, request),

  /**
   * Subscribe to pty output for one terminal id (EVENT_CHANNELS.termData).
   * Returns an unsubscribe function.
   */
  onTermData: (id: string, listener: (data: string) => void): (() => void) => {
    const channel = EVENT_CHANNELS.termData(id)
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      if (typeof data === 'string') listener(data)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * Subscribe to the pty exit event for one terminal id
   * (EVENT_CHANNELS.termExit). Returns an unsubscribe function.
   */
  onTermExit: (
    id: string,
    listener: (exit: { exitCode: number | null }) => void
  ): (() => void) => {
    const channel = EVENT_CHANNELS.termExit(id)
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      const exitCode =
        typeof payload === 'object' &&
        payload !== null &&
        'exitCode' in payload &&
        typeof (payload as { exitCode: unknown }).exitCode === 'number'
          ? (payload as { exitCode: number }).exitCode
          : null
      listener({ exitCode })
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * Subscribe to "the open project's suna.json changed on disk"
   * (EVENT_CHANNELS.projectManifestChanged) — an edit made outside the app by
   * an agent, the terminal, or another editor. Returns an unsubscribe function.
   */
  onProjectManifestChanged: (listener: (payload: { dir: string }) => void): (() => void) => {
    const channel = EVENT_CHANNELS.projectManifestChanged
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      const dir =
        typeof payload === 'object' && payload !== null && 'dir' in payload
          ? (payload as { dir: unknown }).dir
          : null
      if (typeof dir === 'string') listener({ dir })
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * Subscribe to "something in the open project's directory changed"
   * (EVENT_CHANNELS.projectTreeChanged) — a file created, deleted, renamed or
   * moved by anything, including writers outside the renderer (exports,
   * agents, the terminal, Finder). Returns an unsubscribe function.
   */
  onProjectTreeChanged: (listener: (payload: { dir: string }) => void): (() => void) => {
    const channel = EVENT_CHANNELS.projectTreeChanged
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      const dir =
        typeof payload === 'object' && payload !== null && 'dir' in payload
          ? (payload as { dir: unknown }).dir
          : null
      if (typeof dir === 'string') listener({ dir })
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * Subscribe to "the open project's git state moved" (EVENT_CHANNELS.
   * gitChanged) — index, HEAD, refs, or an in-progress merge/rebase, whoever
   * moved them: this app, the built-in terminal, an agent, another editor.
   * Returns an unsubscribe function.
   */
  onGitChanged: (listener: (payload: { dir: string }) => void): (() => void) => {
    const channel = EVENT_CHANNELS.gitChanged
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      const dir =
        typeof payload === 'object' && payload !== null && 'dir' in payload
          ? (payload as { dir: unknown }).dir
          : null
      if (typeof dir === 'string') listener({ dir })
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * Subscribe to status-line pushes for one 'lit:ai-search' run
   * (EVENT_CHANNELS.litProgress). Returns an unsubscribe function.
   */
  onLitProgress: (searchId: string, listener: (status: string) => void): (() => void) => {
    const channel = EVENT_CHANNELS.litProgress(searchId)
    const handler = (_event: IpcRendererEvent, status: unknown): void => {
      if (typeof status === 'string') listener(status)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * Subscribe to the terminal outcome of one 'lit:ai-search' run
   * (EVENT_CHANNELS.litDone) — fires exactly once. Returns an unsubscribe
   * function (call it after `listener` fires, or on unmount if it never does).
   */
  onLitDone: (
    searchId: string,
    listener: (outcome: { results: unknown[]; error: string | null }) => void
  ): (() => void) => {
    const channel = EVENT_CHANNELS.litDone(searchId)
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      const object =
        typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
      const results = Array.isArray(object['results']) ? object['results'] : []
      const error = typeof object['error'] === 'string' ? object['error'] : null
      listener({ results, error })
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * Subscribe to status-line pushes for one 'ai:ask' run
   * (EVENT_CHANNELS.aiAskProgress). Returns an unsubscribe function.
   */
  onAiAskProgress: (askId: string, listener: (status: string) => void): (() => void) => {
    const channel = EVENT_CHANNELS.aiAskProgress(askId)
    const handler = (_event: IpcRendererEvent, status: unknown): void => {
      if (typeof status === 'string') listener(status)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * Subscribe to the terminal outcome of one 'ai:ask' run
   * (EVENT_CHANNELS.aiAskDone) — fires exactly once. Returns an unsubscribe
   * function (call it after `listener` fires, or on unmount if it never does).
   */
  onAiAskDone: (
    askId: string,
    listener: (outcome: { text: string | null; error: string | null }) => void
  ): (() => void) => {
    const channel = EVENT_CHANNELS.aiAskDone(askId)
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      const object =
        typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
      const text = typeof object['text'] === 'string' ? object['text'] : null
      const error = typeof object['error'] === 'string' ? object['error'] : null
      listener({ text, error })
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
} as const

export type SunaApi = typeof api

contextBridge.exposeInMainWorld('suna', api)
