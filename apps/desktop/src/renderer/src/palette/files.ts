import type { FsNode } from '@suna/core'

export interface PaletteFileEntry {
  /** Absolute path — what openFileTab/openInSplit need. */
  path: string
  name: string
  /**
   * Path relative to the project root (`manuscript/sections/01-introduction.md`),
   * or the absolute path when it does not sit under `rootDir`.
   *
   * This — never `path` — is what the palette fuzzy-matches and displays.
   * Every file in a project shares the same absolute prefix, and on macOS
   * that prefix is long and vowel-rich (`/Users/<name>/Library/Application
   * Support/@suna/desktop/example-project/…`), so a subsequence matcher run
   * over absolute paths finds nearly any short query inside the prefix alone
   * and returns the entire project for `intro`. Matching the relative path
   * makes a query discriminate between files instead of between prefixes,
   * and keeps the row subtitle readable.
   */
  rel: string
}

/** `path` with `rootDir`'s prefix removed; unchanged when it is not under it. */
function relativeTo(path: string, rootDir: string | null): string {
  if (rootDir === null || rootDir === '') return path
  const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/** Flatten the project tree (fs:list's FsNode) into every FILE (no directories), depth-first. */
export function collectFiles(root: FsNode | null, rootDir: string | null = null): PaletteFileEntry[] {
  if (root === null) return []
  const out: PaletteFileEntry[] = []
  const walk = (node: FsNode): void => {
    if (node.kind === 'file') {
      out.push({ path: node.path, name: node.name, rel: relativeTo(node.path, rootDir) })
      return
    }
    for (const child of node.children) walk(child)
  }
  walk(root)
  return out
}
