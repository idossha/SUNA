import type { FsDirNode, FsNode } from '@suna/core'
import { parentDirOf } from './explorer-rows'

/**
 * Everything about an in-tree drag that can be decided without a DOM: where a
 * drop would land, whether it is legal, and what to say about it afterwards.
 * Kept apart from ExplorerView because a DragEvent is expensive to fake and
 * these rules are the part that has to be right.
 */

/**
 * Drag payload type for a move inside the tree. A private MIME rather than
 * text/plain alone for two reasons: a drag from another app (or from a text
 * field) must not read as an explorer move, and `dataTransfer.getData` is
 * unreadable during `dragover` — the type LIST is all a dragover handler is
 * allowed to inspect, so the type is what identifies the drag.
 */
export const EXPLORER_DRAG_MIME = 'application/x-suna-paths'

/**
 * Read a drag payload back out of the transfer. Unlike `dragover`, the `drop`
 * event may read the DataTransfer, and it is the contract — the renderer's own
 * "what am I dragging" ref is only the stand-in dragover is forced to use.
 * Returns null for anything that is not our JSON array of paths, so a drag
 * from elsewhere cannot be mistaken for a move.
 */
export function parseDragPayload(raw: string): string[] | null {
  if (raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  if (!parsed.every((entry) => typeof entry === 'string' && entry !== '')) return null
  return parsed as string[]
}

export interface DropResolution {
  /** The directory a drop here would move into; null when nothing resolves. */
  targetDir: string | null
  allowed: boolean
  /** Why not — worth showing the user. Null when allowed, or when the refusal
   *  is a plain no-op nobody needs told about. */
  reason: string | null
}

/** Last path segment. Paths in the renderer are POSIX-separated throughout
 *  (the tree builds them, parentDirOf and dock's titleForFile read them). */
function nameOf(path: string): string {
  return path.split('/').pop() ?? path
}

/**
 * `path` is strictly under `dir`. The trailing separator is the whole point:
 * a bare `startsWith(dir)` says /a/data2 lives inside /a/data, which is how a
 * folder ends up "moved into its own descendant".
 */
function isInside(path: string, dir: string): boolean {
  return path.startsWith(`${dir}/`)
}

/**
 * Where a drop lands: a folder row is the target itself, a file row is that
 * file's parent (Finder and VS Code both do this), and the empty area below
 * the rows is the project root.
 */
export function dropTargetDir(
  overPath: string | null,
  overIsDir: boolean,
  rootDir: string
): string {
  if (overPath === null) return rootDir
  return overIsDir ? overPath : parentDirOf(overPath)
}

/**
 * The subset of a drag that a drop into `targetDir` would actually move —
 * anything already living there stays put. Dropping a mixed selection into
 * one of its own source folders moves the rest rather than refusing the lot,
 * and the members already there must not be counted as name collisions with
 * themselves.
 */
export function pathsToMove(dragged: readonly string[], targetDir: string): string[] {
  return dragged.filter((path) => parentDirOf(path) !== targetDir)
}

/**
 * Entry names directly inside `dirPath` — what the collision guard reads.
 * `[]` means "unknown", not necessarily "empty": main's listTree stops walking
 * at MAX_DEPTH = 10, so a target deeper than that is absent from the tree and
 * findDir returns null. Main re-checks every destination and is the authority
 * on collisions; this guard is here to refuse early, not to be complete.
 */
export function namesInDir(root: FsNode | null, dirPath: string): string[] {
  const node = findDir(root, dirPath)
  return node === null ? [] : node.children.map((child) => child.name)
}

function findDir(node: FsNode | null, dirPath: string): FsDirNode | null {
  if (node === null || node.kind !== 'dir') return null
  if (node.path === dirPath) return node
  if (!isInside(dirPath, node.path)) return null
  for (const child of node.children) {
    const hit = findDir(child, dirPath)
    if (hit !== null) return hit
  }
  return null
}

/**
 * Resolve a hover (or a drop) over `overPath` — null for the tree's empty
 * area, i.e. the project root. `namesInTarget` is the entry list of the
 * directory `dropTargetDir` picks for the same arguments; the caller reads it
 * off the tree it is already holding.
 */
export function resolveDrop(args: {
  dragged: readonly string[]
  overPath: string | null
  overIsDir: boolean
  rootDir: string
  namesInTarget: readonly string[]
}): DropResolution {
  const { dragged, overPath, overIsDir, rootDir, namesInTarget } = args
  if (dragged.length === 0) return { targetDir: null, allowed: false, reason: null }

  const targetDir = dropTargetDir(overPath, overIsDir, rootDir)

  // Confinement, mirrored in main by assertInsideAllowedRoot. Cheap here and
  // it keeps a stale drag payload from a previous project out of the tree.
  if (targetDir !== rootDir && !isInside(targetDir, rootDir)) {
    return { targetDir: null, allowed: false, reason: 'That is outside the project folder' }
  }
  for (const path of dragged) {
    if (!isInside(path, rootDir)) {
      return { targetDir, allowed: false, reason: 'That is outside the project folder' }
    }
  }

  // A directory may not land in itself or in anything under it — and a row
  // inside the dragged set is never a target, which is the same check seen
  // from the other side.
  for (const path of dragged) {
    if (targetDir === path || isInside(targetDir, path)) {
      return { targetDir, allowed: false, reason: `Cannot move ${nameOf(path)} into itself` }
    }
  }

  const moving = pathsToMove(dragged, targetDir)
  // Everything is already here. A no-op, not an error: paint nothing, say
  // nothing.
  if (moving.length === 0) return { targetDir, allowed: false, reason: null }

  // A collision INSIDE the drag: a/fig.svg and b/fig.svg cannot both become
  // c/fig.svg. namesInTarget cannot see this one — the second file is not
  // there yet — so main would move the first and refuse the second, which is a
  // half-done drop. Refuse the lot at hover time instead.
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const path of moving) {
    const name = nameOf(path)
    if (seen.has(name)) dupes.add(name)
    seen.add(name)
  }
  if (dupes.size > 0) {
    const lead =
      dupes.size === 1 ? 'Two dragged items share the name' : 'Dragged items share the names'
    return { targetDir, allowed: false, reason: `${lead} ${[...dupes].join(', ')}` }
  }

  // Name the collision instead of letting fs.rename clobber it on POSIX.
  const taken = new Set(namesInTarget)
  const collisions = moving.map(nameOf).filter((name) => taken.has(name))
  if (collisions.length > 0) {
    const verb = collisions.length === 1 ? 'already exists' : 'already exist'
    return {
      targetDir,
      allowed: false,
      reason: `${collisions.join(', ')} ${verb} in ${nameOf(targetDir)}`
    }
  }

  return { targetDir, allowed: true, reason: null }
}

