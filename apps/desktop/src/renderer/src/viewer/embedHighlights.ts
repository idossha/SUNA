import type { NoteColor, PdfNote } from '@suna/core'
import type { HighlightRect } from './pdfGeometry'
import type { PdfViewportLike } from './pdfSelection'

/**
 * Writing SUNA's highlights into the PDF as REAL annotations (ADR-008, amended
 * 2026-08-18 on user direction: "the highlighting functionality should be
 * native to the pdf as if we were highlighting in Preview App").
 *
 * ## Why the file is regenerated rather than appended to
 *
 * pdf.js can create annotations but **cannot delete or edit one that already
 * existed in the document it loaded** (mozilla/pdf.js#18407). Appending on
 * every change would therefore duplicate every highlight forever, and removing
 * one would be impossible — which is exactly the second thing the user asked
 * for.
 *
 * What makes the way out exact is a measured property: `saveDocument()` is a
 * strict incremental append, so the original bytes remain a byte-for-byte
 * prefix of the output. Verified here against the example PDF —
 * 447,218 -> 448,289 bytes, `sha256` of the first 447,218 bytes identical, and
 * truncating back reproduced the source exactly.
 *
 * So the PDF's annotation layer is DERIVED, never edited in place:
 *
 *   truncate to the pristine length -> verify its hash -> load it -> write
 *   every current note -> save.
 *
 * Two highlights then one gives one annotation, not three. The sidecar stays
 * the source of truth because the PDF cannot hold what the rail needs:
 * pdf.js writes no `/NM`, so an annotation has no stable identity, and
 * `/QuadPoints` is absolute page coordinates, so nothing in the file can
 * re-anchor when the PDF is replaced.
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
 * Load the specs into a document's `annotationStorage` under the keys pdf.js's
 * save path looks for.
 *
 * The document MUST be a freshly loaded pristine copy: this writes new
 * annotations and cannot remove ones the loaded file already had.
 */
export function stageAnnotations(
  storage: { setValue: (key: string, value: HighlightAnnotationSpec) => void },
  specs: readonly HighlightAnnotationSpec[]
): void {
  specs.forEach((spec, index) => {
    storage.setValue(`pdfjs_internal_editor_${index}`, spec)
  })
}
