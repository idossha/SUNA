import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type JSX } from 'react'
import { EditorState, Prec, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  CHANGE_MARK,
  QUOTE_OPEN,
  crossReferenceSentence,
  insertCrossReference,
  insertQuoteBlock,
  insideQuoteBlock,
  markChange,
  replyDecorations,
  withReplyPrefix,
  type ReplyEdit,
  type ReviewPointRecord,
  type ReviewerReport
} from '@suna/core'
import { NewDocumentMenu } from './NewDocumentMenu'
import './documents.css'

/**
 * The box a reply is written in.
 *
 * A CodeMirror surface rather than a textarea, and the reason is concealment.
 * A textarea fixes the advance width of every character it holds, so an
 * overlay painted behind one can recolour the source but can never hide a
 * character of it or indent a line of it — both would move the glyphs out
 * from under the caret. Hiding `::quote` unless you are standing in the quote
 * is the whole ask, so the surface has to own its own layout.
 *
 * What it draws, from `replyDecorations` in `@suna/core`:
 *
 * - **The three voices**, in the colours read off `examples/peer-review/`:
 *   our reply, the manuscript quoted unchanged, the manuscript text that is
 *   new.
 * - **Concealed syntax.** `::quote`, `::`, `+++` and HTML notes to a
 *   co-author disappear, and come back when the caret enters the construct
 *   they belong to — both fences of an excerpt at once, so you can always see
 *   where the block you are typing in begins and ends. The marks are never
 *   *deleted*: the document is plain text, and what the exporter reads is
 *   what is on the screen the moment you put the caret in it.
 * - **Indented excerpts.** A quote is set in from the reply around it, which
 *   is what makes it read as the paper speaking inside our answer — and is
 *   the half of the distinction that survives a greyscale print.
 *
 * It also types the conventions for you: `::` opens an excerpt, ⌘⇧Q quotes a
 * selection, ⌘⇧R marks it as new, `RE: ` opens a fresh reply, and the
 * cross-reference picker writes the sentence `PEER-REVIEW.md` prescribes.
 * Every one is a pure string transform in `reply-markup.ts` with tests, and
 * all of them are off when `response.quickInsert` is off.
 *
 * The document still commits on blur and on ⌘/Ctrl+Enter, exactly as the
 * textarea did — a round-trip to disk per keystroke fights the caret, and the
 * reply is prose.
 *
 * The quick-insert buttons are a SEPARATE export (`ReplyQuickBar`) rather
 * than part of this component, because they belong on the card's footer row
 * beside the statuses, not under the box. They reach the editor through the
 * handle below — which is the whole of the surface this component exposes.
 */

/** What the quick-insert bar can do to the editor. */
export interface ReplyEditorHandle {
  /** Apply one of `reply-markup.ts`'s pure insertions at the live selection. */
  run: (make: (source: string, from: number, to: number) => ReplyEdit) => boolean
}

export interface ReplyEditorProps {
  id: string
  value: string
  onChange: (next: string) => void
  /** Commit — blur, or ⌘/Ctrl+Enter. */
  onCommit: (next: string) => void
  /**
   * Escape: restore the stored reply and leave the box. Returns the text to
   * restore, because the editor has to put it into its OWN document before
   * blurring — the blur handler commits whatever the document then holds, and
   * a React state update has not reached the editor by the time it fires.
   * Reverting through `value` alone therefore committed the very edit Escape
   * was meant to discard.
   */
  onRevert: () => string
  placeholder: string
  /** Paint the three voices and conceal the syntax (`response.colorRoles`). */
  colorRoles: boolean
  /** Offer the quick insertions and their shortcuts (`response.quickInsert`). */
  quickInsert: boolean
  /** Every point in the round, for the cross-reference picker. */
  reports: readonly ReviewerReport[]
  /** The point being answered — excluded from its own picker. */
  point: ReviewPointRecord
}

/* ------------------------------------------------------------------ */
/* Decorations                                                          */
/* ------------------------------------------------------------------ */

const HIDDEN = Decoration.replace({})
const MARKER = Decoration.mark({ class: 'cm-reply-marker' })
const QUOTE_LINE = Decoration.line({ class: 'cm-reply-quote-line' })
const ROLE_MARKS = {
  reply: Decoration.mark({ class: 'cm-reply-v-reply' }),
  quote: Decoration.mark({ class: 'cm-reply-v-quote' }),
  change: Decoration.mark({ class: 'cm-reply-v-change' })
} as const

