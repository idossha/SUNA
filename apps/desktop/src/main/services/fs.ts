import { shell } from 'electron'
import type { Dirent } from 'node:fs'
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
import { basename, dirname, join, resolve } from 'node:path'
import { MAX_READ_BINARY_BYTES, type FsNode } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { assertInsideAllowedRoot } from './roots'

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__'])
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

/** Rename within the same directory; the new basename must not contain separators. */
export async function renameEntry(path: string, newName: string): Promise<string> {
  if (/[/\\]/.test(newName) || newName === '.' || newName === '..') {
    throw new Error(`invalid file name: ${newName}`)
  }
  const abs = assertInsideAllowedRoot(path)
  const target = join(dirname(abs), newName)
  assertInsideAllowedRoot(target)
  await rename(abs, target)
  return target
}

/** Move to the OS trash — never a hard unlink, so users can recover. */
export async function trashEntry(path: string): Promise<void> {
  await shell.trashItem(assertInsideAllowedRoot(path))
}

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
