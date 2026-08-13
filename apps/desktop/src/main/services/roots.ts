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