function buildDecorations(state: EditorState): DecorationSet {
  const source = state.doc.toString()
  if (source === '') return Decoration.none
  const { marks, hides, quoteLineStarts } = replyDecorations(source)

  // `Decoration.set(…, true)` rather than a RangeSetBuilder: the builder
  // demands ranges pre-sorted by `from` AND by each decoration's own
  // `startSide`, and line/mark/replace decorations have different sides.
  // Sorting them by hand means encoding CodeMirror's precedence rules here
  // and getting them wrong; `set` applies them itself.
  const ranges: Range<Decoration>[] = []
  for (const at of quoteLineStarts) ranges.push(QUOTE_LINE.range(at))
  for (const mark of marks) ranges.push(ROLE_MARKS[mark.role].range(mark.from, mark.to))
  for (const hide of hides) {
    // The caret (or any part of a selection) inside the construct brings its
    // syntax back — dimmed, so it never competes with the prose.
    const revealed = state.selection.ranges.some(
      (range) => range.from <= hide.revealTo && range.to >= hide.revealFrom
    )
    ranges.push((revealed ? MARKER : HIDDEN).range(hide.from, hide.to))
  }
  return Decoration.set(ranges, true)
}

/**
 * A state field, not a view plugin: a replace decoration that covers a line
 * break — which every concealed fence does, by design — may only come from a
 * field. It recomputes on selection change as well as on edits, because the
 * caret moving in or out of a quote is exactly what reveals it.
 */
const replyDecorationField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (value, tr) =>
    tr.docChanged || tr.selection !== undefined ? buildDecorations(tr.state) : value,
  provide: (field) => EditorView.decorations.from(field)
})

/* ------------------------------------------------------------------ */
/* The component                                                        */
/* ------------------------------------------------------------------ */

