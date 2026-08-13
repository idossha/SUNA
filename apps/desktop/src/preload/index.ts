import { contextBridge } from 'electron'

// The typed IPC surface. Channels are added as @suna/core contracts land;
// nothing reaches the renderer without passing through this bridge.
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
} as const

export type SunaApi = typeof api

contextBridge.exposeInMainWorld('suna', api)