/** Longest cause a one-line status note carries; past this it is clamped. */
const MAX_CAUSE_CHARS = 60

/**
 * A failure reason cut down to what fits beside a file name in the status bar.
 * Main's reasons are verbatim Error messages that end in an ABSOLUTE path
 * (`refusing to overwrite an existing file: /Users/…/data/fig.svg`), and the
 * note already names the file, so the path is the part that goes. A message
 * this does not recognise keeps its own words — absolute paths shortened to
 * basenames, clamped rather than dropped — so a cause is never invented.
 */
function shortCause(reason: string): string {
  if (reason.includes('refusing to overwrite an existing')) return 'already exists'
  if (reason.includes('into itself or one of its own subfolders')) return 'cannot move into itself'
  // /a/b/fig.svg → fig.svg, quoted or mid-sentence alike.
  const trimmed = reason.replace(/(?:\/[^\s'"/]+)+\//g, '')
  return trimmed.length > MAX_CAUSE_CHARS ? `${trimmed.slice(0, MAX_CAUSE_CHARS - 1)}…` : trimmed
}

/**
 * The status note for a finished `fs:move` batch (feature-plan-9 §2). Partial
 * by contract, so the wording always says what moved AND what did not —
 * mirroring confirmDelete's multi-delete note. Null when the batch was empty.
 * Failures read as `name (cause)` with main's reason shortened by shortCause:
 * one status line has no room for the absolute paths those messages carry.
 */
export function moveNote(
  moved: readonly { from: string; to: string }[],
  failed: readonly { path: string; reason: string }[],
  targetDir: string
): string | null {
  if (moved.length === 0 && failed.length === 0) return null
  const target = `${nameOf(targetDir)}/`
  const blame = failed.map((f) => `${nameOf(f.path)} (${shortCause(f.reason)})`).join(', ')
  if (failed.length === 0) {
    return moved.length === 1
      ? `Moved ${nameOf(moved[0]?.to ?? '')} to ${target}`
      : `Moved ${moved.length} items to ${target}`
  }
  if (moved.length === 0) return `Could not move ${blame}`
  const items = moved.length === 1 ? '1 item' : `${moved.length} items`
  return `Moved ${items} to ${target}; ${failed.length} could not move: ${blame}`
}
