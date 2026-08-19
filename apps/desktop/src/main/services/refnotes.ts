import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
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

export interface PristineBaseline {
  base64: string
  pristineBytes: number
  pristineSha256: string
  hasEmbedded: boolean
  conflict: string | null
}

/**
 * The reference PDF as it was before SUNA appended anything.
 *
 * `saveDocument()` only ever appends, so the pristine copy is literally the
 * first `pristineBytes` of the file on disk. When nothing has been embedded
 * yet the whole file IS the baseline, and that is what gets recorded.
 *
 * `conflict` is set — and the FULL file returned untouched — when the recorded
 * baseline no longer hashes right. That means something other than SUNA
 * rewrote the file (Preview rewrites rather than appends: one highlight took a
 * 1,188,902-byte Nature PDF to 800,682 and perturbed its font table), and
 * truncating to a stale length would destroy it. The caller reports rather
 * than repairs.
 */
export async function readPristinePdf(
  dir: string,
  citekey: string,
  recorded: { pristineBytes: number; pristineSha256: string } | null
): Promise<PristineBaseline> {
  const path = referencePdfPath(dir, citekey)
  const bytes = await readFile(path)

  if (recorded === null || recorded.pristineBytes === 0) {
    return {
      base64: bytes.toString('base64'),
      pristineBytes: bytes.length,
      pristineSha256: sha256(bytes),
      hasEmbedded: false,
      conflict: null
    }
  }

  if (recorded.pristineBytes > bytes.length) {
    return {
      base64: bytes.toString('base64'),
      pristineBytes: bytes.length,
      pristineSha256: sha256(bytes),
      hasEmbedded: false,
      conflict:
        `the PDF is now shorter (${bytes.length} bytes) than the ${recorded.pristineBytes}-byte ` +
        'baseline SUNA recorded, so it was replaced or rewritten by another tool'
    }
  }

  const prefix = bytes.subarray(0, recorded.pristineBytes)
  const actual = sha256(prefix)
  if (actual !== recorded.pristineSha256) {
    return {
      base64: bytes.toString('base64'),
      pristineBytes: bytes.length,
      pristineSha256: sha256(bytes),
      hasEmbedded: false,
      conflict:
        'the first bytes of this PDF no longer match the baseline SUNA recorded, so another ' +
        'application rewrote the file; SUNA will not truncate it'
    }
  }

  return {
    base64: prefix.toString('base64'),
    pristineBytes: recorded.pristineBytes,
    pristineSha256: recorded.pristineSha256,
    hasEmbedded: bytes.length > recorded.pristineBytes,
    conflict: null
  }
}

export interface EmbedResult {
  sha256: string
  bytesWritten: number
}

/**
 * Replace `references/<citekey>.pdf` with a regenerated copy carrying the
 * current highlights.
 *
 * Two checks stand between the renderer and the artifact of record, and both
 * exist because this is the one place SUNA overwrites a file it did not
 * create:
 *
 *  1. the file ON DISK must still carry the recorded pristine prefix — if it
 *     does not, someone else edited it and the incoming bytes were built on a
 *     baseline that no longer exists;
 *  2. the INCOMING bytes must start with that same prefix — a regeneration
 *     that does not extend the pristine file is not a regeneration, and
 *     writing it would silently replace the paper with something else.
 *
 * Only then does the atomic write happen, so a failure at any point leaves the
 * PDF exactly as it was.
 */
export async function embedHighlightsIntoPdf(
  dir: string,
  citekey: string,
  base64: string,
  recorded: { pristineBytes: number; pristineSha256: string }
): Promise<EmbedResult> {
  const path = referencePdfPath(dir, citekey)
  const incoming = Buffer.from(base64, 'base64')

  if (incoming.length < recorded.pristineBytes) {
    throw new Error(
      `refusing to write ${incoming.length} bytes over a ${recorded.pristineBytes}-byte baseline`
    )
  }
  if (incoming.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('refusing to write bytes that are not a PDF')
  }

  const onDisk = await readFile(path)
  if (onDisk.length < recorded.pristineBytes) {
    throw new Error('the PDF on disk is shorter than the recorded baseline; not overwriting it')
  }
  if (sha256(onDisk.subarray(0, recorded.pristineBytes)) !== recorded.pristineSha256) {
    throw new Error(
      'the PDF on disk no longer matches the baseline SUNA recorded — another application ' +
        'rewrote it, so its highlights were not replaced'
    )
  }
  if (sha256(incoming.subarray(0, recorded.pristineBytes)) !== recorded.pristineSha256) {
    throw new Error('the regenerated PDF does not extend the pristine file; not writing it')
  }

  await writeFileAtomic(path, incoming)
  return { sha256: sha256(incoming), bytesWritten: incoming.length }
}

/** Byte length of a reference PDF, for cheap change detection. */
export async function referencePdfSize(dir: string, citekey: string): Promise<number> {
  return (await stat(referencePdfPath(dir, citekey))).size
}
