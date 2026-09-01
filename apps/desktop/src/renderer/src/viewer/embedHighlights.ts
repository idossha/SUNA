import type { NoteColor, PdfNote } from '@suna/core'
import type { HighlightRect } from './pdfGeometry'
import type { PdfViewportLike } from './pdfSelection'

/**
 * Writing SUNA's highlights into the PDF as REAL annotations (ARCHITECTURE §14.4, amended
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
  /** Viewport-space rectangles, for matching against what is painted. */
  rects: readonly HighlightRect[]
  /**
   * The annotation's own `/QuadPoints`, in PDF user space.
   *
   * Carried alongside the screen rectangles because removal must work for a
   * page that is not rendered — the rail lists notes on every page, and a
   * screen rectangle simply does not exist for a page nobody is looking at.
   */
  quads: readonly number[]
  color: string | null
  contents: string | null
}

/** A note's annotation, located in user space, for removal without the DOM. */
export interface EmbeddedRegion {
  page: number
  quads: readonly number[]
}

/** What a note wants the file to say about it. */
export interface DesiredHighlight {
  noteId: string
  page: number
  rects: readonly HighlightRect[]
  /** CSS `rgb(r, g, b)`, so it compares directly with what was read back. */
  color: string
  contents: string
  /**
   * The note's own record of where SUNA put this annotation, in user space.
   *
   * When present it is the ONLY thing allowed to identify the annotation.
   * Matching by overlapping screen rectangles instead let a surviving note
   * claim a deleted neighbour's annotation — so the removal found nothing and
   * was skipped — and let a highlight drawn over a passage someone had already
   * highlighted in Preview claim and delete THEIR annotation.
   */
  embed?: readonly number[]
}

export interface SyncPlan {
  /** Notes that have no annotation in the file yet. */
  create: DesiredHighlight[]
  /** Annotations to drop: stale representations, plus explicitly removed notes. */
  remove: FileAnnotation[]
  /**
   * Removals that found nothing to remove.
   *
   * Reported rather than swallowed: the caller holds these until they are
   * actually performed, because reporting success for a removal that could not
   * be made leaves the highlight in the file and nothing ever retries.
   */
  unmatchedRemovals: EmbeddedRegion[]
  /** Notes already represented correctly — nothing to do. */
  unchanged: number
  /**
   * Where each matched note's annotation actually is, in user space.
   *
   * Recorded back onto the note so a later removal never has to consult the
   * DOM. Covers notes that were already correct as well as ones just written,
   * so a sidecar predating this backfills the moment its page is viewed.
   */
  located: { noteId: string; page: number; quads: readonly number[] }[]
}

/** Each quad's bounding box, in a canonical order. */
function quadBoxes(q: readonly number[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  for (let i = 0; i + 7 < q.length; i += 8) {
    const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]].map(Number)
    const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]].map(Number)
    out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0])
}

/**
 * Do two quad runs describe the same place? Compared in PDF user space.
 *
 * Per QUAD, not by one outer box. A highlight over two lines is L-shaped, and
 * its outer box is identical to that of a solid block covering both lines and
 * the gap between them — so an outer-box comparison called a two-line run and
 * an unrelated block-shaped annotation the same annotation. Corners are
 * normalised because producers do not agree on their order, and quads are
 * sorted because a rewritten file may reorder them.
 */
export function sameQuads(a: readonly number[], b: readonly number[], epsilon = 1): boolean {
  if (a.length === 0 || b.length === 0) return false
  const left = quadBoxes(a)
  const right = quadBoxes(b)
  if (left.length === 0 || left.length !== right.length) return false
  return left.every((box, i) => {
    const other = right[i]
    if (other === undefined) return false
    return box.every((n, j) => Math.abs(n - (other[j] as number)) <= epsilon)
  })
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
 * by ARCHITECTURE §9's ladder is simply read as it now is. An annotation covering a
 * region one of our notes covers IS that note's; one covering a region no note
 * covers belongs to somebody else and is never touched.
 *
 * `removed` carries the USER-SPACE regions of notes just deleted, which is the
 * one thing geometry alone cannot infer: an annotation over a region no note
 * claims is indistinguishable from a highlight made in Preview, and guessing
 * would delete a stranger's work. So a deletion is only ever performed for a
 * region the caller explicitly names.
 *
 * Those regions are user space rather than screen pixels on purpose. Screen
 * rectangles only exist for pages that are rendered, and the rail lists notes
 * on every page — so removing one whose page was scrolled out of view deleted
 * the note and left its highlight in the PDF permanently.
 */
export function planSync(
  desired: readonly DesiredHighlight[],
  inFile: readonly FileAnnotation[],
  removed: readonly EmbeddedRegion[] = []
): SyncPlan {
  const create: DesiredHighlight[] = []
  const remove: FileAnnotation[] = []
  const unmatchedRemovals: EmbeddedRegion[] = []
  const located: { noteId: string; page: number; quads: readonly number[] }[] = []
  const claimed = new Set<FileAnnotation>()
  let unchanged = 0

  for (const want of desired) {
    const onPage = inFile.filter((a) => !claimed.has(a) && a.page === want.page)
    const recorded = want.embed ?? []

    // A note that knows where SUNA put it is identified by THAT and nothing
    // else. Falling back to overlap here is what let one note claim a
    // neighbour's annotation — skipping the neighbour's removal — and what let
    // a highlight drawn over a passage already highlighted in Preview claim
    // and delete that annotation.
    //
    // With nothing recorded — a note predating this, or one whose first sync
    // has not run — an overlapping annotation is adopted ONLY if it already
    // says exactly what we would say. Anything that disagrees belongs to
    // somebody else, and ours goes in beside it rather than over it.
    const match =
      recorded.length > 0
        ? onPage.find((a) => sameQuads(a.quads, recorded))
        : onPage.find(
            (a) =>
              sameRegion(a.rects, want.rects) &&
              a.color === want.color &&
              (a.contents ?? '') === want.contents
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
      located.push({ noteId: want.noteId, page: match.page, quads: match.quads })
    }
  }

  // Explicit removals, matched in USER SPACE so a page nobody is looking at is
  // no different from one on screen. This is the half that was missing: screen
  // rectangles exist only for rendered pages, so removing a note from the rail
  // while its page was scrolled away used to leave its highlight in the file
  // forever.
  for (const gone of removed) {
    // Exactly ONE annotation per named region. Removing every annotation whose
    // box matched took a stranger's highlight of the same words along with
    // ours, since two applications highlighting the same sentence produce two
    // annotations over the same quads.
    const hit = inFile.find(
      (a) => !claimed.has(a) && a.page === gone.page && sameQuads(a.quads, gone.quads)
    )
    if (hit === undefined) {
      // Say so rather than reporting success: the caller keeps this queued and
      // tries again, instead of dropping it and orphaning the highlight.
      unmatchedRemovals.push(gone)
      continue
    }
    claimed.add(hit)
    remove.push(hit)
  }

  return { create, remove, unchanged, located, unmatchedRemovals }
}
