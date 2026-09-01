import type { Dirent, Stats } from 'node:fs'
import { constants } from 'node:fs'
import {
  copyFile,
  readdir,
  readFile,
  stat,
  writeFile,
  mkdir,
  rename
} from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { MAX_READ_BINARY_BYTES, type FsNode } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { assertInsideAllowedRoot } from './roots'

const IGNORED_NAMES = new Set(['.git', '.suna', 'node_modules', '.DS_Store', '__pycache__'])
const MAX_DEPTH = 10

export async function readText(path: string): Promise<string> {
  return readFile(assertInsideAllowedRoot(path), 'utf8')
}

export async function writeText(path: string, content: string): Promise<number> {
  const abs = assertInsideAllowedRoot(path)
  // Atomic (tmp + rename, mkdir included), same as manuscript.json/
  // comments.json: a crash mid-write must never truncate a prose file.
  await writeFileAtomic(abs, content)
  return Buffer.byteLength(content, 'utf8')
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/**
 * Read a file's bytes as base64 — root-confined exactly like readText, so the
 * renderer never touches file:// . PDFs and images arrive this way. Oversized
 * files are refused rather than blowing up renderer memory (the base64 payload
 * is ~4/3 the byte size and the viewer keeps the decoded copy too).
 */
export async function readBinary(path: string): Promise<{ base64: string; bytes: number }> {
  const abs = assertInsideAllowedRoot(path)
  const info = await stat(abs)
  if (!info.isFile()) throw new Error(`not a file: ${path}`)
  if (info.size > MAX_READ_BINARY_BYTES) {
    throw new Error(
      `file is too large to open: ${megabytes(info.size)} MB exceeds the ` +
        `${megabytes(MAX_READ_BINARY_BYTES)} MB limit (${path})`
    )
  }
  const buffer = await readFile(abs)
  return { base64: buffer.toString('base64'), bytes: buffer.byteLength }
}

/** A file's size in bytes — stat only, so a huge export costs nothing to measure. */
export async function fileSize(path: string): Promise<number> {
  const abs = assertInsideAllowedRoot(path)
  const info = await stat(abs)
  if (!info.isFile()) throw new Error(`not a file: ${path}`)
  return info.size
}

/**
 * Copy a file INTO the project ("Attach PDF…"). `from` deliberately escapes
 * the allowed roots — the user picks it anywhere on disk — while `to` is
 * root-confined like every other write. Never overwrites an existing target,
 * and never moves: the user's original stays where it was.
 */
export async function copyFileInto(from: string, to: string): Promise<string> {
  const target = assertInsideAllowedRoot(to)
  const source = resolve(from)
  const info = await stat(source).catch(() => {
    throw new Error(`file to copy does not exist: ${from}`)
  })
  if (!info.isFile()) throw new Error(`not a file: ${from}`)
  await mkdir(dirname(target), { recursive: true })
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`refusing to overwrite an existing file: ${to}`)
    }
    throw error
  }
  return target
}

/**
 * Write renderer-produced bytes (base64) inside the project — the raster half
 * of figure export, where the canvas lives in the renderer.
 */
export async function writeBinary(path: string, base64: string): Promise<string> {
  const abs = assertInsideAllowedRoot(path)
  await writeFileAtomic(abs, Buffer.from(base64, 'base64'))
  return abs
}

