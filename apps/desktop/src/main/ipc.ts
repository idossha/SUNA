import { BrowserWindow, app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { access, cp, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import {
  CHANNELS,
  EVENT_CHANNELS,
  LIT_PROVIDER_IDS,
  LIT_PROVIDER_META,
  type ChannelName,
  type LitCliPreference,
  type MigrationOutcome,
  type RequestOf,
  type ResponseOf
} from '@suna/core'
import { getProvider } from '@suna/agent'
import { cancelAiAsk, runAiAsk } from './services/ai-ask'
import {
  getKey,
  getLitKey,
  hasKey,
  hasLitKey,
  setKey,
  setLitKey
} from './services/agent-keys'
import { readCommentsFile, writeCommentsFile } from './services/comments'
import { analyzeDocx, commitDocxAnalysis } from './services/docx-import'
import { docxToolsAvailable } from './services/docx-tools-accelerator'
import { exportDocx } from './services/export-docx'
import { exportPdf } from './services/export-pdf'
import { createFigure } from './services/figure-create'
import { duplicateFigure } from './services/figure-duplicate'
import { exportFigure } from './services/figure-export'
import {
  copyFileInto,
  createFile,
  listTree,
  makeDir,
  readBinary,
  readText,
  renameEntry,
  trashEntry,
  writeBinary,
  writeText
} from './services/fs'
import {
  aiCliSearch,
  cancelAiCliSearch,
  detectAvailableClis,
  lookupByDoi,
  searchLiterature
} from './services/lit'
import { updateManuscript } from './services/manuscript'
import { migrateProject } from './services/migrate-manuscript'
import { gitCommit, gitDiffFile, gitInit, gitLog, gitStatus } from './services/git'
import {
  checkScaffoldTarget,
  createProject,
  listImportableFiles,
  openProject,
  scaffoldProject,
  scaffoldStatus,
  updateProjectSettings
} from './services/project'
import { watchProjectManifest } from './services/projectWatch'
import { allowRoot } from './services/roots'
import { createEnvWithUv, detectEnvs, selectEnv, selectedEnv, uvAvailable } from './services/envs'
import {
  forgetRecentProject,
  listRecentProjects,
  readSettings,
  touchRecentProject,
  writeSettings
} from './services/settings'
import {
  createTerminal,
  killTerminal,
  resizeTerminal,
  writeTerminal
} from './services/terminal'

/**
 * Absolute path to the bundled MCP server script. Agent CLIs spawn it with
 * plain `node`, so it must resolve outside the Electron bundle.
 */
function mcpServerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mcp', 'server.mjs')
    : resolve(app.getAppPath(), '..', '..', 'packages', 'agent', 'dist-mcp', 'server.mjs')
}

const AGENT_PROVIDER_IDS = ['anthropic', 'openai', 'ollama'] as const

/**
 * Contact address for the Crossref/OpenAlex polite pools. Settings own it; the
 * renderer writes either key with `settings:set`.
 */
async function politeMailto(): Promise<string | null> {
  const settings = await readSettings()
  for (const key of ['lit.mailto', 'user.email']) {
    const value = settings[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

/** Settings key 'lit.cli': which agent CLI the 'ai-cli' provider should prefer. */
async function litCliPreference(): Promise<LitCliPreference> {
  const settings = await readSettings()
  const value = settings['lit.cli']
  return value === 'claude' || value === 'codex' ? value : 'auto'
}

/** The demo paper shipped with the repo (dev) or app resources (packaged). */
async function exampleProjectDir(): Promise<string> {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'examples', 'demo-paper')]
    : [
        resolve(app.getAppPath(), '..', '..', 'examples', 'demo-paper'),
        resolve(process.cwd(), '..', '..', 'examples', 'demo-paper'),
        resolve(process.cwd(), 'examples', 'demo-paper')
      ]
  for (const dir of candidates) {
    try {
      await access(join(dir, 'suna.json'))
      return dir
    } catch {
      // keep looking
    }
  }
  throw new Error('example project not found (examples/demo-paper)')
}

/**
 * The example opens as a user-owned COPY under userData so edits and commits
 * never dirty the shipped demo (or the SUNA repo in dev). The copy is made
 * once; subsequent opens reuse it as-is, preserving user edits.
 */
async function ensureExampleProjectCopy(): Promise<string> {
  const target = join(app.getPath('userData'), 'example-project')
  allowRoot(target)
  const alreadyCopied = await access(join(target, 'suna.json')).then(
    () => true,
    () => false
  )
  if (alreadyCopied) return target

  const source = await exampleProjectDir()
  await cp(source, target, {
    recursive: true,
    filter: (src) => {
      const rel = relative(source, src)
      if (rel === '') return true
      const top = rel.split(sep)[0]
      if (top === 'output' || top === '.git') return false
      return basename(src) !== '.DS_Store'
    }
  })
  // Version control from birth; best-effort if git is unavailable.
  try {
    await gitInit(target)
  } catch (error) {
    console.warn('git init for example copy failed (continuing without VCS):', error)
  }
  return target
}

/**
 * Record a project open in the recents list. Best-effort by design: a settings
 * write that fails must never stop a project from opening — it is logged, and
 * the welcome screen simply misses one row.
 */
async function noteRecentProject(dir: string, name: string): Promise<void> {
  try {
    await touchRecentProject(dir, name)
  } catch (error) {
    console.warn('could not record recent project:', error)
  }
}

/**
 * Follow the newly-opened project's suna.json (feature-plan-5 §4). Every entry
 * point that makes a project "the open one" calls this, so an external edit —
 * an agent, `$` in the terminal, another editor — reaches the renderer's
 * resolver without a restart. Best-effort: a project that cannot be watched
 * still opens, it just loses live re-resolution.
 */
function followProjectManifest(dir: string): void {
  watchProjectManifest(dir, (changed) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.projectManifestChanged, { dir: changed })
      }
    }
  })
}

