import { getDocument } from 'pdfjs-dist'
import type { PdfNote } from '@suna/core'
import { base64ToUint8Array } from './binary'
import {
  NOTE_COLOR_RGB,
  annotationsForNote,
  planSync,
  stageAnnotations,
  type DeleteAnnotationSpec,
  type DesiredHighlight,
  type FileAnnotation,
  type HighlightAnnotationSpec
} from './embedHighlights'
import { highlightRectsFromAnnotations, type HighlightRect } from './pdfGeometry'
import type { PdfViewportLike } from './pdfSelection'

/**
 * Keeping `references/<citekey>.pdf` in step with the sidecar (ADR-008,
 * amended: "keep it simple and robust ... make sure everything is updated even
 * if users make changes via preview or Zotero").
 *
 * The whole operation is a RECONCILE against the file as it is right now.
 * Nothing is remembered between runs — no pristine baseline, no stored object
 * ref, no hash — so there is nothing a foreign edit can invalidate. Preview
 * rewriting the file, Zotero adding a highlight, ADR-007 replacing the paper
 * with the published version: each is just a different starting document, read
 * fresh and edited minimally.
 *
 * The file is always re-read from disk rather than reusing the copy on screen,
 * because the copy on screen is as old as the tab.
 */

export interface SyncInput {
  rootDir: string
  citekey: string
  notes: readonly PdfNote[]
  /** Painted rectangles per note id, per page, in page-relative CSS pixels. */
  rectsByNote: ReadonlyMap<string, ReadonlyMap<number, readonly HighlightRect[]>>
  viewports: ReadonlyMap<number, PdfViewportLike>
  author: string
  /** User-space regions of notes just removed; see `planSync`. */
  removedRegions?: readonly { page: number; quads: readonly number[] }[]
}

export interface SyncOutcome {
  ok: boolean
  created: number
  removed: number
  unchanged: number
  bytesWritten?: number
  /** Where each matched note's annotation is, for the sidecar to record. */
  located: { noteId: string; page: number; quads: readonly number[] }[]
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

function cssColor(note: PdfNote): string {
  const rgb = NOTE_COLOR_RGB[note.color] ?? NOTE_COLOR_RGB.yellow
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

/**
 * Reconcile the PDF's `/Highlight` annotations with the sidecar's notes.
 *
 * Never throws: the notes are already safe in the sidecar, and the PDF is the
 * derived artifact. A failure here costs the file's annotations being briefly
 * out of date, not anyone's reading.
 */
export async function syncHighlights(input: SyncInput): Promise<SyncOutcome> {
  const { rootDir, citekey, notes, rectsByNote, viewports, author } = input
  const path = `${rootDir}/references/${citekey}.pdf`
  const idle = { ok: true, created: 0, removed: 0, unchanged: 0, located: [] }

  // ---- what the notes want the file to say ------------------------------
  const desired: DesiredHighlight[] = []
  for (const note of notes) {
    const byPage = rectsByNote.get(note.id)
    if (byPage === undefined) continue
    for (const [page, rects] of byPage) {
      if (rects.length === 0) continue
      desired.push({
        noteId: note.id,
        page,
        rects,
        color: cssColor(note),
        contents: note.body.trim()
      })
    }
  }
  const removedRegions = input.removedRegions ?? []
  if (desired.length === 0 && removedRegions.length === 0) return idle

  // ---- what it says now -------------------------------------------------
  let current: Uint8Array
  try {
    const { base64 } = await window.suna.invoke('fs:read-binary', { path })
    current = base64ToUint8Array(base64)
  } catch (error) {
    return { ...idle, ok: false, error: errorMessage(error) }
  }

  let saved: Uint8Array
  let plan
  let located: { noteId: string; page: number; quads: readonly number[] }[] = []
  try {
    const doc = await getDocument({ data: current.slice() }).promise
    const inFile: FileAnnotation[] = []

    // Every page a rendered viewport covers, PLUS every page a removal names.
    // The second half matters: the rail lists notes on every page, so removing
    // one whose page is scrolled away used to leave its annotation unread and
    // therefore undeletable. Those pages get a scale-1 viewport from the
    // document itself — removals match on user-space quads, so the screen
    // rectangles for them are never consulted.
    const pages = new Set<number>(viewports.keys())
    for (const region of removedRegions) pages.add(region.page)

    for (const page of [...pages].sort((a, b) => a - b)) {
      if (page < 1 || page > doc.numPages) continue
      const pageProxy = await doc.getPage(page).catch(() => null)
      if (pageProxy === null) continue
      const viewport = viewports.get(page) ?? pageProxy.getViewport({ scale: 1 })
      const raw = await pageProxy.getAnnotations({ intent: 'display' }).catch(() => [])
      for (const found of highlightRectsFromAnnotations(raw, viewport)) {
        inFile.push({
          id: found.id,
          ...(found.popupRef === undefined ? {} : { popupRef: found.popupRef }),
          page,
          rects: found.rects,
          quads: found.quads,
          color: found.color,
          contents: found.contents
        })
      }
    }

    plan = planSync(desired, inFile, removedRegions)
    located = [...plan.located]
    if (plan.create.length === 0 && plan.remove.length === 0) {
      void doc.cleanup()
      return { ...idle, unchanged: plan.unchanged, located }
    }

    // ---- the minimum edit -----------------------------------------------
    const creates: HighlightAnnotationSpec[] = []
    for (const want of plan.create) {
      const note = notes.find((n) => n.id === want.noteId)
      if (note === undefined) continue
      const specs = annotationsForNote(note, new Map([[want.page, want.rects]]), viewports, author)
      creates.push(...specs)
      // Record where we are ABOUT to put it. A created annotation has no ref
      // to read back yet, and waiting for a later sync to notice it left the
      // note with no recorded location at all — which is exactly how removing
      // it from the rail, with its page scrolled away, orphaned the highlight
      // in the file. We generated these quads, so we already know them.
      for (const spec of specs) {
        located.push({
          noteId: want.noteId,
          page: spec.pageIndex + 1,
          quads: [...spec.quadPoints]
        })
      }
    }
    const deletes: DeleteAnnotationSpec[] = plan.remove
      .filter((annotation) => annotation.id !== '')
      .map((annotation) => ({
        id: annotation.id,
        deleted: true as const,
        ...(annotation.popupRef === undefined ? {} : { popupRef: annotation.popupRef }),
        pageIndex: annotation.page - 1
      }))

    stageAnnotations(doc.annotationStorage, creates, deletes)
    saved = new Uint8Array(await doc.saveDocument())
    void doc.cleanup()
  } catch (error) {
    return { ...idle, ok: false, error: errorMessage(error) }
  }

  try {
    const result = await window.suna.invoke('refnotes:embed', {
      dir: rootDir,
      citekey,
      base64: toBase64(saved)
    })
    return {
      ok: true,
      created: plan.create.length,
      removed: plan.remove.length,
      unchanged: plan.unchanged,
      located,
      bytesWritten: result.bytesWritten
    }
  } catch (error) {
    return { ...idle, ok: false, error: errorMessage(error) }
  }
}
