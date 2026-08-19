import type { NoteColor, PdfNote } from '@suna/core'
import type { HighlightRect } from './pdfGeometry'
import type { PdfViewportLike } from './pdfSelection'

/**
 * Writing SUNA's highlights into the PDF as REAL annotations (ADR-008, amended
 * 2026-08-18 on user direction: "the highlighting functionality should be
 * native to the pdf as if we were highlighting in Preview App", then "keep it
 * simple and robust ... make sure everything is updated even if users make
 * changes via preview or Zotero").
 *
 * ## The file is reconciled, not regenerated
 *
 * An earlier version of this rebuilt the PDF from a recorded pristine baseline
 * on every change, because pdf.js was believed unable to delete an annotation
 * the loaded document already had (mozilla/pdf.js#18407 is about editing one).
 * That worked, and it was a trap: the moment another application rewrote the
 * file — Preview rewrites rather than appends — the baseline stopped matching
 * and SUNA could never write to that paper again.
 *
 * pdf.js CAN delete. Staging `{ id: '<ref>', deleted: true, pageIndex }` under
 * a `pdfjs_internal_editor_*` key drops the annotation from the page's
 * `/Annots` on save. Measured: two highlights (119R, 120R), delete 119R, save
 * — 120R survives, 119R is gone, and the result is still a byte-exact append.
 * The missing prefix on the storage key was the whole reason it looked
 * impossible.
 *
 * So there is no baseline and nothing to invalidate. Every write is an
 * ordinary incremental append over WHATEVER the file is right now, which makes
 * a foreign edit a non-event: we add the annotations our notes need, remove
 * the ones they no longer need, and touch nothing else in the document.
 */

/** pdf.js `AnnotationEditorType.HIGHLIGHT`. Inlined so this module stays pure. */
export const HIGHLIGHT_EDITOR_TYPE = 9

/** Opacity applied to every highlight, matching what the overlay paints. */
export const HIGHLIGHT_OPACITY = 0.4

/**
 * The eight stored colour names as RGB. Kept beside the CSS rather than read
 * from it: these bytes go into a file other applications render, so they must
 * not follow SUNA's theme.
 */
export const NOTE_COLOR_RGB: Record<NoteColor, [number, number, number]> = {
  yellow: [255, 212, 0],
  red: [255, 102, 102],
  green: [95, 178, 54],
  blue: [46, 168, 229],
  purple: [162, 138, 229],
  magenta: [229, 110, 238],
  orange: [241, 152, 55],
  gray: [170, 170, 170]
}

/** Removing an annotation the document already has, by its object ref. */
export interface DeleteAnnotationSpec {
  /** `id` from `getAnnotations()`, e.g. "119R". */
  id: string
  deleted: true
  /** Deleting the popup with it, so no orphan `/Popup` is left behind. */
  popupRef?: string
  pageIndex: number
}

/** One annotation, in the shape pdf.js's worker serialises. */
export interface HighlightAnnotationSpec {
  annotationType: number
  color: [number, number, number]
  opacity: number
  /** Per quad: upper-left, upper-right, lower-left, lower-right (PDF spec order). */
  quadPoints: number[]
  /** Closed polygon per quad; the appearance stream is filled from these. */
  outlines: number[][]
  rect: [number, number, number, number]
  rotation: number
  pageIndex: number
  user: string
  /** Sets `/Contents` on the highlight and creates its `/Popup`. */
  popup?: { contents: string; rect: [number, number, number, number] }
}

/** A rectangle in PDF user space. */
interface UserRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Convert a CSS-pixel rectangle, measured relative to the page's own box, into
 * PDF user space.
 *
 * Goes through the viewport's own `convertToPdfPoint` rather than
 * `height - y` arithmetic, so a `/Rotate 90` page — common for a wide figure
 * or a landscape table — lands right instead of ninety degrees out.
 */
export function toUserRect(rect: HighlightRect, viewport: PdfViewportLike): UserRect {
  const a = viewport.convertToPdfPoint(rect.left, rect.top)
  const b = viewport.convertToPdfPoint(rect.left + rect.width, rect.top + rect.height)
  const ax = a[0] ?? 0
  const ay = a[1] ?? 0
  const bx = b[0] ?? 0
  const by = b[1] ?? 0
  return {
    x0: Math.min(ax, bx),
    y0: Math.min(ay, by),
    x1: Math.max(ax, bx),
    y1: Math.max(ay, by)
  }
}

/** Round to 2dp so the written file does not carry float noise. */
const r2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Build one annotation spec per page from a note's painted rectangles.
 *
 * A note with runs on two pages becomes two annotations, because a PDF
 * annotation belongs to exactly one page — which is also why the sidecar keeps
 * the note whole and the PDF only mirrors it.
 */
