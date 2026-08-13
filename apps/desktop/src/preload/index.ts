import { contextBridge, ipcRenderer } from 'electron'
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
  ): Promise<ResponseOf<C>> => ipcRenderer.invoke(channel, request)
} as const

export type SunaApi = typeof api

contextBridge.exposeInMainWorld('suna', api)
