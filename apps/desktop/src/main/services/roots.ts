import { resolve, sep } from 'node:path'

/**
 * File-system access from the renderer (and later, agent tools) is confined
 * to roots the user explicitly opened or created as projects.
 */
const allowedRoots = new Set<string>()

export function allowRoot(dir: string): void {
  allowedRoots.add(resolve(dir))
}

export function assertInsideAllowedRoot(path: string): string {
  const abs = resolve(path)
  for (const root of allowedRoots) {
    if (abs === root || abs.startsWith(root + sep)) return abs
  }
  throw new Error(`path is outside any open project: ${path}`)
}

/**
 * The allowed root that CONTAINS `path`, or null. Distinct from the assertion
 * above, which only answers yes/no: services that keep per-project state beside
 * the project (the trash under `.suna/`) need to know WHICH project a path
 * belongs to. The longest match wins, so a project opened inside another
 * project's tree still gets its own answer.
 */
export function rootForPath(path: string): string | null {
  const abs = resolve(path)
  let best: string | null = null
  for (const root of allowedRoots) {
    if (abs === root || abs.startsWith(root + sep)) {
      if (best === null || root.length > best.length) best = root
    }
  }
  return best
}
