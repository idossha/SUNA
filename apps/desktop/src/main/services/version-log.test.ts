import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listVersions, logVersion, readVersionFile } from './version-log'

/**
 * The version archive on disk. The contract under test: a log is a complete
 * copy, the archive never copies itself, and the numbering follows the stage
 * the author picked.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-version-'))
  await mkdir(join(dir, 'manuscript', 'figures'), { recursive: true })
  await writeFile(join(dir, 'manuscript', 'manuscript.json'), '{"title":"A paper"}\n')
  await writeFile(join(dir, 'manuscript', 'manuscript.md'), '# Introduction\n\nDraft one.\n')
  await writeFile(join(dir, 'manuscript', 'figures', 'note.txt'), 'nested\n')
  await mkdir(join(dir, 'code', '__pycache__'), { recursive: true })
  await mkdir(join(dir, 'analysis'), { recursive: true })
  await mkdir(join(dir, 'figures', 'fig1'), { recursive: true })
  await writeFile(join(dir, 'code', 'reduce.py'), 'print(1)\n')
  await writeFile(join(dir, 'code', '__pycache__', 'reduce.pyc'), 'junk\n')
  await writeFile(join(dir, 'analysis', 'stats.ipynb'), '{}\n')
  await writeFile(join(dir, 'figures', 'fig1', 'figure.svg'), '<svg/>\n')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('logVersion', () => {
  it('copies every manuscript file, nesting included', async () => {
    const version = await logVersion({ rootDir: dir })
    expect(version.id).toBe('v0.1')
    expect(version.files).toContain('manuscript/manuscript.json')
    expect(version.files).toContain('manuscript/figures/note.txt')
    expect(version.hashes).toHaveLength(version.files.length)
    expect(await readVersionFile(dir, 'v0.1', 'manuscript/manuscript.md')).toBe(
      '# Introduction\n\nDraft one.\n'
    )
    expect(await readVersionFile(dir, 'v0.1', 'manuscript/figures/note.txt')).toBe('nested\n')
  })

  it('freezes the work behind the manuscript: code, analysis and figures', async () => {
    const version = await logVersion({ rootDir: dir })
    expect(version.areas).toEqual(['manuscript', 'code', 'analysis', 'figures'])
    expect(version.files).toEqual(
      expect.arrayContaining([
        'code/reduce.py',
        'analysis/stats.ipynb',
        'figures/fig1/figure.svg'
      ])
    )
    expect(await readVersionFile(dir, 'v0.1', 'code/reduce.py')).toBe('print(1)\n')
    expect(await readVersionFile(dir, 'v0.1', 'figures/fig1/figure.svg')).toBe('<svg/>\n')
    // Build noise is not part of the record.
    expect(version.files.some((f) => f.includes('__pycache__'))).toBe(false)
  })

  it('records only the areas that exist', async () => {
    await rm(join(dir, 'code'), { recursive: true, force: true })
    await rm(join(dir, 'analysis'), { recursive: true, force: true })
    const version = await logVersion({ rootDir: dir })
    expect(version.areas).toEqual(['manuscript', 'figures'])
  })

  it('leaves the working copy free to move on, and does not archive the archive', async () => {
    await logVersion({ rootDir: dir })
    await writeFile(join(dir, 'manuscript', 'manuscript.md'), 'Draft two.\n')
    const second = await logVersion({ rootDir: dir })

    expect(second.id).toBe('v0.2')
    expect(second.files.some((f) => f.startsWith('manuscript/archive'))).toBe(false)
    // The first copy is untouched by later edits — that is the whole point.
    expect(await readVersionFile(dir, 'v0.1', 'manuscript/manuscript.md')).toBe(
      '# Introduction\n\nDraft one.\n'
    )
    expect(await readVersionFile(dir, 'v0.2', 'manuscript/manuscript.md')).toBe('Draft two.\n')
  })

  it('numbers by stage: internal, submission, after review', async () => {
    await logVersion({ rootDir: dir })
    expect((await logVersion({ rootDir: dir, stage: 1 })).id).toBe('v1.1')
    // Once submitted, an unqualified log stays in the submission stage.
    expect((await logVersion({ rootDir: dir })).id).toBe('v1.2')
    expect((await logVersion({ rootDir: dir, stage: 2, note: 'revised' })).id).toBe('v2.1')

    const versions = await listVersions(dir)
    expect(versions.map((v) => v.id)).toEqual(['v0.1', 'v1.1', 'v1.2', 'v2.1'])
    expect(versions[3]?.note).toBe('revised')
  })

  it('writes a self-describing record beside the copy', async () => {
    await logVersion({ rootDir: dir, note: 'sent to Ada' })
    const raw = await readFile(
      join(dir, 'manuscript', 'archive', 'v0.1', 'version.json'),
      'utf8'
    )
    expect(JSON.parse(raw)).toMatchObject({ id: 'v0.1', stage: 0, note: 'sent to Ada' })
  })

  it('refuses a path that climbs out of the version', async () => {
    await logVersion({ rootDir: dir })
    await expect(readVersionFile(dir, 'v0.1', '../../suna.json')).rejects.toThrow(/escapes/)
  })
})
