import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { NOTE_COLORS, type NoteColor } from '@suna/core'
import type { PdfCitekeyMatch } from './pdfCitekey'
import { describeCitekeyMatch } from './pdfCitekey'

/**
 * The popover in the PDF viewer (ADR-008 M1/M2).
 *
 * Two shapes, one component. Over a fresh SELECTION it offers the eight
 * highlight colours, a note, and Copy. Over an EXISTING highlight it offers
 * recolouring, the note, Copy, and Remove — because "I must as easily be able
 * to remove the highlight" is the other half of highlighting feeling native.
 *
 * The citation is shown before anything is clicked. A quote pasted with the
 * wrong page number is a citation error nobody catches until proof stage, so
 * the popover states the reference and page it will produce rather than
 * leaving it to be discovered in the clipboard.
 */

const WIDTH = 268
const GAP = 8

export interface QuotePopoverProps {
  /** Viewport rect the popover points at. */
  rect: DOMRect
  /** Characters in the quote — makes a mis-drag visible before acting. */
  quoteLength: number
  match: PdfCitekeyMatch
  /** Page label to cite, already resolved through `citedPageLabel`. */
  pageLabel: string | null
  /** Pages the selection spans, when it crosses a page break. */
  pageSpan: number
  /** Set when the popover is over an existing highlight rather than a selection. */
  existing?: { color: NoteColor; hasBody: boolean }
  onCopy: () => void
  onDismiss: () => void
  /** Absent when this PDF is not a reference, so notes have nowhere to live. */
  onHighlight?: (color: NoteColor) => void
  onNote?: () => void
  onRemove?: () => void
}

export function QuotePopover(props: QuotePopoverProps): JSX.Element {
  const { rect, match, pageLabel, quoteLength, pageSpan, existing } = props
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    setHeight(ref.current?.offsetHeight ?? 0)
  }, [match.kind, pageLabel, quoteLength, existing?.color, existing?.hasBody])

  // Escape dismisses without touching the selection, so a mis-drag costs one key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  // Prefer above; flip below when there is no room, so the popover never
  // covers the text it is about.
  const wantsAbove = rect.top > height + GAP * 2
  const top = wantsAbove ? rect.top - height - GAP : rect.bottom + GAP
  const left = Math.min(
    Math.max(GAP, rect.left + rect.width / 2 - WIDTH / 2),
    window.innerWidth - WIDTH - GAP
  )

  const citekey = match.kind === 'one' ? match.citekey : null
  const problem = describeCitekeyMatch(match)

  return (
    <div
      ref={ref}
      className="pdfquote"
      style={{ left, top, width: WIDTH, visibility: height === 0 ? 'hidden' : 'visible' }}
      role="dialog"
      aria-label={existing === undefined ? 'Quote selection' : 'Highlight'}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="pdfquote__meta">
        {citekey !== null ? (
          <span className="pdfquote__cite">
            [@{citekey}
            {pageLabel !== null && <>, p.&nbsp;{pageLabel}</>}]
          </span>
        ) : (
          <span className="pdfquote__cite pdfquote__cite--none">no citation</span>
        )}
        <span className="pdfquote__len">
          {quoteLength} char{quoteLength === 1 ? '' : 's'}
          {pageSpan > 1 && ` · ${pageSpan} pages`}
        </span>
      </div>

      {problem !== null && <p className="pdfquote__warn">{problem}</p>}

      {props.onHighlight !== undefined && (
        <div className="pdfquote__colors" role="group" aria-label="Highlight colour">
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              className={
                'pdfquote__swatch' +
                (existing?.color === color ? ' pdfquote__swatch--on' : '')
              }
              data-color={color}
              aria-label={`Highlight ${color}`}
              aria-pressed={existing?.color === color}
              title={`Highlight ${color}`}
              onClick={() => props.onHighlight?.(color)}
            />
          ))}
        </div>
      )}

      <div className="pdfquote__actions">
        <button className="pdfquote__btn" onClick={props.onCopy} title="Copy the passage with its citation">
          Copy
        </button>
        {props.onNote !== undefined && (
          <button className="pdfquote__btn" onClick={props.onNote}>
            {existing?.hasBody === true ? 'Edit note' : 'Note'}
          </button>
        )}
        {props.onRemove !== undefined && (
          <button
            className="pdfquote__btn pdfquote__btn--danger"
            onClick={props.onRemove}
            title="Remove this highlight"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
