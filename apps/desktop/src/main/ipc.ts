import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  CHANNELS,
  type ChannelName,
  type RequestOf,
  type ResponseOf
} from '@suna/core'
import { listTree, readText, writeText } from './services/fs'
import { createProject, openProject, scaffoldStatus } from './services/project'

/** Register a handler with request/response zod validation on both edges. */
function handle<C extends ChannelName>(
  channel: C,
  handler: (req: RequestOf<C>) => Promise<ResponseOf<C>>
): void {
  ipcMain.handle(channel, async (_event, payload: unknown) => {
    const contract = CHANNELS[channel]
    const request = contract.request.parse(payload) as RequestOf<C>
    const response = await handler(request)
    return contract.response.parse(response)
  })
}

export function registerIpcHandlers(): void {
  handle('project:create', ({ dir, name }) => createProject(dir, name))
  handle('project:open', ({ dir }) => openProject(dir))
  handle('project:scaffold-status', ({ dir }) => scaffoldStatus(dir))
  handle('fs:read-text', async ({ path }) => ({ content: await readText(path) }))
  handle('fs:write-text', async ({ path, content }) => ({
    bytesWritten: await writeText(path, content)
  }))
  handle('fs:list', async ({ dir }) => ({ root: await listTree(dir) }))
  handle('dialog:pick-directory', async ({ title, allowCreate }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return { path: null }
    const result = await dialog.showOpenDialog(win, {
      title,
      properties: allowCreate
        ? ['openDirectory', 'createDirectory']
        : ['openDirectory']
    })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
}
