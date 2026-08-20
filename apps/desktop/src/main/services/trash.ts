import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { ensureGitignoreLine } from '@suna/agent'
import {
  SUNA_DIR,
  TrashIndexSchema,
  expiryOf,
  partitionExpired,
  sortByDeletedAt,
  trashDestination,
  trashPolicy,
  type TrashEntry,
  type TrashPolicy
} from '@suna/core'
import { writeFileAtomic } from './atomic'
import { assertInsideAllowedRoot, rootForPath } from './roots'
import { readSettings } from './settings'

/**
 * SUNA's own trash: a recycle bin for the light plain-text sources a project
 * is made of. Deleting a small FILE from the UI moves it here, where it stays
 * restorable for the retention window; a directory or an oversized file goes
 * to the OS trash instead (see @suna/core's trashDestination for the policy).
 *
 * The trash lives IN THE PROJECT, under `.suna/`:
 *   <project>/.suna/trash/index.json          the entries, atomically rewritten
 *   <project>/.suna/trash/files/<id>-<name>   the bytes, id-prefixed so two
 *                                             `notes.md` from different folders
 *                                             can coexist
 *
 * Per-project rather than app-wide because a deleted file belongs to the work
 * it was deleted from: it travels with the folder when the project is copied
 * to another machine, it cannot outlive the project it came from, and a
 * restore writes back into a tree that is open by construction. `.suna/` is
 * git-ignored — a recycle bin is machine-local state, not project history.
 *
 * Nothing here ever unlinks a user's file: emptying, purging a single row, and
 * automatic expiry all hand the stored copy to the OS trash. The only unlink
 * is of SUNA's own copy after a successful restore.
 */

function trashDir(root: string): string {
  return join(root, SUNA_DIR, 'trash')
}

function filesDir(root: string): string {
  return join(trashDir(root), 'files')
}

function indexPath(root: string): string {
  return join(trashDir(root), 'index.json')
}

async function policy(): Promise<TrashPolicy> {
  return trashPolicy(await readSettings())
}

/**
 * The index, or an empty one. Forgiving on purpose: a corrupt index must not
 * make the Trash view throw, it just shows nothing — the files stay on disk.
 */
async function readIndex(root: string): Promise<TrashEntry[]> {
  try {
    const parsed = TrashIndexSchema.safeParse(JSON.parse(await readFile(indexPath(root), 'utf8')))
    return parsed.success ? parsed.data.entries : []
  } catch {
    return []
  }
}

async function writeIndex(root: string, entries: TrashEntry[]): Promise<void> {
  await writeFileAtomic(indexPath(root), JSON.stringify({ entries }, null, 2) + '\n')
}

/** A stored file name that cannot collide and cannot escape the trash dir. */
function storedNameFor(id: string, name: string): string {
  return `${id}-${name.replace(/[/\\]/g, '_')}`
}

/**
 * Move `path` out of the project. A light file lands in the project's own
 * trash; anything else goes to the OS trash. Root-confined exactly like every
 * other write, so an agent cannot delete outside an open project.
 */
export async function trashEntry(path: string): Promise<{ destination: 'suna' | 'system' }> {
  const abs = assertInsideAllowedRoot(path)
  const info = await stat(abs)
  const current = await policy()
  const root = rootForPath(abs)
  const destination =
    root === null
      ? 'system'
      : trashDestination({ isDirectory: info.isDirectory(), bytes: info.size }, current)
  if (destination === 'system' || root === null) {
    await shell.trashItem(abs)
    return { destination: 'system' }
  }

  const id = randomUUID()
  const name = basename(abs)
  const storedName = storedNameFor(id, name)
  await mkdir(filesDir(root), { recursive: true })
  // The trash is machine-local state inside a git repo, so it has to be
  // ignored — including in a project scaffolded before this feature existed.
  // Additive and best-effort: a delete must not fail over a .gitignore line.
  await ensureGitignoreLine(root, `${SUNA_DIR}/`).catch(() => undefined)
  await moveFile(abs, join(filesDir(root), storedName))

  const deletedAt = new Date().toISOString()
  const entry: TrashEntry = {
    id,
    name,
    originalPath: abs,
    storedName,
    bytes: info.size,
    deletedAt,
    expiresAt: expiryOf(deletedAt, current.retentionDays)
  }
  await writeIndex(root, [entry, ...(await readIndex(root))])
  return { destination }
}

