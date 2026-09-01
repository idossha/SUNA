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
  return join(envPath, 'bin', 'python')
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

/* ------------------------------------------------------------------ */
/* uv (onboarding wizard §5 step 4)                                     */
/* ------------------------------------------------------------------ */

/** Injectable so availability is testable without a real child process. */
export type UvProbe = () => Promise<boolean>

async function defaultUvProbe(): Promise<boolean> {
  return new Promise((resolvePromise) => {
    execFile('uv', ['--version'], { timeout: 5000 }, (error) => resolvePromise(error === null))
  })
}

/** Whether `uv` answers on PATH, so "create with uv" can be offered (or honestly disabled). */
export async function uvAvailable(probe: UvProbe = defaultUvProbe): Promise<boolean> {
  return probe()
}

export interface CreateEnvResult {
  ok: boolean
  envPath: string | null
  error: string | null
}

/** Injectable so venv creation is testable without spawning real `uv`. */
export type UvVenvRunner = (dir: string) => Promise<void>

async function defaultUvVenvRunner(dir: string): Promise<void> {
  await run('uv', ['venv'], { cwd: dir, timeout: 60_000 })
}

/**
 * Runs `uv venv` in `dir` (the project directory the wizard just created).
 * Never throws: a missing `uv` or a failed venv creation comes back as
 * `ok: false` with a human `error`, so one failed sub-step of Create project
 * never takes down the rest (DECISIONS 2026-08-15).
 */
export async function createEnvWithUv(
  dir: string,
  runner: UvVenvRunner = defaultUvVenvRunner
): Promise<CreateEnvResult> {
  try {
    await runner(dir)
    return { ok: true, envPath: join(dir, '.venv'), error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const notFound = (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
    return {
      ok: false,
      envPath: null,
      error: notFound ? 'uv is not installed or not on PATH' : message
    }
  }
}

/* ------------------------------------------------------------------ */
/* Automatic provisioning                                              */
/* ------------------------------------------------------------------ */

/**
 * A project that ships a `requirements.txt` can have its own `.venv` made for
 * it the first time it is opened, so the notebook kernel, the run button and
 * new terminals all work without a setup step. This is what makes the shipped
 * example self-sufficient: its requirements name `ipykernel`, and a kernel
 * without `ipykernel` is the one failure a reader cannot be expected to fix.
 *
 * Best-effort throughout: no python, no network, no `uv` — the project still
 * opens, only without an env, exactly as before.
 */
export const REQUIREMENTS_FILE = 'requirements.txt'

/** One provision per env path per app run, and the promise is shared. */
const provisioning = new Map<string, Promise<CreateEnvResult>>()

/** Injectable so provisioning is testable without spawning python or uv. */
export interface ProvisionRunners {
  createVenv: (dir: string, envPath: string) => Promise<void>
  install: (envPath: string, python: string, requirements: string) => Promise<void>
}

const defaultProvisionRunners: ProvisionRunners = {
  createVenv: async (dir, envPath) => {
    try {
      await run('uv', ['venv'], { cwd: dir, timeout: 120_000 })
    } catch {
      // uv is the fast path, not a requirement: stdlib venv is everywhere.
      await run('python3', ['-m', 'venv', envPath], { cwd: dir, timeout: 300_000 })
    }
  },
  install: async (envPath, python, requirements) => {
    try {
      await run('uv', ['pip', 'install', '--python', python, '-r', requirements], {
        cwd: envPath,
        timeout: 900_000
      })
    } catch {
      await run(python, ['-m', 'pip', 'install', '-q', '-r', requirements], { timeout: 900_000 })
    }
  }
}

/**
 * Create and populate `dir/.venv` from `dir/requirements.txt`, unless the env
 * is already there (a populated env is never touched — it may be the user's).
 * Returns the env path so the caller can select it.
 */
export async function provisionProjectEnv(
  dir: string,
  runners: ProvisionRunners = defaultProvisionRunners
): Promise<CreateEnvResult> {
  const envPath = join(dir, '.venv')
  const pending = provisioning.get(envPath)
  if (pending) return pending

  const task = (async (): Promise<CreateEnvResult> => {
    const requirements = join(dir, REQUIREMENTS_FILE)
    if (!(await exists(requirements))) {
      return { ok: false, envPath: null, error: `no ${REQUIREMENTS_FILE}` }
    }
    try {
      if (!(await exists(join(envPath, 'pyvenv.cfg')))) {
        await runners.createVenv(dir, envPath)
      }
      const python = await resolvePython(envPath)
      if (python === null) return { ok: false, envPath: null, error: 'env has no interpreter' }
      await runners.install(envPath, python, requirements)
      return { ok: true, envPath, error: null }
    } catch (error) {
      return {
        ok: false,
        envPath: null,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })()

  provisioning.set(envPath, task)
  return task
}

/**
 * Settle if `envPath` is being provisioned right now. Anything that STARTS an
 * interpreter awaits this, so a kernel launched while the install is still
 * running waits for it instead of reporting a missing `jupyter_client`.
 */
export async function awaitProvision(envPath: string | null): Promise<void> {
  if (envPath === null) return
  await provisioning.get(envPath)?.catch(() => undefined)
}
