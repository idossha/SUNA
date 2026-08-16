import { PROJECT_DIR_KEYS, type FsNode, type ProjectDirKey } from '@suna/core'
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

/** Which icon a file row carries, by extension. */
export type FileIconKind =
  | 'markdown'
  | 'bib'
  | 'json'
  | 'figure'
  | 'image'
  | 'pdf'
  | 'table'
  | 'code'
  | 'tex'
  | 'file'

/**
 * Extensions this app actually routes somewhere: the dock's own file→tab map
 * (state/dock.ts componentForFile + IMAGE_EXTENSIONS), the editor's language
 * packs (editor/codemirror.ts) and CLAUDE.md's sources of truth. Anything
 * else is a plain file — a tree icon that claims to know a format it cannot
 * open would be a lie.
 */
const FILE_ICON_KINDS: Record<string, FileIconKind> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.bib': 'bib',
  '.json': 'json',
  '.svg': 'figure',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.pdf': 'pdf',
  '.csv': 'table',
  '.tsv': 'table',
  '.py': 'code',
  '.js': 'code',
  '.mjs': 'code',
  '.ts': 'code',
  '.tex': 'tex'
}

/**
 * The extension is the LAST dot onwards, exactly as contentKindFor reads it,
 * so `figure.svg.suna.json` is the JSON sidecar and not the figure it
 * describes. A leading dot is not an extension either: `.gitignore` is a
 * plain file.
 */
export function iconKindForFile(name: string): FileIconKind {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return FILE_ICON_KINDS[dot >= 0 ? lower.slice(dot) : ''] ?? 'file'
}

/**
 * Absolute path → project directory key for the directories suna.json
 * declares. Driven from the manifest because those folder names are
 * user-editable (packages/core project.ts), and TOP LEVEL ONLY: a `figures/`
 * nested inside `manuscript/` is not the project's Figures directory.
 */
export function semanticDirs(
  rootDir: string | null,
  dirs: Partial<Record<ProjectDirKey, string>> | undefined
): Map<string, ProjectDirKey> {
  const out = new Map<string, ProjectDirKey>()
  if (rootDir === null || dirs === undefined) return out
  for (const key of PROJECT_DIR_KEYS) {
    const name = dirs[key]
    if (name !== undefined && name !== '') out.set(`${rootDir}/${name}`, key)
  }
  return out
}

/** A directory with something in it. Files are never expandable. */
export function hasChildren(node: FsNode): boolean {
  return node.kind === 'dir' && node.children.length > 0
}

/** Left inset for a row drawn at `depth`, shared by tree rows and edit rows so the two cannot drift. */
export function rowPaddingLeft(depth: number): number {
  return 8 + depth * 12
}
