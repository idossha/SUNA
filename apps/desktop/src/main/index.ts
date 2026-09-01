import { app, BrowserWindow, shell } from 'electron'
import { join, resolve } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { ensureSunaConfig } from '@suna/agent'
import { EVENT_CHANNELS } from '@suna/core'
import { registerIpcHandlers } from './ipc'
import { loadConfig, watchConfig } from './services/userconfig'
import { appMcpInvocation } from './services/agentLayer'
import { cancelAllAiAsks } from './services/ai-ask'
import { disposePreviewWindow } from './services/export-preview'
import { cancelAllAiCliSearches } from './services/lit'
import { killAllTerminals } from './services/terminal'
import { shutdownAllKernels } from './services/kernel'
import { handleOutputFrameScheme, registerOutputFrameScheme } from './services/output-frame'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Must happen before the app is ready — Electron ignores a privileged scheme
// registered any later. Serves the sandboxed frame notebook outputs render in.
registerOutputFrameScheme()

// Opt-in CDP endpoint for screenshot checks and e2e drivers; never on by default.
const debugPort = process.env['SUNA_DEBUG_PORT']
if (debugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
}

// Opt-in test mode so e2e drivers and agent screenshot probes can run without
// a window appearing or the developer's real userData being touched.
// SUNA_USER_DATA redirects userData to an isolated dir; SUNA_HIDDEN=1 never
// shows the window (and hides the macOS dock icon) while backgroundThrottling
// false keeps the hidden renderer painting — visibilityState stays 'visible'
// and rAF keeps firing — so CDP input and screenshots still work.
const userDataDir = process.env['SUNA_USER_DATA']
if (userDataDir) {
  app.setPath('userData', resolve(userDataDir))
}

const hidden = process.env['SUNA_HIDDEN'] === '1'
if (hidden && process.platform === 'darwin') {
  app.dock?.hide()
}

let stopConfigWatch: (() => void) | null = null

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
    // macOS takes the window's icon from the bundle, never from here.
    ...(process.platform === 'darwin' ? {} : { icon }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      ...(hidden ? { backgroundThrottling: false } : {})
    }
  })

  win.on('ready-to-show', () => {
    if (hidden) {
      console.log('[suna] hidden test mode: window hidden, dock hidden')
    } else {
      win.show()
    }
  })

  // The export preview keeps a hidden BrowserWindow alive between renders.
  // It must die with the app window it serves: Electron counts it in
  // getAllWindows(), so a survivor would keep 'window-all-closed' from ever
  // firing and leave the dock's 'activate' believing a window still exists.
  win.on('closed', () => {
    disposePreviewWindow()
  })

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
  // A packaged macOS app gets its dock icon from the bundle's .icns. A dev
  // run has no bundle, so without this the dock shows Electron's own icon.
  // Skipped in hidden test mode, where the dock icon is hidden anyway.
  if (process.platform === 'darwin' && !app.isPackaged && !hidden) {
    app.dock?.setIcon(icon)
  }

  registerIpcHandlers()
  handleOutputFrameScheme()

  // Seed ~/.suna/config.yml and read it BEFORE the window exists, so the first
  // paint is already in the user's configured theme rather than flashing the
  // default one and correcting itself.
  void loadConfig().then(() => {
    createWindow()

    // Live reload: an edit to config.yml or a theme file — in SUNA, in vim, in
    // anything — repaints every open window. The payload is the whole reloaded
    // config, so the renderer needs no round trip.
    stopConfigWatch = watchConfig((config) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.isDestroyed()) {
          window.webContents.send(EVENT_CHANNELS.configChanged, config)
        }
      }
    })
  })

  // Sync the machine-level agent context (~/SunaConfig — ARCHITECTURE §15.4) so agents
  // launched outside any project still find current docs. Fire-and-forget:
  // startup never waits on it, and a failure only logs.
  void ensureSunaConfig(appMcpInvocation()).catch((error: unknown) => {
    console.warn('SunaConfig sync failed (continuing):', error)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  stopConfigWatch?.()
  stopConfigWatch = null
  disposePreviewWindow()
  killAllTerminals()
  shutdownAllKernels()
  cancelAllAiCliSearches()
  cancelAllAiAsks()
})

app.on('window-all-closed', () => {
  killAllTerminals()
  shutdownAllKernels()
  cancelAllAiCliSearches()
  cancelAllAiAsks()
  if (process.platform !== 'darwin') app.quit()
})
