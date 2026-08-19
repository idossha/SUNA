import { getDocument } from 'pdfjs-dist'
import type { PdfNote } from '@suna/core'
import { base64ToUint8Array } from './binary'
import { annotationsForNote, stageAnnotations, type HighlightAnnotationSpec } from './embedHighlights'
import type { HighlightRect } from './pdfGeometry'
import type { PdfViewportLike } from './pdfSelection'

/**
 * Regenerating `references/<citekey>.pdf` so its native annotations match the
 * sidecar (ADR-008, amended: highlights are native to the PDF, and removable).
 *
 * Always from the PRISTINE copy, never from the file as it stands. pdf.js
 * cannot delete an annotation the loaded document already had
 * (mozilla/pdf.js#18407), so editing in place could only ever add — two
 * highlights then one would leave three. Loading the pristine bytes and
 * writing every current note is the only formulation where removal exists,
 * and `saveDocument()`'s strict-append behaviour is what makes the pristine
 * copy recoverable in the first place.
 */

export interface EmbedInput {
  rootDir: string
  citekey: string
  notes: readonly PdfNote[]
  /** Painted rectangles per note id, per page, in page-relative CSS pixels. */
  rectsByNote: ReadonlyMap<string, ReadonlyMap<number, readonly HighlightRect[]>>
  viewports: ReadonlyMap<number, PdfViewportLike>
  author: string
}

export interface EmbedOutcome {
  ok: boolean
  /** Annotations written; 0 is a legitimate result (every highlight removed). */
  annotations: number
  bytesWritten?: number
  sha256?: string
  pristineBytes?: number
  pristineSha256?: string
  error?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toBase64(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a
  // multi-megabyte paper.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Write every current highlight into the reference PDF, replacing whatever
 * SUNA wrote before.
 *
 * Never throws: a failure to embed must not cost the user their notes, which
 * are already safely in the sidecar. The PDF is the derived artifact here.
 */
export async function embedHighlights(input: EmbedInput): Promise<EmbedOutcome> {
  const { rootDir, citekey, notes, rectsByNote, viewports, author } = input

  let baseline
  try {
    baseline = await window.suna.invoke('refnotes:pristine', { dir: rootDir, citekey })
  } catch (error) {
    return { ok: false, annotations: 0, error: errorMessage(error) }
  }
  if (baseline.conflict !== null) {
    return { ok: false, annotations: 0, error: baseline.conflict }
  }

  const specs: HighlightAnnotationSpec[] = []
  for (const note of notes) {
    const rects = rectsByNote.get(note.id)
    if (rects === undefined || rects.size === 0) continue
    specs.push(...annotationsForNote(note, rects, viewports, author))
  }

  const pristine = base64ToUint8Array(baseline.base64)

  let saved: Uint8Array
  try {
    // A separate document from the one on screen: this one must be the
    // pristine copy, and loading detaches `data` into the worker.
    const doc = await getDocument({ data: pristine.slice() }).promise
    stageAnnotations(doc.annotationStorage, specs)
    saved = new Uint8Array(await doc.saveDocument())
    void doc.cleanup()
  } catch (error) {
    return { ok: false, annotations: specs.length, error: errorMessage(error) }
  }

  try {
    const result = await window.suna.invoke('refnotes:embed', {
      dir: rootDir,
      citekey,
      base64: toBase64(saved),
      pristineBytes: baseline.pristineBytes,
      pristineSha256: baseline.pristineSha256
    })
    return {
      ok: true,
      annotations: specs.length,
      bytesWritten: result.bytesWritten,
      sha256: result.sha256,
      pristineBytes: baseline.pristineBytes,
      pristineSha256: baseline.pristineSha256
    }
  } catch (error) {
    return { ok: false, annotations: specs.length, error: errorMessage(error) }
  }
}