export function annotationsForNote(
  note: PdfNote,
  rectsByPage: ReadonlyMap<number, readonly HighlightRect[]>,
  viewports: ReadonlyMap<number, PdfViewportLike>,
  author: string
): HighlightAnnotationSpec[] {
  const out: HighlightAnnotationSpec[] = []

  for (const [page, rects] of rectsByPage) {
    const viewport = viewports.get(page)
    if (viewport === undefined || rects.length === 0) continue

    const quadPoints: number[] = []
    const outlines: number[][] = []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const rect of rects) {
      const { x0, y0, x1, y1 } = toUserRect(rect, viewport)
      if (!(x1 > x0 && y1 > y0)) continue
      // PDF 32000-1 §12.5.6.10: upper-left, upper-right, lower-left, lower-right.
      quadPoints.push(r2(x0), r2(y1), r2(x1), r2(y1), r2(x0), r2(y0), r2(x1), r2(y0))
      outlines.push([r2(x0), r2(y0), r2(x0), r2(y1), r2(x1), r2(y1), r2(x1), r2(y0)])
      minX = Math.min(minX, x0)
      minY = Math.min(minY, y0)
      maxX = Math.max(maxX, x1)
      maxY = Math.max(maxY, y1)
    }
    if (quadPoints.length === 0) continue

    const rect: [number, number, number, number] = [r2(minX), r2(minY), r2(maxX), r2(maxY)]
    const spec: HighlightAnnotationSpec = {
      annotationType: HIGHLIGHT_EDITOR_TYPE,
      color: NOTE_COLOR_RGB[note.color] ?? NOTE_COLOR_RGB.yellow,
      opacity: HIGHLIGHT_OPACITY,
      quadPoints,
      outlines,
      rect,
      rotation: 0,
      pageIndex: page - 1,
      user: author
    }
    // A note body rides along as `/Contents` with a `/Popup`, so Preview and
    // Acrobat show the note, not just the colour.
    if (note.body.trim() !== '') {
      spec.popup = { contents: note.body, rect }
    }
    out.push(spec)
  }

  return out
}

/**
 * Load creates and deletes into a document's `annotationStorage`.
 *
 * The `pdfjs_internal_editor_` prefix is not cosmetic: `getNewAnnotationsMap`
 * skips every key without it, so an entry stored under any other name is
 * silently ignored and the save appears to do nothing. That is exactly how
 * deleting looked impossible.
 */
export function stageAnnotations(
  storage: { setValue: (key: string, value: HighlightAnnotationSpec | DeleteAnnotationSpec) => void },
  creates: readonly HighlightAnnotationSpec[],
  deletes: readonly DeleteAnnotationSpec[] = []
): void {
  let index = 0
  for (const spec of deletes) storage.setValue(`pdfjs_internal_editor_${index++}`, spec)
  for (const spec of creates) storage.setValue(`pdfjs_internal_editor_${index++}`, spec)
}

/** What one page of the file currently carries, as the sync sees it. */
export interface FileAnnotation {
  id: string
  popupRef?: string
  page: number
  rects: readonly HighlightRect[]
  color: string | null
  contents: string | null
}

/** What a note wants the file to say about it. */
export interface DesiredHighlight {
  noteId: string
  page: number
  rects: readonly HighlightRect[]
  /** CSS `rgb(r, g, b)`, so it compares directly with what was read back. */
  color: string
  contents: string
}

export interface SyncPlan {
  /** Notes that have no annotation in the file yet. */
  create: DesiredHighlight[]
  /** Annotations to drop: stale representations, plus explicitly removed notes. */
  remove: FileAnnotation[]
  /** Notes already represented correctly — nothing to do. */
  unchanged: number
}

/** Same region, within a couple of pixels. */
function sameRegion(a: readonly HighlightRect[], b: readonly HighlightRect[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  return a.some((one) => b.some((other) => overlapsRect(one, other)))
}

/** Local copy of the overlap test, so this module stays free of DOM helpers. */
function overlapsRect(a: HighlightRect, b: HighlightRect, slack = 2): boolean {
  return (
    a.left < b.left + b.width + slack &&
    b.left < a.left + a.width + slack &&
    a.top < b.top + b.height + slack &&
    b.top < a.top + a.height + slack
  )
}

/**
 * Work out the minimum edit that makes the PDF agree with the notes.
 *
 * Identity is GEOMETRY, resolved fresh every time, and that is the whole
 * robustness argument. Nothing is remembered between runs — no baseline, no
 * stored object ref, no hash — so a file rewritten by Preview or re-downloaded
 * by ADR-007's ladder is simply read as it now is. An annotation covering a
 * region one of our notes covers IS that note's; one covering a region no note
 * covers belongs to somebody else and is never touched.
 *
 * `removedRegions` carries the rectangles of notes the user has just deleted,
 * which is the one thing geometry alone cannot infer: an annotation over a
 * region no note claims is indistinguishable from a highlight made in Preview,
 * and guessing would delete a stranger's work. So a deletion is only ever
 * performed for a region the caller explicitly names.
 */
export function planSync(
  desired: readonly DesiredHighlight[],
  inFile: readonly FileAnnotation[],
  removedRegions: readonly { page: number; rects: readonly HighlightRect[] }[] = []
): SyncPlan {
  const create: DesiredHighlight[] = []
  const remove: FileAnnotation[] = []
  const claimed = new Set<FileAnnotation>()
  let unchanged = 0

  for (const want of desired) {
    const match = inFile.find(
      (annotation) =>
        !claimed.has(annotation) &&
        annotation.page === want.page &&
        sameRegion(annotation.rects, want.rects)
    )
    if (match === undefined) {
      create.push(want)
      continue
    }
    claimed.add(match)
    // Present but saying the wrong thing — a recolour or an edited note body.
    // Replace rather than edit: pdf.js can add and remove, and #18407 is
    // precisely the inability to modify one in place.
    if (match.color !== want.color || (match.contents ?? '') !== want.contents) {
      remove.push(match)
      create.push(want)
    } else {
      unchanged += 1
    }
  }

  for (const gone of removedRegions) {
    for (const annotation of inFile) {
      if (claimed.has(annotation)) continue
      if (annotation.page !== gone.page) continue
      if (!sameRegion(annotation.rects, gone.rects)) continue
      claimed.add(annotation)
      remove.push(annotation)
    }
  }

  return { create, remove, unchanged }
}
