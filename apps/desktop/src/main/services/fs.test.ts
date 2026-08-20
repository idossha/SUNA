import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { MAX_READ_BINARY_BYTES } from '@suna/core'
import { copyFileInto, moveEntries, readBinary, renameEntry } from './fs'
import { allowRoot } from './roots'


// rename() is the only call this file stubs, and only so ONE test can make it
// fail with an empty message — no real filesystem produces that. Every other
// test runs against the real rename, reinstalled in beforeEach.
const { renameMock } = vi.hoisted(() => ({ renameMock: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: renameMock }
})

let root = ''
let outside = ''

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  // Reset first: a queued *Once implementation must never leak into the next test.
  renameMock.mockReset().mockImplementation(actual.rename)
  root = await mkdtemp(join(tmpdir(), 'suna-fs-root-'))
  outside = await mkdtemp(join(tmpdir(), 'suna-fs-outside-'))
  allowRoot(root)
  await mkdir(join(root, 'references'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('readBinary', () => {
  it('returns base64 bytes and the decoded byte count', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    await writeFile(join(root, 'references', 'paper.pdf'), bytes)
    const result = await readBinary(join(root, 'references', 'paper.pdf'))
    expect(result.bytes).toBe(8)
    expect(Buffer.from(result.base64, 'base64')).toEqual(bytes)
  })

  it('refuses a path outside every open project root', async () => {
    await writeFile(join(outside, 'secret.pdf'), 'x')
    await expect(readBinary(join(outside, 'secret.pdf'))).rejects.toThrow(
      /outside any open project/
    )
  })

  it('refuses a traversal escape from inside a root', async () => {
    await expect(readBinary(join(root, '..', '..', 'etc', 'hosts'))).rejects.toThrow(
      /outside any open project/
    )
  })

  it('refuses a directory', async () => {
    await expect(readBinary(join(root, 'references'))).rejects.toThrow(/not a file/)
  })

  it('names both sizes when the file is over the limit', async () => {
    const path = join(root, 'huge.pdf')
    await writeFile(path, '')
    // sparse: no 200MB of real bytes written, only the reported size
    const handle = await import('node:fs/promises').then((m) => m.open(path, 'r+'))
    await handle.truncate(MAX_READ_BINARY_BYTES + 1)
    await handle.close()
    await expect(readBinary(path)).rejects.toThrow(/too large to open/)
    await expect(readBinary(path)).rejects.toThrow(/200\.0 MB limit/)
  })
})

describe('copyFileInto', () => {
  it('copies a file from outside the project into it and leaves the original', async () => {
    const source = join(outside, 'gunn1972.pdf')
    await writeFile(source, 'PDFBYTES')
    const target = join(root, 'references', 'gunn1972.pdf')
    expect(await copyFileInto(source, target)).toBe(target)
    expect(await readFile(target, 'utf8')).toBe('PDFBYTES')
    expect(await readFile(source, 'utf8')).toBe('PDFBYTES')
  })

  it('creates missing parent directories under the root', async () => {
    const source = join(outside, 'gunn1972.pdf')
    await writeFile(source, 'PDFBYTES')
    const target = join(root, 'references', 'nested', 'gunn1972.pdf')
    await copyFileInto(source, target)
    expect(await readFile(target, 'utf8')).toBe('PDFBYTES')
  })

  it('refuses to overwrite an existing file', async () => {
    const source = join(outside, 'gunn1972.pdf')
    await writeFile(source, 'NEW')
    const target = join(root, 'references', 'gunn1972.pdf')
    await writeFile(target, 'ORIGINAL')
    await expect(copyFileInto(source, target)).rejects.toThrow(/refusing to overwrite/)
    expect(await readFile(target, 'utf8')).toBe('ORIGINAL')
  })

  it('refuses a destination outside every open project root', async () => {
    const source = join(outside, 'gunn1972.pdf')
    await writeFile(source, 'PDFBYTES')
    await expect(copyFileInto(source, join(outside, 'copy.pdf'))).rejects.toThrow(
      /outside any open project/
    )
  })

  it('reports a missing source clearly', async () => {
    await expect(
      copyFileInto(join(outside, 'nope.pdf'), join(root, 'references', 'nope.pdf'))
    ).rejects.toThrow(/does not exist/)
  })
})

describe('renameEntry', () => {
  it('renames within the directory and returns the new path', async () => {
    await writeFile(join(root, 'draft.md'), 'D')
    expect(await renameEntry(join(root, 'draft.md'), 'final.md')).toBe(join(root, 'final.md'))
    expect(await readFile(join(root, 'final.md'), 'utf8')).toBe('D')
    await expect(stat(join(root, 'draft.md'))).rejects.toThrow()
  })

  it('refuses an existing sibling instead of clobbering it', async () => {
    await writeFile(join(root, 'a.md'), 'A')
    await writeFile(join(root, 'b.md'), 'B')
    await expect(renameEntry(join(root, 'a.md'), 'b.md')).rejects.toThrow(
      /refusing to overwrite an existing file/
    )
    // Both sides survive: rename() would have silently replaced b.md, and the
    // explorer would then have retargeted the open tab onto the wreckage.
    expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('A')
    expect(await readFile(join(root, 'b.md'), 'utf8')).toBe('B')
  })

  it('names the kind when the destination is an existing directory', async () => {
    await writeFile(join(root, 'notes.md'), 'N')
    await expect(renameEntry(join(root, 'notes.md'), 'references')).rejects.toThrow(
      /refusing to overwrite an existing directory/
    )
    expect((await stat(join(root, 'references'))).isDirectory()).toBe(true)
    expect(await readFile(join(root, 'notes.md'), 'utf8')).toBe('N')
  })

  it('still allows a case-only rename of the file onto itself', async () => {
    // On a case-insensitive volume the destination stats as the SOURCE; the
    // guard compares identity, so this must not read as a collision.
    await writeFile(join(root, 'notes.md'), 'N')
    expect(await renameEntry(join(root, 'notes.md'), 'Notes.md')).toBe(join(root, 'Notes.md'))
    expect(await readFile(join(root, 'Notes.md'), 'utf8')).toBe('N')
  })

  it('refuses a name that would cross directories', async () => {
    await writeFile(join(root, 'draft.md'), 'D')
    await expect(renameEntry(join(root, 'draft.md'), 'sub/final.md')).rejects.toThrow(
      /invalid file name/
    )
    await expect(renameEntry(join(root, 'draft.md'), '..')).rejects.toThrow(/invalid file name/)
    expect(await readFile(join(root, 'draft.md'), 'utf8')).toBe('D')
  })

  it('refuses a path outside every open project root', async () => {
    await writeFile(join(outside, 'secret.md'), 'x')
    await expect(renameEntry(join(outside, 'secret.md'), 'other.md')).rejects.toThrow(
      /outside any open project/
    )
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('x')
  })
})

describe('moveEntries', () => {
  it('moves a file into a folder and reports resolved from/to', async () => {
    await writeFile(join(root, 'fig.svg'), '<svg/>')
    const result = await moveEntries([join(root, 'fig.svg')], join(root, 'references'))
    expect(result.failed).toEqual([])
    expect(result.moved).toEqual([
      { from: join(root, 'fig.svg'), to: join(root, 'references', 'fig.svg') }
    ])
    expect(await readFile(join(root, 'references', 'fig.svg'), 'utf8')).toBe('<svg/>')
    await expect(stat(join(root, 'fig.svg'))).rejects.toThrow()
  })

  it('refuses an existing destination instead of clobbering it', async () => {
    await writeFile(join(root, 'fig.svg'), 'NEW')
    await writeFile(join(root, 'references', 'fig.svg'), 'ORIGINAL')
    const result = await moveEntries([join(root, 'fig.svg')], join(root, 'references'))
    expect(result.moved).toEqual([])
    expect(result.failed[0]?.reason).toMatch(/refusing to overwrite an existing file/)
    // Both sides survive: rename() would have silently replaced the original.
    expect(await readFile(join(root, 'references', 'fig.svg'), 'utf8')).toBe('ORIGINAL')
    expect(await readFile(join(root, 'fig.svg'), 'utf8')).toBe('NEW')
  })

  it('refuses a directory dropped into itself or into its own subfolder', async () => {
    await mkdir(join(root, 'data', 'raw'), { recursive: true })
    const intoChild = await moveEntries([join(root, 'data')], join(root, 'data', 'raw'))
    expect(intoChild.moved).toEqual([])
    expect(intoChild.failed[0]?.reason).toMatch(/into itself or one of its own subfolders/)
    const intoItself = await moveEntries([join(root, 'data')], join(root, 'data'))
    expect(intoItself.moved).toEqual([])
    expect(intoItself.failed[0]?.reason).toMatch(/into itself or one of its own subfolders/)
    expect((await stat(join(root, 'data', 'raw'))).isDirectory()).toBe(true)
  })

  it('moves data/ into the sibling data2/ — a name prefix is not a descendant', async () => {
    await mkdir(join(root, 'data'), { recursive: true })
    await mkdir(join(root, 'data2'), { recursive: true })
    await writeFile(join(root, 'data', 'trace.csv'), 't,1')
    const result = await moveEntries([join(root, 'data')], join(root, 'data2'))
    expect(result.failed).toEqual([])
    expect(result.moved).toEqual([{ from: join(root, 'data'), to: join(root, 'data2', 'data') }])
    expect(await readFile(join(root, 'data2', 'data', 'trace.csv'), 'utf8')).toBe('t,1')
  })

  it('refuses a source outside every open project root and leaves it in place', async () => {
    await writeFile(join(outside, 'secret.pdf'), 'x')
    const result = await moveEntries([join(outside, 'secret.pdf')], join(root, 'references'))
    expect(result.moved).toEqual([])
    expect(result.failed[0]?.reason).toMatch(/outside any open project/)
    expect(await readFile(join(outside, 'secret.pdf'), 'utf8')).toBe('x')
  })

  it('throws on a target outside every open project root — nothing could move', async () => {
    await writeFile(join(root, 'fig.svg'), '<svg/>')
    await expect(moveEntries([join(root, 'fig.svg')], outside)).rejects.toThrow(
      /outside any open project/
    )
    expect(await readFile(join(root, 'fig.svg'), 'utf8')).toBe('<svg/>')
  })

  it('moves what it can and names what it could not', async () => {
    await writeFile(join(root, 'a.md'), 'A')
    await writeFile(join(root, 'b.md'), 'B')
    await writeFile(join(root, 'c.md'), 'C')
    await writeFile(join(root, 'references', 'b.md'), 'EXISTING')
    const result = await moveEntries(
      [join(root, 'a.md'), join(root, 'b.md'), join(root, 'c.md')],
      join(root, 'references')
    )
    expect(result.moved.map((entry) => basename(entry.to))).toEqual(['a.md', 'c.md'])
    expect(result.failed).toEqual([
      {
        path: join(root, 'b.md'),
        reason: `refusing to overwrite an existing file: ${join(root, 'references', 'b.md')}`
      }
    ])
    expect(await readFile(join(root, 'references', 'b.md'), 'utf8')).toBe('EXISTING')
    expect(await readFile(join(root, 'references', 'c.md'), 'utf8')).toBe('C')
  })

  it('reports a non-empty reason even when the failure carries no message', async () => {
    await writeFile(join(root, 'a.md'), 'A')
    await writeFile(join(root, 'b.md'), 'B')
    renameMock.mockRejectedValueOnce(new Error(''))
    const result = await moveEntries(
      [join(root, 'a.md'), join(root, 'b.md')],
      join(root, 'references')
    )
    // 'fs:move' validates failed[].reason with z.string().min(1): an empty
    // reason fails RESPONSE validation and rejects the whole call, throwing
    // away the report of b.md — which DID move.
    expect(result.failed).toEqual([
      { path: join(root, 'a.md'), reason: expect.stringMatching(/\S/) }
    ])
    expect(result.moved).toEqual([
      { from: join(root, 'b.md'), to: join(root, 'references', 'b.md') }
    ])
  })
})