/**
 * rename first, copy+unlink on EXDEV. Within one project both ends are almost
 * always the same volume, but a project directory can itself be a mount point,
 * and a delete that failed there would be a delete that did nothing.
 */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(from, to)
    await unlink(from)
  }
}

/**
 * Everything restorable in this project, newest first. Expired rows are purged
 * to the OS trash on the way — the retention promise is kept by whoever opens
 * the view (and by the sweep on project open), so no timer has to be running
 * for it to hold.
 */
export async function listTrash(dir: string): Promise<TrashEntry[]> {
  return sortByDeletedAt(await purgeExpired(dir))
}

/** Purge this project's expired entries to the OS trash; returns what remains. */
export async function purgeExpired(dir: string, now: Date = new Date()): Promise<TrashEntry[]> {
  const root = assertInsideAllowedRoot(dir)
  const { live, expired } = partitionExpired(await readIndex(root), now)
  if (expired.length === 0) return live
  for (const entry of expired) await handToSystemTrash(root, entry)
  await writeIndex(root, live)
  return live
}

/** A stored file already gone (swept by hand) is not an error — just drop it. */
async function handToSystemTrash(root: string, entry: TrashEntry): Promise<void> {
  const stored = join(filesDir(root), entry.storedName)
  try {
    await stat(stored)
  } catch {
    return
  }
  await shell.trashItem(stored)
}

export interface RestoreOutcome {
  restored: { id: string; path: string }[]
  failed: { id: string; reason: string }[]
}

/**
 * Put files back where they came from. PARTIAL by contract, like fs:move: a
 * row whose name is taken again is reported rather than failing the batch.
 */
export async function restoreTrash(
  dir: string,
  ids: readonly string[]
): Promise<RestoreOutcome> {
  const root = assertInsideAllowedRoot(dir)
  const entries = await readIndex(root)
  const wanted = new Set(ids)
  const restored: { id: string; path: string }[] = []
  const failed: { id: string; reason: string }[] = []
  const kept: TrashEntry[] = []

  for (const entry of entries) {
    if (!wanted.has(entry.id)) {
      kept.push(entry)
      continue
    }
    try {
      await restoreOne(root, entry)
      restored.push({ id: entry.id, path: entry.originalPath })
    } catch (error) {
      kept.push(entry)
      failed.push({ id: entry.id, reason: describe(error) })
    }
  }
  for (const id of wanted) {
    if (!restored.some((r) => r.id === id) && !failed.some((f) => f.id === id)) {
      failed.push({ id, reason: 'this item is no longer in the trash' })
    }
  }
  if (restored.length > 0) await writeIndex(root, kept)
  return { restored, failed }
}

async function restoreOne(root: string, entry: TrashEntry): Promise<void> {
  // Re-asserted rather than trusted: the index is a file on disk, and an edited
  // originalPath must not become a write-anywhere primitive.
  const target = assertInsideAllowedRoot(entry.originalPath)
  const stored = join(filesDir(root), entry.storedName)
  await stat(stored).catch(() => {
    throw new Error('the stored copy is missing')
  })
  const existing = await stat(target).catch(() => null)
  if (existing) {
    throw new Error(`a ${existing.isDirectory() ? 'directory' : 'file'} already lives there`)
  }
  // The original directory may have been deleted since; recreate it rather
  // than refusing, so restoring a file never depends on folder archaeology.
  await mkdir(dirname(target), { recursive: true })
  await moveFile(stored, target)
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('path is outside any open project')) {
    return 'this item no longer belongs to this project'
  }
  return message.trim() === '' ? 'restore failed for an unknown reason' : message
}

/**
 * Hand entries to the OS trash and forget them. `ids` absent means "empty this
 * project's trash" — still to the OS trash, never destroyed here.
 */
export async function emptyTrash(dir: string, ids?: readonly string[]): Promise<number> {
  const root = assertInsideAllowedRoot(dir)
  const entries = await readIndex(root)
  const wanted = ids === undefined ? null : new Set(ids)
  const kept: TrashEntry[] = []
  let removed = 0
  for (const entry of entries) {
    if (wanted !== null && !wanted.has(entry.id)) {
      kept.push(entry)
      continue
    }
    await handToSystemTrash(root, entry)
    removed += 1
  }
  await writeIndex(root, kept)
  return removed
}
