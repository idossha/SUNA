import { shell } from 'electron'
import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { FsNode } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { assertInsideAllowedRoot } from './roots'

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__'])
const MAX_DEPTH = 10

export async function readText(path: string): Promise<string> {
  return readFile(assertInsideAllowedRoot(path), 'utf8')
}

export async function writeText(path: string, content: string): Promise<number> {
  const abs = assertInsideAllowedRoot(path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
  return Buffer.byteLength(content, 'utf8')
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

  const entries = await readdir(abs, { withFileTypes: true })
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
