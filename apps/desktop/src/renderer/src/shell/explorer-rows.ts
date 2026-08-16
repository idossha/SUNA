import type { FsNode } from '@suna/core'
import type { ExplorerEditing, ExplorerRow } from '../state/explorer'

/** The directory a path lives in (the path itself when it has no parent). */
export function parentDirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : path
}

/** A pending create targets this directory (or something inside it). */
export function forcesOpen(editing: ExplorerEditing | null, dirPath: string): boolean {
  if (editing === null || editing.kind === 'rename') return false
  return editing.parentPath === dirPath || editing.parentPath.startsWith(`${dirPath}/`)
}

/**
 * Directories open by default when a project is first shown: the top two
 * levels. Depth is numbered exactly as visibleRows numbers it (top-level
 * entries are depth 0), which is what the tree used to do per-row with
 * `useState(depth < 2)` before expansion became explicit state.
 */
export function defaultExpanded(root: FsNode, maxDepth = 2): string[] {
  const out: string[] = []
  const walk = (node: FsNode, depth: number): void => {
    if (node.kind !== 'dir' || depth >= maxDepth) return
    out.push(node.path)
    for (const child of node.children) walk(child, depth + 1)
  }
  if (root.kind === 'dir') for (const child of root.children) walk(child, 0)
  return out
}

/**
 * Flatten the tree into the rows that are actually VISIBLE, in display order.
 * Arrow keys, shift-range selection and ⌘A all operate on this list, so "what
 * the keyboard steps through" and "what is on screen" cannot drift apart.
 */
export function visibleRows(
  root: FsNode,
  expanded: ReadonlySet<string>,
  editing: ExplorerEditing | null
): ExplorerRow[] {
  const rows: ExplorerRow[] = []
  const walk = (node: FsNode, depth: number): void => {
    rows.push({ node, depth })
    if (node.kind !== 'dir') return
    if (!expanded.has(node.path) && !forcesOpen(editing, node.path)) return
    for (const child of node.children) walk(child, depth + 1)
  }
  if (root.kind === 'dir') for (const child of root.children) walk(child, 0)
  return rows
}
