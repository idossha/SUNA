import { execFile } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { readSettings, writeSettings } from './settings'

const run = promisify(execFile)

export type EnvKind = 'uv' | 'venv' | 'conda'

export interface DetectedEnv {
  kind: EnvKind
  name: string
  path: string
  python: string | null
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function pythonPath(envPath: string): string {
  return process.platform === 'win32'
    ? join(envPath, 'Scripts', 'python.exe')
    : join(envPath, 'bin', 'python')
}

async function resolvePython(envPath: string): Promise<string | null> {
  const candidate = pythonPath(envPath)
  return (await exists(candidate)) ? candidate : null
}

/**
 * Project-local environments first (the ones a researcher actually uses),
 * then conda's global list. `uv` is distinguished from a plain venv by the
 * presence of a uv lockfile beside the .venv it manages.
 */
export async function detectEnvs(dir: string): Promise<DetectedEnv[]> {
  const found: DetectedEnv[] = []
  const seen = new Set<string>()

  const uvManaged = await exists(join(dir, 'uv.lock'))
  for (const name of ['.venv', 'venv', 'env']) {
    const path = join(dir, name)
    if (!(await exists(join(path, 'pyvenv.cfg')))) continue
    seen.add(path)
    found.push({
      kind: uvManaged && name === '.venv' ? 'uv' : 'venv',
      name,
      path,
      python: await resolvePython(path)
    })
  }

  // nested one level: monorepo-style projects keep envs beside subprojects
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(dir, entry.name, '.venv')
      if (seen.has(path) || !(await exists(join(path, 'pyvenv.cfg')))) continue
      seen.add(path)
      found.push({
        kind: (await exists(join(dir, entry.name, 'uv.lock'))) ? 'uv' : 'venv',
        name: `${entry.name}/.venv`,
        path,
        python: await resolvePython(path)
      })
    }
  } catch {
    // unreadable project dir: the project-level scan above still stands
  }

  try {
    const { stdout } = await run('conda', ['env', 'list', '--json'], { timeout: 8000 })
    const parsed: unknown = JSON.parse(stdout)
    const envs =
      typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { envs?: unknown }).envs)
        ? ((parsed as { envs: unknown[] }).envs.filter((e) => typeof e === 'string') as string[])
        : []
    for (const path of envs) {
      if (seen.has(path)) continue
      seen.add(path)
      found.push({
        kind: 'conda',
        name: basename(path),
        path,
        python: await resolvePython(path)
      })
    }
  } catch {
    // conda not installed or slow — project envs are enough
  }

  return found
}

const selectionKey = (dir: string): string => `env.selected:${dir}`

export async function selectedEnv(dir: string): Promise<string | null> {
  const settings = await readSettings()
  const value = settings[selectionKey(dir)]
  return typeof value === 'string' ? value : null
}

export async function selectEnv(dir: string, envPath: string | null): Promise<void> {
  await writeSettings({ [selectionKey(dir)]: envPath })
}
