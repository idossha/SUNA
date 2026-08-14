import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { killAllTerminals } from './services/terminal'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Opt-in CDP endpoint for screenshot checks and e2e drivers; never on by default.
const debugPort = process.env['SUNA_DEBUG_PORT']
if (debugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#16161a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // External links open in the system browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  killAllTerminals()
})

app.on('window-all-closed', () => {
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})
