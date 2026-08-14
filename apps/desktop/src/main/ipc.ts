import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { access, cp } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import {
  CHANNELS,
  type ChannelName,
  type RequestOf,
  type ResponseOf
} from '@suna/core'
import { getProvider } from '@suna/agent'
import { getKey, hasKey, setKey } from './services/agent-keys'
import {
  createFile,
  listTree,
  makeDir,
  readText,
  renameEntry,
  trashEntry,
  writeText
} from './services/fs'
import { gitCommit, gitDiffFile, gitInit, gitLog, gitStatus } from './services/git'
import { createProject, openProject, scaffoldStatus } from './services/project'
import { allowRoot } from './services/roots'

const AGENT_PROVIDER_IDS = ['anthropic', 'openai', 'ollama'] as const

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
  handle('project:open-example', async () => {
    const dir = await ensureExampleProjectCopy()
    const { manifest } = await openProject(dir)
    return { dir, manifest }
  })
  handle('project:scaffold-status', ({ dir }) => scaffoldStatus(dir))

  handle('fs:read-text', async ({ path }) => ({ content: await readText(path) }))
  handle('fs:write-text', async ({ path, content }) => ({
    bytesWritten: await writeText(path, content)
  }))
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