export const ReplyEditor = forwardRef<ReplyEditorHandle, ReplyEditorProps>(function ReplyEditor(
  { id, value, onChange, onCommit, onRevert, placeholder, colorRoles, quickInsert },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // The callbacks change identity on every render of the parent card; the
  // editor is built once. A ref box keeps the extensions pointed at the
  // current ones without tearing the view down and losing the caret.
  const live = useRef({ onChange, onCommit, onRevert, quickInsert })
  live.current = { onChange, onCommit, onRevert, quickInsert }

  /** Apply one of the pure insertions to the whole document. */
  const applyEdit = (view: EditorView, edit: ReplyEdit): void => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: edit.text },
      selection: { anchor: edit.selectionStart, head: edit.selectionEnd },
      scrollIntoView: true
    })
    view.focus()
  }

  const run = (make: (source: string, from: number, to: number) => ReplyEdit): boolean => {
    const view = viewRef.current
    if (view === null || !live.current.quickInsert) return false
    const range = view.state.selection.main
    applyEdit(view, make(view.state.doc.toString(), range.from, range.to))
    return true
  }
  const runRef = useRef(run)
  runRef.current = run
  // A stable handle: the bar holds it in state, so re-creating it on every
  // render would loop. It closes over the ref, not over `run`.
  useImperativeHandle(ref, () => ({ run: (make) => runRef.current(make) }), [])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return

    const extensions: Extension[] = [
      history(),
      EditorView.lineWrapping,
      cmPlaceholder(placeholder),
      EditorView.contentAttributes.of({ id, 'aria-label': 'Our reply' }),
      Prec.highest(
        keymap.of([
          {
            // Commit without leaving the box — the shortcut people already
            // have in every reply field they use.
            key: 'Mod-Enter',
            run: (view) => {
              live.current.onCommit(view.state.doc.toString())
              return true
            }
          },
          {
            key: 'Escape',
            run: (view) => {
              const restored = live.current.onRevert()
              if (restored !== view.state.doc.toString()) {
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: restored } })
              }
              // The blur below commits the document, which is now the stored
              // text again — so the commit is a no-op rather than a save of
              // the discarded edit.
              view.contentDOM.blur()
              return true
            }
          },
          // Shift is what keeps these clear of ⌘Q (quit) and ⌘R (reload).
          { key: 'Mod-Shift-q', run: () => runRef.current(insertQuoteBlock) },
          { key: 'Mod-Shift-r', run: () => runRef.current(markChange) }
        ])
      ),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      EditorView.inputHandler.of((view, from, to, text) => {
        if (!live.current.quickInsert || text.length !== 1) return false
        const doc = view.state.doc.toString()

        // `::` opens an excerpt. Only outside one: inside, `::` is the
        // closing fence, and hijacking it would make a block impossible to
        // end by hand.
        if (text === ':' && from === to && doc.slice(from - 1, from) === ':') {
          if (insideQuoteBlock(doc, from)) return false
          const without = doc.slice(0, from - 1) + doc.slice(to)
          applyEdit(view, insertQuoteBlock(without, from - 1, from - 1))
          return true
        }

        // The opening both real response documents put on every reply, added
        // on the first keystroke rather than pre-filled — an untouched reply
        // must stay genuinely empty, because that emptiness is what the
        // unaddressed count and the export gap are counting.
        if (doc === '' && text.trim() !== '') {
          applyEdit(view, withReplyPrefix(text, text.length))
          return true
        }
        return false
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) live.current.onChange(update.state.doc.toString())
      }),
      EditorView.domEventHandlers({
        blur: (_event, view) => {
          live.current.onCommit(view.state.doc.toString())
          return false
        }
      })
    ]
    // Colour off means plain text: no voices, and nothing concealed. The
    // document is identical either way — only the drawing changes.
    if (colorRoles) extensions.push(replyDecorationField)

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Rebuilt only when the DRAWING changes. `value` is synced by the effect
    // below instead, so typing never reconstructs the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorRoles, id, placeholder])

  // External writes — the AI assistant accepting a proposal, Escape restoring
  // the stored reply, the tab reloading the round. A no-op while the author
  // is typing, because the doc already equals what they typed.
  useEffect(() => {
    const view = viewRef.current
    if (view === null || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  return (
    <div className={`round__reply-wrap${colorRoles ? ' is-painted' : ''}`}>
      <div ref={hostRef} className="round__reply-box" />
    </div>
  )
})

/**
 * The quick insertions, as a footer group.
 *
 * Separate from the editor because it belongs on the card's one footer row —
 * beside what you decided about the point and what the AI can do about it —
 * rather than stranded under the box in a row of its own.
 *
 * `onMouseDown` is prevented on every button: without it the editor blurs
 * first, which commits the reply and discards the selection the button is
 * about to act on.
 */
export function ReplyQuickBar({
  editor,
  reports,
  point
}: {
  /** Null until the editor has mounted, which is one render. */
  editor: ReplyEditorHandle | null
  reports: readonly ReviewerReport[]
  point: ReviewPointRecord
}): JSX.Element {
  const [xrefOpen, setXrefOpen] = useState(false)
  const xrefRef = useRef<HTMLButtonElement>(null)

  const otherPoints = useMemo(
    () =>
      reports.flatMap((report) =>
        report.points
          .filter((p) => p.id !== point.id)
          .map((p) => ({
            label: `Reviewer ${p.reviewerIndex}, point ${p.pointIndex}`,
            reviewerIndex: p.reviewerIndex,
            pointIndex: p.pointIndex
          }))
      ),
    [reports, point.id]
  )

  return (
    <div className="round__quick" role="group" aria-label="Quick insertions">
      <button
        type="button"
        className="round__quick-btn"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor?.run(insertQuoteBlock)}
        disabled={editor === null}
        title={`Quote the manuscript (${QUOTE_OPEN} … ::)  ⌘⇧Q — or just type ::`}
      >
        Quote manuscript
      </button>
      <button
        type="button"
        className="round__quick-btn"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor?.run(markChange)}
        disabled={editor === null}
        title={`Mark the selection as new manuscript text (${CHANGE_MARK} … ${CHANGE_MARK})  ⌘⇧R`}
      >
        Mark changed
      </button>
      <button
        ref={xrefRef}
        type="button"
        className="round__quick-btn"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setXrefOpen((v) => !v)}
        disabled={editor === null || otherPoints.length === 0}
        title="Point this reviewer at an answer given elsewhere"
      >
        Cross-ref…
      </button>
      {xrefOpen && xrefRef.current !== null && (
        <NewDocumentMenu
          anchorEl={xrefRef.current}
          onClose={() => setXrefOpen(false)}
          items={otherPoints.map((other) => ({
            label: other.label,
            onSelect: () =>
              editor?.run((source, from, to) =>
                insertCrossReference(
                  source,
                  from,
                  to,
                  crossReferenceSentence(other.reviewerIndex, other.pointIndex)
                )
              )
          }))}
        />
      )}
    </div>
  )
}
