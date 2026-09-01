import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyReferenceNotes } from '@suna/core'
import { embedHighlightsIntoPdf, readReferenceNotes, writeReferenceNotes } from './refnotes'
import { allowRoot } from './roots'

/**
 * The notes sidecar service, and the guard on the one file SUNA overwrites but
 * did not create (ARCHITECTURE §14.4).
 */

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'suna-refnotes-svc-'))
  allowRoot(root)
})

const b64 = (text: string): string => Buffer.from(text, 'latin1').toString('base64')

async function writePdf(citekey: string, body: string): Promise<string> {
  const dir = join(root, 'references')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${citekey}.pdf`)
  await writeFile(path, Buffer.from(body, 'latin1'))
  return path
}

describe('readReferenceNotes', () => {
  it('reads a missing file as an empty one, and creates nothing', async () => {
    // Opening a paper nobody has annotated must not write to the project.
    expect(await readReferenceNotes(root, 'gunn1972')).toEqual(emptyReferenceNotes('gunn1972'))
    await expect(readFile(join(root, 'references', 'notes', 'gunn1972.json'))).rejects.toThrow()
  })

  it('surfaces corruption instead of silently discarding someone reading', async () => {
    await mkdir(join(root, 'references', 'notes'), { recursive: true })
    await writeFile(join(root, 'references', 'notes', 'gunn1972.json'), '{ not json', 'utf8')
    await expect(readReferenceNotes(root, 'gunn1972')).rejects.toThrow(/not valid JSON/)
  })

  it('refuses a citekey that would escape the notes directory', async () => {
    await expect(readReferenceNotes(root, '../../etc/passwd')).rejects.toThrow(/unsafe citekey/)
  })
})

describe('writeReferenceNotes', () => {
  it('round-trips through the schema', async () => {
    const file = { ...emptyReferenceNotes('gunn1972'), notes: [] }
    await writeReferenceNotes(root, 'gunn1972', file)
    expect(await readReferenceNotes(root, 'gunn1972')).toEqual(emptyReferenceNotes('gunn1972'))
  })

  it('refuses a payload that claims a different paper', async () => {
    // The filename IS the key; a file claiming otherwise would attach one
    // paper's reading to another's PDF the moment anything trusted the field.
    await expect(
      writeReferenceNotes(root, 'gunn1972', emptyReferenceNotes('moore1996'))
    ).rejects.toThrow(/but the target is/)
  })

  it('refuses input that is not a notes file at all', async () => {
    await expect(writeReferenceNotes(root, 'gunn1972', { nope: true })).rejects.toThrow()
  })

  it('refuses an unsafe citekey', async () => {
    await expect(
      writeReferenceNotes(root, '../escape', emptyReferenceNotes('../escape'))
    ).rejects.toThrow(/unsafe citekey/)
  })

  it('will not write outside the project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'suna-outside-'))
    await expect(
      writeReferenceNotes(outside, 'gunn1972', emptyReferenceNotes('gunn1972'))
    ).rejects.toThrow(/outside any open project/)
  })
})

describe('embedHighlightsIntoPdf — the overwrite guard', () => {
  it('writes an incremental save', async () => {
    const path = await writePdf('gunn1972', '%PDF-1.7 original')
    const result = await embedHighlightsIntoPdf(
      root,
      'gunn1972',
      b64('%PDF-1.7 original + annotations')
    )
    expect(result.bytesWritten).toBe('%PDF-1.7 original + annotations'.length)
    expect((await readFile(path)).toString('latin1')).toBe('%PDF-1.7 original + annotations')
  })

  it('refuses bytes that are not a PDF', async () => {
    await writePdf('gunn1972', '%PDF-1.7 original')
    await expect(embedHighlightsIntoPdf(root, 'gunn1972', b64('not a pdf at all'))).rejects.toThrow(
      /not a PDF/
    )
  })

  it('refuses a write that does not extend the file on disk', async () => {
    // The invariant that needs no stored baseline: saveDocument only appends,
    // so anything else was built against a document that no longer exists —
    // writing it would discard whatever changed the file in between.
    await writePdf('gunn1972', '%PDF-1.7 original')
    await expect(
      embedHighlightsIntoPdf(root, 'gunn1972', b64('%PDF-1.7 DIFFERENT + more'))
    ).rejects.toThrow(/changed while its highlights were being written/)
  })

  it('refuses a write shorter than the file on disk', async () => {
    await writePdf('gunn1972', '%PDF-1.7 original with plenty of bytes')
    await expect(embedHighlightsIntoPdf(root, 'gunn1972', b64('%PDF-'))).rejects.toThrow(
      /only ever grows the file/
    )
  })

  it('leaves the PDF untouched when it refuses', async () => {
    const path = await writePdf('gunn1972', '%PDF-1.7 original')
    await expect(
      embedHighlightsIntoPdf(root, 'gunn1972', b64('%PDF-1.7 DIFFERENT + more'))
    ).rejects.toThrow()
    expect((await readFile(path)).toString('latin1')).toBe('%PDF-1.7 original')
  })

  it('refuses an unsafe citekey before touching the filesystem', async () => {
    await expect(embedHighlightsIntoPdf(root, '../evil', b64('%PDF-x'))).rejects.toThrow(
      /unsafe citekey/
    )
  })
})