/**
 * Bring a project to the flat manuscript layout as it opens (feature-plan-7
 * §1). migrateProject already returns a structured error rather than throwing,
 * but an unexpected throw must not stop a project from opening either — the
 * old layout on disk is intact in that case, and the renderer surfaces the
 * outcome.
 */
async function migrateOnOpen(dir: string): Promise<MigrationOutcome> {
  try {
    return await migrateProject(dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('manuscript migration failed (opening the project as-is):', error)
    return { migrated: false, notes: [], error: message }
  }
}

/** Register a handler with request/response zod validation on both edges. */
function handle<C extends ChannelName>(
  channel: C,
  handler: (req: RequestOf<C>, event: IpcMainInvokeEvent) => Promise<ResponseOf<C>>
): void {
  ipcMain.handle(channel, async (event, payload: unknown) => {
    const contract = CHANNELS[channel]
    const request = contract.request.parse(payload) as RequestOf<C>
    const response = await handler(request, event)
    return contract.response.parse(response)
  })
}

export function registerIpcHandlers(): void {
  handle('project:create', async ({ dir, name }) => {
    const manifest = await createProject(dir, name)
    await noteRecentProject(dir, manifest.name)
    followProjectManifest(dir)
    return manifest
  })
  handle('project:open', async ({ dir }) => {
    const opened = await openProject(dir)
    const migration = await migrateOnOpen(dir)
    await noteRecentProject(dir, opened.manifest.name)
    followProjectManifest(dir)
    return { ...opened, migration }
  })
  handle('project:migrate', ({ dir }) => migrateProject(dir))
  handle('project:open-example', async () => {
    const dir = await ensureExampleProjectCopy()
    const { manifest } = await openProject(dir)
    const migration = await migrateOnOpen(dir)
    await noteRecentProject(dir, manifest.name)
    followProjectManifest(dir)
    return { dir, manifest, migration }
  })
  handle('project:scaffold-status', ({ dir }) => scaffoldStatus(dir))
  handle('project:update-settings', async ({ dir, patch }) => ({
    manifest: await updateProjectSettings(dir, patch)
  }))
  handle('project:check-target', ({ parentDir, name }) => checkScaffoldTarget(parentDir, name))
  handle('project:list-importable', async ({ dir }) => ({ files: await listImportableFiles(dir) }))
  handle('project:scaffold', async (req) => {
    const result = await scaffoldProject(req)
    await noteRecentProject(req.dir, result.manifest.name)
    followProjectManifest(req.dir)
    return result
  })
  handle('project:recents', async () => ({ recents: await listRecentProjects() }))
  handle('project:touch-recent', async ({ path, name }) => ({
    recents: await touchRecentProject(path, name)
  }))
  handle('project:forget-recent', async ({ path }) => ({
    recents: await forgetRecentProject(path)
  }))

  handle('docx:analyze', async ({ path }) => ({ analysis: await analyzeDocx(path) }))
  handle('docx:commit', async ({ analysis, dir, force }) => {
    const result = await commitDocxAnalysis(analysis, dir, force)
    await noteRecentProject(result.dir, basename(result.dir))
    followProjectManifest(result.dir)
    return result
  })

  handle('fs:read-text', async ({ path }) => ({ content: await readText(path) }))
  handle('fs:write-text', async ({ path, content }) => ({
    bytesWritten: await writeText(path, content)
  }))
  handle('fs:read-binary', ({ path }) => readBinary(path))
  handle('fs:copy-file', async ({ from, to }) => ({ path: await copyFileInto(from, to) }))
  handle('fs:list', async ({ dir }) => ({ root: await listTree(dir) }))
  handle('fs:rename', async ({ path, newName }) => ({
    path: await renameEntry(path, newName)
  }))
  handle('fs:delete', async ({ path }) => {
    await trashEntry(path)
    return {}
  })
  handle('fs:mkdir', async ({ path }) => {
    await makeDir(path)
    return {}
  })
  handle('fs:create-file', async ({ path, content }) => {
    await createFile(path, content)
    return {}
  })

  // manuscript.json / comments.json: read fresh, merge, validate, write atomically.
  handle('manuscript:update', async ({ dir, patch }) => ({
    manuscript: await updateManuscript(dir, patch)
  }))
  handle('comments:read', async ({ dir }) => ({ file: await readCommentsFile(dir) }))
  handle('comments:write', async ({ dir, file }) => {
    await writeCommentsFile(dir, file)
    return {}
  })

  handle('lit:search', async ({ provider, query, limit }) =>
    searchLiterature(provider, query, {
      limit,
      apiKey: await getLitKey(provider),
      mailto: await politeMailto()
    })
  )
  handle('lit:by-doi', async ({ provider, doi }) =>
    lookupByDoi(provider, doi, {
      apiKey: await getLitKey(provider),
      mailto: await politeMailto()
    })
  )
  handle('lit:set-key', async ({ provider, key }) => {
    await setLitKey(provider, key)
    return {}
  })
  handle('lit:providers', async () => ({
    providers: await Promise.all(
      LIT_PROVIDER_IDS.map(async (id) => ({
        id,
        hasKey: await hasLitKey(id),
        keyless: LIT_PROVIDER_META[id].keyless
      }))
    )
  }))
  handle('lit:cli-status', async () => ({ available: await detectAvailableClis() }))
  handle('lit:ai-search', async ({ query, limit, dir }, event) => {
    const searchId = `lit-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const webContents = event.sender
    const cliPreference = await litCliPreference()

    // Fire-and-forget: the child keeps running after this handler returns.
    // Progress/outcome arrive over EVENT_CHANNELS.litProgress/litDone(searchId).
    void aiCliSearch(searchId, query, limit, {
      dir,
      cliPreference,
      onProgress: (status) => {
        if (!webContents.isDestroyed()) webContents.send(EVENT_CHANNELS.litProgress(searchId), status)
      }
    }).then(({ results, error }) => {
      if (!webContents.isDestroyed()) {
        webContents.send(EVENT_CHANNELS.litDone(searchId), { results, error })
      }
    })

    return { searchId }
  })
  handle('lit:cancel', async ({ searchId }) => {
    cancelAiCliSearch(searchId)
    return {}
  })

  handle('ai:ask', async ({ prompt, dir }, event) => {
    const askId = `ai-ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const webContents = event.sender
    const cliPreference = await litCliPreference()

    // Fire-and-forget: the child keeps running after this handler returns.
    // Progress/outcome arrive over EVENT_CHANNELS.aiAskProgress/aiAskDone(askId).
    void runAiAsk(askId, prompt, {
      dir,
      cliPreference,
      onProgress: (status) => {
        if (!webContents.isDestroyed()) webContents.send(EVENT_CHANNELS.aiAskProgress(askId), status)
      }
    }).then(({ text, error }) => {
      if (!webContents.isDestroyed()) {
        webContents.send(EVENT_CHANNELS.aiAskDone(askId), { text, error })
      }
    })

    return { askId }
  })
  handle('ai:cancel', async ({ askId }) => {
    cancelAiAsk(askId)
    return {}
  })

  handle('figure:export', ({ dir, figureId, format, widthMm, dpi, transparent }) =>
    exportFigure({ dir, figureId, format, widthMm, dpi, transparent })
  )
  handle('figure:write-binary', async ({ path, base64 }) => ({
    path: await writeBinary(path, base64)
  }))
  handle('figure:duplicate', ({ dir, figureId, newId }) => duplicateFigure(dir, figureId, newId))
  handle('figure:create', ({ dir, name, widthMm }) => createFigure(dir, name, widthMm))

  handle('export:docx', (req) => exportDocx(req))
  handle('export:pdf', (req) => exportPdf(req))
  handle('export:tools-available', async () => ({ docxTools: await docxToolsAvailable() }))

  handle('git:status', ({ dir }) => gitStatus(dir))
  handle('git:log', ({ dir, limit }) => gitLog(dir, limit))
  handle('git:commit', ({ dir, message, stageAll }) => gitCommit(dir, message, stageAll))
  handle('git:diff-file', ({ dir, path }) => gitDiffFile(dir, path))
  handle('git:init', async ({ dir }) => {
    await gitInit(dir)
    return {}
  })

  handle('agent:set-key', async ({ provider, key }) => {
    await setKey(provider, key)
    return {}
  })
  handle('agent:provider-status', async () => ({
    providers: await Promise.all(
      AGENT_PROVIDER_IDS.map(async (id) => ({ id, hasKey: await hasKey(id) }))
    )
  }))
  handle('agent:chat', async ({ provider, system, messages }) => {
    const key = await getKey(provider)
    if (provider !== 'ollama' && key === null) {
      throw new Error(`no API key configured for ${provider} — add one in settings`)
    }
    return getProvider(provider).chat({ system, messages }, { apiKey: key ?? undefined })
  })

  handle('term:create', async ({ cwd, cols, rows, envPath }, event) => {
    const webContents = event.sender
    return { id: createTerminal({ cwd, cols, rows, envPath, webContents }) }
  })
  handle('term:write', async ({ id, data }) => {
    writeTerminal(id, data)
    return {}
  })
  handle('term:resize', async ({ id, cols, rows }) => {
    resizeTerminal(id, cols, rows)
    return {}
  })
  handle('term:kill', async ({ id }) => {
    killTerminal(id)
    return {}
  })

  handle('env:detect', async ({ dir }) => ({ envs: await detectEnvs(dir) }))
  handle('env:select', async ({ dir, envPath }) => {
    await selectEnv(dir, envPath)
    return {}
  })
  handle('env:selected', async ({ dir }) => ({ envPath: await selectedEnv(dir) }))
  handle('env:uv-available', async () => ({ available: await uvAvailable() }))
  handle('env:create', ({ dir }) => createEnvWithUv(dir))

  handle('settings:get', async () => ({ settings: await readSettings() }))
  handle('settings:set', async ({ patch }) => ({ settings: await writeSettings(patch) }))

  handle('agent:write-mcp-config', async ({ dir }) => {
    // Claude Code and Codex both auto-discover .mcp.json in the project root.
    const path = join(dir, '.mcp.json')
    const config = {
      mcpServers: {
        suna: {
          command: 'node',
          args: [mcpServerPath(), '--project', dir]
        }
      }
    }
    await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8')
    return { path }
  })

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

  handle('dialog:pick-file', async ({ title, extensions }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return { path: null }
    // Electron wants bare extensions; callers may pass '.pdf' or 'pdf'.
    const bare = extensions.map((ext) => ext.replace(/^\./, '').toLowerCase()).filter(Boolean)
    const filters =
      bare.length > 0
        ? [
            { name: bare.map((ext) => ext.toUpperCase()).join(', '), extensions: bare },
            { name: 'All files', extensions: ['*'] }
          ]
        : [{ name: 'All files', extensions: ['*'] }]
    const result = await dialog.showOpenDialog(win, {
      title,
      properties: ['openFile'],
      filters
    })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
}
