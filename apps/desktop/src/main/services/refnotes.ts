import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  REFERENCE_NOTES_DIR,
  ReferenceNotesFileSchema,
  emptyReferenceNotes,
  isSafeCitekey,
  type ReferenceNotesFile
} from '@suna/core'
import { writeFileAtomic } from './atomic'
import { assertInsideAllowedRoot } from './roots'

const sha256 = (bytes: Uint8Array | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex')

/**
 * `references/notes/<citekey>.json` — reading notes on a reference PDF
 * (ADR-008). Same discipline as comments.json: read fresh, validate, write
 * atomically, and never silently discard a file that fails to parse.
 *
 * One file per paper rather than one for the project, so a highlight is a
 * small write and `git diff` on a paper shows that paper's reading.
 */

/**
 * Absolute path of the notes directory, created if needed, with the project
 * boundary asserted against what the filesystem will actually reach.
 *
 * The lexical check is not enough on its own and this is the same hole
 * `prepareReferencesDir` documents for ADR-007: a `references/` that is a
 * symlink out of the project passes any string-prefix test, and `mkdir -p`
 * then follows the link. So the directory and the project root are BOTH
 * realpath-resolved after the directory exists, and the prefix is re-asserted
 * on the resolved pair.
 */
async function prepareNotesDir(dir: string): Promise<string> {
  const root = assertInsideAllowedRoot(dir)
  const notesDir = join(root, REFERENCE_NOTES_DIR)
  await mkdir(notesDir, { recursive: true })

  const [realRoot, realNotes] = await Promise.all([realpath(root), realpath(notesDir)])
  if (realNotes !== realRoot && !realNotes.startsWith(realRoot + sep)) {
    throw new Error(
      `${REFERENCE_NOTES_DIR} resolves outside the project: ${JSON.stringify(realNotes)}`
    )
  }
  return realNotes
}

/** Notes file path for a citekey, refusing a key that could escape the directory. */
function notesFilePath(notesDir: string, citekey: string): string {
  if (!isSafeCitekey(citekey)) {
    throw new Error(`unsafe citekey: ${JSON.stringify(citekey)}`)
  }
  const file = resolve(notesDir, `${citekey}.json`)
  if (!file.startsWith(notesDir + sep)) {
    throw new Error(`notes path escapes the notes directory: ${JSON.stringify(citekey)}`)
  }
  return file
}

/**
 * Read one paper's notes. A missing file is an empty file, not an error — a
 * paper nobody has annotated yet is the normal case, and reading one must
 * never create anything on disk.
 */
export async function readReferenceNotes(
  dir: string,
  citekey: string
): Promise<ReferenceNotesFile> {
  if (!isSafeCitekey(citekey)) throw new Error(`unsafe citekey: ${JSON.stringify(citekey)}`)
  const root = assertInsideAllowedRoot(dir)
  const file = join(root, REFERENCE_NOTES_DIR, `${citekey}.json`)

  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return emptyReferenceNotes(citekey)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    // Never silently discard someone's reading: surface the corruption.
    throw new Error(
      `${REFERENCE_NOTES_DIR}/${citekey}.json is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  return ReferenceNotesFileSchema.parse(parsed)
}

/**
 * Validate and write one paper's notes atomically.
 *
 * The citekey in the payload must match the one being written to: the filename
 * IS the key, and a file whose contents claim a different paper would attach
 * one paper's reading to another's PDF the next time anything trusted the
 * field instead of the name.
 */
export async function writeReferenceNotes(
  dir: string,
  citekey: string,
  file: unknown
): Promise<void> {
  const validated = ReferenceNotesFileSchema.parse(file)
  if (validated.citekey !== citekey) {
    throw new Error(
      `notes payload is for ${JSON.stringify(validated.citekey)} but the target is ${JSON.stringify(citekey)}`
    )
  }
  const notesDir = await prepareNotesDir(dir)
  const path = notesFilePath(notesDir, citekey)
  await writeFileAtomic(path, JSON.stringify(validated, null, 2) + '\n')
}

// ---------------------------------------------------------------------------
// Native annotations in the PDF itself (ADR-008, amended: in place, never a
// copy in output/).
// ---------------------------------------------------------------------------

/** `references/<citekey>.pdf`, with the project boundary asserted. */
function referencePdfPath(dir: string, citekey: string): string {
  if (!isSafeCitekey(citekey)) throw new Error(`unsafe citekey: ${JSON.stringify(citekey)}`)
  return join(assertInsideAllowedRoot(dir), 'references', `${citekey}.pdf`)
}

export interface EmbedResult {
  bytesWritten: number
}

/**
 * Replace `references/<citekey>.pdf` with the incrementally-saved copy the
 * renderer produced.
 *
 * One invariant, and it needs nothing remembered: **the incoming bytes must
 * begin with the file that is on disk right now.** `saveDocument()` only ever
 * appends, so an incoming file that does not extend the current one was built
 * against a document that no longer exists, and writing it would discard
 * whatever changed in between.
 *
 * This replaced a recorded pristine baseline. The baseline worked until
 * another application rewrote the paper — Preview rewrites rather than
 * appends, taking a 1,188,902-byte Nature PDF to 800,682 and perturbing its
 * font table — after which it could never match again and SUNA was locked out
 * of that file permanently. Comparing against the live file has no such state
 * to go stale: a foreign edit simply becomes the new thing we append to.
 */
export async function embedHighlightsIntoPdf(
  dir: string,
  citekey: string,
  base64: string
): Promise<EmbedResult> {
  const path = referencePdfPath(dir, citekey)
  const incoming = Buffer.from(base64, 'base64')

  if (incoming.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('refusing to write bytes that are not a PDF')
  }

  const onDisk = await readFile(path)
  if (incoming.length < onDisk.length) {
    throw new Error(
      `refusing to write ${incoming.length} bytes over the ${onDisk.length} bytes on disk: ` +
        'an incremental save only ever grows the file'
    )
  }
  if (!incoming.subarray(0, onDisk.length).equals(onDisk)) {
    throw new Error(
      'the PDF changed while its highlights were being written, so the update was ' +
        'built against a file that no longer exists; nothing was written'
    )
  }

  await writeFileAtomic(path, incoming)
  return { bytesWritten: incoming.length }
}

/** One paper's notes, as the cross-paper view reads them. */
export interface PaperNotes {
  citekey: string
  file: ReferenceNotesFile
}

/**
 * Every paper's notes in one call.
 *
 * Notes are stored per paper so that making a highlight is a small write and
 * `git diff` on a paper shows that paper's reading. Reading ACROSS papers is
 * the other half of that trade, and doing it a file at a time from the
 * renderer would be one IPC round trip per reference.
 *
 * A sidecar that fails to parse is skipped rather than failing the whole call:
 * one corrupt file must not hide every other paper's reading.
 */
export async function listAllReferenceNotes(dir: string): Promise<PaperNotes[]> {
  const root = assertInsideAllowedRoot(dir)
  let names: string[]
  try {
    names = await readdir(join(root, REFERENCE_NOTES_DIR))
  } catch {
    return []
  }

  const out: PaperNotes[] = []
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue
    const citekey = name.slice(0, -5)
    if (!isSafeCitekey(citekey)) continue
    try {
      out.push({ citekey, file: await readReferenceNotes(root, citekey) })
    } catch {
      // Corrupt or unreadable — skip it, and let the per-paper read report it.
    }
  }
  return out
}
