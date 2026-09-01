import { useEffect, useRef, useState, type JSX } from 'react'
import { NOTE_COLORS, isDetached, noteQuote, type NoteColor, type PdfNote } from '@suna/core'
import { relativeTime } from '../comments/relativeTime'
import '../comments/comments.css'

/**
 * Reading notes beside the PDF (ARCHITECTURE §14.4).
 *
 * Deliberately the manuscript comments rail's clothes on reading notes' body:
 * the same `cmt-*` class vocabulary, the same card shape, the same compose
 * box, the same "click a card to jump, click an anchor to activate" grammar.
 * A researcher who has used one already knows this one.
 *
 * What is NOT borrowed is `CommentsRail` itself. Its props require a live
 * `EditorView` and every card position comes from `view.lineBlockAt().top` —
 * a PDF has no height map, so the geometry half could not survive the move
 * even though the presentation half transfers whole.
 *
 * Also absent, on purpose: replies and Resolve. Reading notes are not review;
 * nobody resolves a note they made to themselves about someone else's paper.
 */

export interface NotesRailProps {
  notes: readonly PdfNote[]
  activeNoteId: string | null
  /** Note ids whose runs matched several equally-good places. */
  ambiguous: ReadonlySet<string>
  /** Note ids no longer findable in the PDF's text. */
  detached: ReadonlySet<string>
  /** Open on a note with no body yet — the composer opens focused. */
  composingFor: string | null
  citekey: string | null
  onActivate: (noteId: string) => void
  onSaveBody: (noteId: string, body: string) => void
  onRecolor: (noteId: string, color: NoteColor) => void
  onDelete: (noteId: string) => void
  onCopy: (noteId: string) => void
  onCloseComposer: () => void
  onHide: () => void
}

function NoteCard({
  note,
  active,
  ambiguous,
  detached,
  composing,
  onActivate,
  onSaveBody,
  onRecolor,
  onDelete,
  onCopy,
  onCloseComposer
}: {
  note: PdfNote
  active: boolean
  ambiguous: boolean
  detached: boolean
  composing: boolean
  onActivate: () => void
  onSaveBody: (body: string) => void
  onRecolor: (color: NoteColor) => void
  onDelete: () => void
  onCopy: () => void
  onCloseComposer: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(composing)
  const [recoloring, setRecoloring] = useState(false)
  const [body, setBody] = useState(note.body)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (composing) {
      setEditing(true)
      setBody(note.body)
    }
  }, [composing, note.body])

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  const commit = (): void => {
    onSaveBody(body)
    setEditing(false)
    onCloseComposer()
  }
  const cancel = (): void => {
    setBody(note.body)
    setEditing(false)
    onCloseComposer()
  }

  return (
    <div
      className={
        'cmt-card' +
        (active ? ' cmt-card--active' : '') +
        (detached ? ' cmt-card--resolved' : '')
      }
      onMouseDown={() => onActivate()}
    >
      <div className="cmt__card-head">
        <button
          className="pdfnotes__dot"
          data-color={note.color}
          aria-label={`Colour: ${note.color}. Change it`}
          title="Change colour"
          onClick={(event) => {
            event.stopPropagation()
            setRecoloring((open) => !open)
          }}
        />
        <span className="cmt__badge">{note.author.name}</span>
        <span className="cmt__time">{relativeTime(note.createdAt)}</span>
      </div>

      {recoloring && (
        <div className="pdfnotes__swatches" role="group" aria-label="Highlight colour">
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              className="pdfnotes__swatch"
              data-color={color}
              aria-label={color}
              aria-pressed={color === note.color}
              title={color}
              onClick={(event) => {
                event.stopPropagation()
                onRecolor(color)
                setRecoloring(false)
              }}
            />
          ))}
        </div>
      )}

      <div className="cmt__quote" title={noteQuote(note)}>
        {noteQuote(note)}
      </div>

      {detached && (
        <div className="cmt__detached">
          Not found in this PDF any more — the text may have changed. The note is kept.
        </div>
      )}
      {ambiguous && !detached && (
        <div className="cmt__detached">
          This passage appears more than once and the surrounding text does not say which.
        </div>
      )}

      {editing ? (
        <>
          <textarea
            ref={textareaRef}
            className="cmt-textarea"
            placeholder="Add a note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            }}
          />
          <div className="cmt__draft-actions">
            <button className="cmt__btn" onClick={cancel}>
              Cancel
            </button>
            <button className="cmt__btn cmt__btn--primary" onClick={commit}>
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          {note.body.trim() !== '' && <div className="cmt__body">{note.body}</div>}
          <div className="cmt__actions">
            <button className="cmt__btn" onClick={() => setEditing(true)}>
              {note.body.trim() === '' ? 'Add note' : 'Edit'}
            </button>
            <button className="cmt__btn" onClick={onCopy}>
              Copy
            </button>
            <button className="cmt__btn cmt__btn--danger" onClick={onDelete}>
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function NotesRail(props: NotesRailProps): JSX.Element {
  const { notes, activeNoteId, ambiguous, detached, composingFor, citekey } = props
  const withBody = notes.filter((note) => note.body.trim() !== '').length

  return (
    <aside className="pdfnotes" aria-label="Reading notes">
      <header className="pdfnotes__head">
        <span className="pdfnotes__title">Notes</span>
        <span className="pdfnotes__count">
          {notes.length} highlight{notes.length === 1 ? '' : 's'}
          {withBody > 0 && ` · ${withBody} noted`}
        </span>
        <button className="pdfnotes__hide" onClick={props.onHide} title="Hide notes (⌘⌥M)">
          ×
        </button>
      </header>

      {notes.length === 0 ? (
        <p className="pdfnotes__empty">
          {citekey === null
            ? 'This PDF is not a reference in this project, so notes have nowhere to live. Add it to references.bib first.'
            : 'Select text on the page, then pick a colour to highlight it or press Note to write about it.'}
        </p>
      ) : (
        <div className="pdfnotes__list">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              active={note.id === activeNoteId}
              ambiguous={ambiguous.has(note.id)}
              detached={detached.has(note.id) || isDetached(note)}
              composing={composingFor === note.id}
              onActivate={() => props.onActivate(note.id)}
              onSaveBody={(body) => props.onSaveBody(note.id, body)}
              onRecolor={(color) => props.onRecolor(note.id, color)}
              onDelete={() => props.onDelete(note.id)}
              onCopy={() => props.onCopy(note.id)}
              onCloseComposer={props.onCloseComposer}
            />
          ))}
        </div>
      )}
    </aside>
  )
}