/** Same file on disk? Device + inode, so a case-only alias is not a collision. */
function isSameEntry(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

/**
 * Rename within the same directory; the new basename must not contain
 * separators.
 *
 * Never overwrites, same as moveOne below: `fs.rename` silently clobbers on
 * POSIX, so typing an existing sibling's name would destroy that sibling — and
 * the explorer retargets the open tab onto the new path afterwards, so the loss
 * would not even be visible. The destination is stat'd first and refused.
 */
export async function renameEntry(path: string, newName: string): Promise<string> {
  if (/[/\\]/.test(newName) || newName === '.' || newName === '..') {
    throw new Error(`invalid file name: ${newName}`)
  }
  const abs = assertInsideAllowedRoot(path)
  const target = join(dirname(abs), newName)
  assertInsideAllowedRoot(target)
  const existing = await stat(target).catch(() => null)
  // Identity, not existence: on a case-insensitive volume (APFS, which is the
  // macOS default) `notes.md` -> `Notes.md` stats the source itself, and
  // refusing that would block the one rename users make most often there.
  if (existing && !isSameEntry(existing, await stat(abs))) {
    const kind = existing.isDirectory() ? 'directory' : 'file'
    throw new Error(`refusing to overwrite an existing ${kind}: ${target}`)
  }
  await rename(abs, target)
  return target
}

/**
 * Would landing at `dest` put an entry inside `source` itself? Compared with a
 * separator boundary on both resolved paths: a bare `startsWith` would call
 * `/a/data2/data` a descendant of `/a/data` and refuse a perfectly good move.
 */
function landsInside(source: string, dest: string): boolean {
  return dest.startsWith(source + sep)
}

/**
 * Move entries INTO `targetDir`, keeping their basenames. Batched because one
 * drag-and-drop drop is one gesture and must be one tree refresh.
 *
 * Per-path failures are collected rather than thrown: the batch moves what it
 * can and names what it could not, the same convention multi-delete already
 * uses. A bad `targetDir` is the one exception — nothing can be moved, so it
 * throws instead of failing every path with the same sentence.
 *
 * Never overwrites. `fs.rename` silently clobbers on POSIX and drag-and-drop is
 * precisely the gesture that produces name collisions, so the destination is
 * stat'd first.
 *
 * No EXDEV copy+unlink fallback by design: a project lives in one tree, and a
 * cross-device rename that fails is reported verbatim rather than silently
 * doing something else.
 */
export async function moveEntries(
  paths: string[],
  targetDir: string
): Promise<{ moved: { from: string; to: string }[]; failed: { path: string; reason: string }[] }> {
  const target = assertInsideAllowedRoot(targetDir)
  const moved: { from: string; to: string }[] = []
  const failed: { path: string; reason: string }[] = []
  for (const path of paths) {
    try {
      moved.push(await moveOne(path, target))
    } catch (error) {
      failed.push({ path, reason: describeFailure(error) })
    }
  }
  return { moved, failed }
}

/**
 * Never empty: the 'fs:move' response validates `reason` as a non-empty string,
 * so an Error with a blank message (or a thrown '') would fail RESPONSE
 * validation and reject the whole call — discarding the report of everything
 * that DID move, which is the one thing the partial-outcome contract exists to
 * preserve. A path that fails for an unnameable reason still fails out loud.
 */
function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() === '' ? 'move failed for an unknown reason' : message
}

async function moveOne(path: string, target: string): Promise<{ from: string; to: string }> {
  const source = assertInsideAllowedRoot(path)
  const dest = join(target, basename(source))
  assertInsideAllowedRoot(dest)
  // The renderer's resolveDrop rejects this too; main re-checks because an
  // agent or a driver can call the channel without ever touching the tree.
  if (landsInside(source, dest)) {
    throw new Error(`cannot move a directory into itself or one of its own subfolders: ${path}`)
  }
  const existing = await stat(dest).catch(() => null)
  if (existing) {
    const kind = existing.isDirectory() ? 'directory' : 'file'
    throw new Error(`refusing to overwrite an existing ${kind}: ${dest}`)
  }
  await rename(source, dest)
  // Resolved on both sides: callers match `from` against open tab paths, which
  // come from listTree and are resolved the same way.
  return { from: source, to: dest }
}

/** Move to the OS trash — never a hard unlink, so users can recover. */
export async function makeDir(path: string): Promise<void> {
  await mkdir(assertInsideAllowedRoot(path), { recursive: true })
}

/** Create a new file; fails if it already exists (wx flag). */
export async function createFile(path: string, content: string): Promise<void> {
  const abs = assertInsideAllowedRoot(path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, { encoding: 'utf8', flag: 'wx' })
}

export async function listTree(dir: string): Promise<FsNode> {
  const abs = assertInsideAllowedRoot(dir)
  return walk(abs, 0)
}

async function walk(abs: string, depth: number): Promise<FsNode> {
  const name = basename(abs)
  if (depth >= MAX_DEPTH) return { kind: 'dir', name, path: abs, children: [] }

  // A missing or unreadable directory lists as empty rather than throwing:
  // callers scan OPTIONAL locations (a project's references/ folder, a
  // subtree removed outside the app), and a rejected fs:list there used to
  // surface as a startup crash.
  let entries: Dirent<string>[]
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch {
    return { kind: 'dir', name, path: abs, children: [] }
  }
  const children: FsNode[] = []
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue
    const childPath = join(abs, entry.name)
    if (entry.isDirectory()) {
      children.push(await walk(childPath, depth + 1))
    } else if (entry.isFile()) {
      children.push({ kind: 'file', name: entry.name, path: childPath })
    }
  }
  children.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1
  )
  return { kind: 'dir', name, path: abs, children }
}
