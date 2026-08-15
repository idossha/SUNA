import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_READ_BINARY_BYTES } from '@suna/core'
import { copyFileInto, readBinary } from './fs'
import { allowRoot } from './roots'

// fs.ts pulls `shell` in for trashEntry; nothing under test touches it.
vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))

let root = ''
let outside = ''

beforeEach(async () => {
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
