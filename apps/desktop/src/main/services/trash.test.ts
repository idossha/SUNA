import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUNA_DIR, TRASH_KEYS } from '@suna/core'
import { allowRoot } from './roots'

// shell.trashItem is recorded rather than performed — a unit test must not put
// anything in the real OS trash.
const { trashed } = vi.hoisted(() => ({ trashed: [] as string[] }))
vi.mock('electron', () => ({
  shell: {
    trashItem: async (path: string) => {
      trashed.push(path)
      await (await import('node:fs/promises')).rm(path, { recursive: true, force: true })
    }
  }
}))

// The policy comes from global settings; the test drives it directly.
const { settings } = vi.hoisted(() => ({ settings: { value: {} as Record<string, unknown> } }))
vi.mock('./settings', () => ({ readSettings: async () => settings.value }))

const { emptyTrash, listTrash, purgeExpired, restoreTrash, trashEntry } = await import('./trash')

let root = ''

beforeEach(async () => {
  trashed.length = 0
  settings.value = {}
  root = await mkdtemp(join(tmpdir(), 'suna-trash-root-'))
  allowRoot(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeSized(name: string, bytes: number): Promise<string> {
  const path = join(root, name)
  await mkdir(join(root, '..'), { recursive: true })
  await writeFile(path, 'x'.repeat(bytes))
  return path
}

describe('trashEntry', () => {
  it('moves a light file into SUNA trash and leaves it restorable', async () => {
    const path = await writeSized('notes.md', 12)

    expect(await trashEntry(path)).toEqual({ destination: 'suna' })
    await expect(stat(path)).rejects.toThrow()
    expect(trashed).toEqual([])

    const entries = await listTrash(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'notes.md', originalPath: path, bytes: 12 })
  })

  it('sends a file over the size limit to the OS trash instead', async () => {
    settings.value = { [TRASH_KEYS.maxFileMb]: 0.001 } // 1 KB
    const path = await writeSized('big.svg', 4096)

    expect(await trashEntry(path)).toEqual({ destination: 'system' })
    expect(trashed).toEqual([path])
    expect(await listTrash(root)).toEqual([])
  })

  it('sends directories to the OS trash whatever their size', async () => {
    const dir = join(root, 'figures')
    await mkdir(dir, { recursive: true })

    expect(await trashEntry(dir)).toEqual({ destination: 'system' })
    expect(trashed).toEqual([dir])
  })

  it('stores the file under the project\'s own .suna/trash, not in userData', async () => {
    const path = await writeSized('notes.md', 5)
    await trashEntry(path)
    const [entry] = await listTrash(root)

    const stored = join(root, SUNA_DIR, 'trash', 'files', entry!.storedName)
    expect(await readFile(stored, 'utf8')).toBe('xxxxx')
    expect(JSON.parse(await readFile(join(root, SUNA_DIR, 'trash', 'index.json'), 'utf8'))).toEqual(
      { entries: [entry] }
    )
  })

  it('git-ignores .suna/ on first use, additively, in a project scaffolded before it existed', async () => {
    await writeFile(join(root, '.gitignore'), 'output/\n')
    await trashEntry(await writeSized('notes.md', 3))

    const ignore = await readFile(join(root, '.gitignore'), 'utf8')
    expect(ignore).toBe('output/\n.suna/\n')
    // Idempotent: a second delete must not append the line again.
    await trashEntry(await writeSized('other.md', 3))
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('output/\n.suna/\n')
  })

  it('keeps each project\'s trash to itself', async () => {
    const other = await mkdtemp(join(tmpdir(), 'suna-trash-other-'))
    allowRoot(other)
    await writeFile(join(other, 'theirs.md'), 'theirs')
    await writeFile(join(root, 'ours.md'), 'ours')
    await trashEntry(join(other, 'theirs.md'))
    await trashEntry(join(root, 'ours.md'))

    expect((await listTrash(root)).map((e) => e.name)).toEqual(['ours.md'])
    expect((await listTrash(other)).map((e) => e.name)).toEqual(['theirs.md'])
    await rm(other, { recursive: true, force: true })
  })

  it('refuses a path outside every open project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'suna-outside-'))
    const path = join(outside, 'stray.md')
    await writeFile(path, 'x')
    await expect(trashEntry(path)).rejects.toThrow(/outside any open project/)
    await rm(outside, { recursive: true, force: true })
  })

  it('keeps two same-named files from different folders apart', async () => {
    await mkdir(join(root, 'a'), { recursive: true })
    await mkdir(join(root, 'b'), { recursive: true })
    await writeFile(join(root, 'a', 'notes.md'), 'from a')
    await writeFile(join(root, 'b', 'notes.md'), 'from b')

    await trashEntry(join(root, 'a', 'notes.md'))
    await trashEntry(join(root, 'b', 'notes.md'))

    await restoreTrash(root, (await listTrash(root)).map((e) => e.id))
    expect(await readFile(join(root, 'a', 'notes.md'), 'utf8')).toBe('from a')
    expect(await readFile(join(root, 'b', 'notes.md'), 'utf8')).toBe('from b')
  })
})

describe('restoreTrash', () => {
  it('puts the file back, byte for byte, and drops the entry', async () => {
    const path = await writeSized('refs.bib', 0)
    await writeFile(path, '@article{gunn1972,}')
    await trashEntry(path)
    const [entry] = await listTrash(root)

    const outcome = await restoreTrash(root, [entry!.id])
    expect(outcome).toEqual({ restored: [{ id: entry!.id, path }], failed: [] })
    expect(await readFile(path, 'utf8')).toBe('@article{gunn1972,}')
    expect(await listTrash(root)).toEqual([])
  })

  it('recreates a folder that was deleted after the file was', async () => {
    await mkdir(join(root, 'drafts'), { recursive: true })
    const path = join(root, 'drafts', 'intro.md')
    await writeFile(path, 'intro')
    await trashEntry(path)
    await rm(join(root, 'drafts'), { recursive: true, force: true })

    const [entry] = await listTrash(root)
    expect((await restoreTrash(root, [entry!.id])).restored).toHaveLength(1)
    expect(await readFile(path, 'utf8')).toBe('intro')
  })

  it('refuses to overwrite a file that took the name back, and keeps the entry', async () => {
    const path = await writeSized('notes.md', 3)
    await trashEntry(path)
    await writeFile(path, 'a new notes.md')
    const [entry] = await listTrash(root)

    const outcome = await restoreTrash(root, [entry!.id])
    expect(outcome.restored).toEqual([])
    expect(outcome.failed[0]?.reason).toMatch(/already lives there/)
    expect(await readFile(path, 'utf8')).toBe('a new notes.md')
    // Still recoverable: a refused restore must not lose the trashed copy.
    expect(await listTrash(root)).toHaveLength(1)
  })

  it('reports an unknown id rather than failing the batch', async () => {
    const path = await writeSized('notes.md', 3)
    await trashEntry(path)
    const [entry] = await listTrash(root)

    const outcome = await restoreTrash(root, [entry!.id, 'no-such-id'])
    expect(outcome.restored).toHaveLength(1)
    expect(outcome.failed).toEqual([
      { id: 'no-such-id', reason: 'this item is no longer in the trash' }
    ])
  })
})

describe('retention', () => {
  it('purges entries past their stamped expiry to the OS trash', async () => {
    settings.value = { [TRASH_KEYS.retentionDays]: 1 }
    const path = await writeSized('old.md', 3)
    await trashEntry(path)
    const [entry] = await listTrash(root)

    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    expect(await purgeExpired(root, later)).toEqual([])
    expect(trashed).toEqual([join(root, SUNA_DIR, 'trash', 'files', entry!.storedName)])
    expect(await listTrash(root)).toEqual([])
  })

  it('leaves an entry that is still inside its window', async () => {
    const path = await writeSized('fresh.md', 3)
    await trashEntry(path)
    expect(await purgeExpired(root, new Date())).toHaveLength(1)
    expect(trashed).toEqual([])
  })
})

describe('emptyTrash', () => {
  it('hands everything to the OS trash and empties the index', async () => {
    await writeFile(join(root, 'a.md'), 'a')
    await writeFile(join(root, 'b.md'), 'b')
    await trashEntry(join(root, 'a.md'))
    await trashEntry(join(root, 'b.md'))

    expect(await emptyTrash(root)).toBe(2)
    expect(trashed).toHaveLength(2)
    expect(await listTrash(root)).toEqual([])
  })

  it('empties only the named entries when ids are given', async () => {
    await writeFile(join(root, 'a.md'), 'a')
    await writeFile(join(root, 'b.md'), 'b')
    await trashEntry(join(root, 'a.md'))
    await trashEntry(join(root, 'b.md'))
    const entries = await listTrash(root)

    expect(await emptyTrash(root, [entries[0]!.id])).toBe(1)
    expect((await listTrash(root)).map((e) => e.name)).toEqual([entries[1]!.name])
  })
})
