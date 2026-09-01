import type { JSX } from 'react'
import type { PdfNote } from '@suna/core'
import type { ForeignHighlight, HighlightRect } from './pdfGeometry'
import type { ResolvedNotes } from './useNoteRects'

/**
 * Painted highlights for one page (ARCHITECTURE §14.4).
 *
 * Sits UNDER the text layer, not over it: the reader must still be able to
 * select the text a highlight covers, and an overlay that swallowed pointer
 * events would make a highlighted passage the one passage you cannot quote.
 *
 * Pure rendering — the rectangles were resolved once by `useNoteRects` and are
 * shared with the code that writes `/QuadPoints` into the PDF, so what is
 * painted and what is embedded cannot drift apart.
 */

interface HighlightLayerProps {
  page: number
  notes: readonly PdfNote[]
  resolved: ResolvedNotes
  activeNoteId: string | null
  onActivate: (noteId: string, rect: HighlightRect) => void
  /**
   * Highlights the FILE carries that SUNA did not make. Painted read-only,
   * with their own colour, so a paper annotated in Preview or Zotero opens
   * looking the way its owner left it — the canvas used to draw these for
   * free, until `annotationMode: DISABLE` stopped it double-painting ours.
   */
  foreign?: readonly ForeignHighlight[]
}

export function HighlightLayer({
  page,
  notes,
  resolved,
  activeNoteId,
  onActivate,
  foreign
}: HighlightLayerProps): JSX.Element | null {
  const drawn: { note: PdfNote; rects: HighlightRect[] }[] = []
  for (const note of notes) {
    const rects = resolved.byNote.get(note.id)?.get(page)
    if (rects !== undefined && rects.length > 0) drawn.push({ note, rects })
  }
  const foreignRuns = foreign ?? []
  if (drawn.length === 0 && foreignRuns.length === 0) return null

  return (
    <div className="pdfhl">
      {foreignRuns.map((highlight, i) =>
        highlight.rects.map((rect, j) => (
          <div
            key={`foreign-${i}-${j}`}
            className="pdfhl__rect pdfhl__rect--foreign"
            title={
              highlight.contents ??
              (highlight.author === null ? 'Highlight in this PDF' : `Highlight by ${highlight.author}`)
            }
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              ...(highlight.color === null ? {} : { background: highlight.color, opacity: 0.4 })
            }}
          />
        ))
      )}
      {drawn.map(({ note, rects }) =>
        rects.map((rect, index) => (
          <div
            key={`${note.id}-${index}`}
            className={
              'pdfhl__rect' +
              (note.id === activeNoteId ? ' pdfhl__rect--active' : '') +
              (resolved.ambiguous.has(note.id) ? ' pdfhl__rect--ambiguous' : '') +
              (note.body.trim() !== '' ? ' pdfhl__rect--noted' : '')
            }
            data-color={note.color}
            data-note={note.id}
            title={note.body.trim() === '' ? undefined : note.body}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            onMouseDown={(event) => {
              event.stopPropagation()
              onActivate(note.id, rect)
            }}
          />
        ))
      )}
    </div>
  )
}
