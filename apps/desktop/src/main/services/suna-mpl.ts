import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Where `suna_mpl` (§16.1) lives on this machine, as a uv project directory.
 *
 * `suna_mpl` is not on PyPI, so `pip install suna-mpl` rescues nobody. A
 * figure script that does `import suna_mpl` can only run through the copy
 * that ships with SUNA, and the path to that copy is different in the two
 * layouts — which is exactly the trap the old
 * `uv run --project ../../python/suna_mpl` docstring fell into: correct in a
 * source checkout, `ModuleNotFoundError` in a packaged app (§20.6).
 *
 * Packaged it is staged under `Contents/Resources/python/suna_mpl` by
 * `scripts/packaging/stage-resources.mjs`; in dev it is read straight out of
 * the repo — the same split `bridgeScriptPath()` and `appMcpInvocation()`
 * use, and the §19 invariant requires both branches to live in this one
 * function.
 *
 * Returns null when neither exists, so a caller can leave the variable unset
 * rather than export a path that resolves to nothing.
 */
export function sunaMplProjectPath(): string | null {
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'python', 'suna_mpl')
    : resolve(app.getAppPath(), '..', '..', 'python', 'suna_mpl')
  // `uv run --project <dir>` requires a pyproject.toml in <dir>; a directory
  // without one is not a uv project and is worse than no variable at all.
  return existsSync(join(dir, 'pyproject.toml')) ? dir : null
}
