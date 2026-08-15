import { app } from 'electron'
import { access, readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  RECENT_PROJECTS_KEY,
  coerceRecentProjects,
  forgetRecentProject as dropRecent,
  touchRecentProject as pushRecent,
  type RecentProject,
  type RecentProjectEntry
} from '@suna/core'

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

/**
 * Shallow-merge a patch and write atomically (temp file + rename).
 *
 * A `null` value CLEARS the key rather than storing null: callers use it to
 * mean "unset this", and a stored null would otherwise read back as a value
 * that shadows the built-in default (a resolver would report the setting as
 * coming "from global" when the user had reset it).
 */
export async function writeSettings(patch: Settings): Promise<Settings> {
  const current = await readSettings()
  const next: Settings = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  const target = settingsPath()
  await mkdir(app.getPath('userData'), { recursive: true })
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(temp, target)
  cache = next
  return next
}

/* ------------------------------------------------------------------ */
/* Recent projects (feature-plan-5 §1) — global settings, key 'recentProjects' */
/* ------------------------------------------------------------------ */

/** A recents row is openable when its directory still holds a suna.json. */
async function projectExists(path: string): Promise<boolean> {
  try {
    await access(join(path, 'suna.json'))
    return true
  } catch {
    return false
  }
}

async function withExistence(list: readonly RecentProject[]): Promise<RecentProjectEntry[]> {
  return Promise.all(
    list.map(async (entry) => ({ ...entry, exists: await projectExists(entry.path) }))
  )
}

/** The stored list, dedupe/cap already applied by coerceRecentProjects. */
export async function readRecentProjects(): Promise<RecentProject[]> {
  const settings = await readSettings()
  return coerceRecentProjects(settings[RECENT_PROJECTS_KEY])
}

export async function listRecentProjects(): Promise<RecentProjectEntry[]> {
  return withExistence(await readRecentProjects())
}

/**
 * Record an open: moves the project to the head of the list, deduped by path
 * and capped at MAX_RECENT_PROJECTS. Called by project:create / project:open /
 * project:open-example, so recents fill without renderer help.
 */
export async function touchRecentProject(
  path: string,
  name: string
): Promise<RecentProjectEntry[]> {
  const next = pushRecent(await readRecentProjects(), {
    path,
    name,
    lastOpenedAt: new Date().toISOString()
  })
  await writeSettings({ [RECENT_PROJECTS_KEY]: next })
  return withExistence(next)
}

export async function forgetRecentProject(path: string): Promise<RecentProjectEntry[]> {
  const next = dropRecent(await readRecentProjects(), path)
  await writeSettings({ [RECENT_PROJECTS_KEY]: next })
  return withExistence(next)
}
