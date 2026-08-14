import { app } from 'electron'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * App-wide settings persisted to userData/settings.json. Values are opaque to
 * the main process: the renderer owns their meaning, this is a durable bag.
 * Per-project keys (e.g. the selected python env) are namespaced by the
 * caller, so one file covers both scopes.
 */
type Settings = Record<string, unknown>

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function readSettings(): Promise<Settings> {
  if (cache !== null) return cache
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    cache = typeof parsed === 'object' && parsed !== null ? (parsed as Settings) : {}
  } catch {
    cache = {}
  }
  return cache
}

/** Shallow-merge a patch and write atomically (temp file + rename). */
export async function writeSettings(patch: Settings): Promise<Settings> {
  const current = await readSettings()
  const next: Settings = { ...current, ...patch }
  const target = settingsPath()
  await mkdir(app.getPath('userData'), { recursive: true })
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(temp, target)
  cache = next
  return next
}
