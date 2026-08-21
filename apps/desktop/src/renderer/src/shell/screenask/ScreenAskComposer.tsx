/**
 * The screen-ask composer and its region picker — the two overlay phases
 * between ⌘⇧A and the floating terminal. Everything with a decision in it
 * lives in ./screenask.ts; this file is the box, the drag rectangle and the
 * keyboard handling.
 *
 * Sits at z-215, between the repair picker (210) and the tour (220): a
 * screen-ask may be ABOUT the palette or the help dialog, so it has to be
 * able to sit over them — but a tour step pointing at this composer still has
 * to be readable over it.
 */
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  cancelScreenAsk,
  finishRegionPick,
  sendScreenAsk,
  startRegionPick,
  useScreenAskStore
} from './screenask'
import './screenask.css'

interface DragRect {
  x: number
  y: number
  width: number
  height: number
}

/** Normalised rect from two corners, so dragging up-left works like down-right. */
function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): DragRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

/** Below this a drag reads as a mis-click, not a region. */
const MIN_REGION_PX = 8

export function ScreenAskComposer(): JSX.Element | null {
  const phase = useScreenAskStore((s) => s.phase)
  const [question, setQuestion] = useState('')
  const [drag, setDrag] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(
    null
  )
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // A fresh ask starts with an empty box; a return from the region picker
  // keeps what was already typed (the compose phase is re-entered, but the
  // question never left this component).
  useEffect(() => {
    if (phase.kind === 'idle') setQuestion('')
  }, [phase.kind])

  useEffect(() => {
    if (phase.kind === 'compose') inputRef.current?.focus()
  }, [phase.kind])

  // Esc abandons the ask (or the region drag). Capture phase + stopPropagation
  // for the same reason the repair picker does it: while this is up, Esc must
  // not also deselect in the canvas or close something underneath.
  useEffect(() => {
    if (phase.kind === 'idle') return
    const onKeyDown = (event: KeyboardEvent): void => {
      // ⌥R from the composer, matching the button's label. Matched on
      // `.code`: Alt-R produces '®' on a US Mac layout, so `.key` would name
      // a key nobody can find on their keyboard.
      if (event.altKey && event.code === 'KeyR' && !event.metaKey && !event.ctrlKey) {
        if (useScreenAskStore.getState().phase.kind !== 'compose') return
        event.preventDefault()
        event.stopPropagation()
        startRegionPick()
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (useScreenAskStore.getState().phase.kind === 'region') void finishRegionPick(null)
      else cancelScreenAsk()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [phase.kind])

  useEffect(() => {
    if (phase.kind !== 'region') setDrag(null)
  }, [phase.kind])

  if (phase.kind === 'idle') return null

  if (phase.kind === 'region') {
    const live = drag === null ? null : rectBetween(drag.from, drag.to)
    const onDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      const point = { x: event.clientX, y: event.clientY }
      setDrag({ from: point, to: point })
    }
    const onMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
      setDrag((current) =>
        current === null ? null : { ...current, to: { x: event.clientX, y: event.clientY } }
      )
    }
    const onUp = (): void => {
      const rect = drag === null ? null : rectBetween(drag.from, drag.to)
      setDrag(null)
      if (rect === null || rect.width < MIN_REGION_PX || rect.height < MIN_REGION_PX) {
        void finishRegionPick(null)
        return
      }
      // 'app:capture-rect' is specified in PAGE coordinates; the drag is in
      // client ones. Identity today (the shell root never scrolls), but two
      // callers of one contract have to agree on its terms.
      void finishRegionPick({
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height
      })
    }
    return (
      <div
        className="screenask-region"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {live !== null && (
          <div
            className="screenask-region__box"
            style={{ left: live.x, top: live.y, width: live.width, height: live.height }}
          />
        )}
        <div className="screenask-region__hint">
          Drag the part you are asking about · Esc to use the whole window
        </div>
      </div>
    )
  }

  const busy = phase.sending
  const shotNote =
    phase.shotKind === 'region'
      ? 'Region of the window attached'
      : phase.shotKind === 'window'
        ? 'Whole window attached'
        : 'No screenshot — the capture failed'

  const submit = (): void => {
    void sendScreenAsk(question)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends, Shift-Enter breaks the line: a question is usually one
    // line, and reaching for a Send button breaks the "fast iteration" this
    // whole feature is for.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="screenask" role="dialog" aria-label="Ask the agent about this screen">
      <div className="screenask__dialog">
        <div className="screenask__head">
          <span className="screenask__title">✦ Ask about this screen</span>
          <span
            className={
              phase.shotKind === 'none'
                ? 'screenask__shot screenask__shot--missing'
                : 'screenask__shot'
            }
          >
            {shotNote}
          </span>
        </div>
        <textarea
          ref={inputRef}
          className="screenask__prompt"
          rows={3}
          value={question}
          disabled={busy}
          placeholder="What do you want changed, explained or fixed?"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {phase.error !== null && <p className="screenask__error">{phase.error}</p>}
        <div className="screenask__actions">
          <button
            className="screenask__region"
            disabled={busy}
            onClick={() => startRegionPick()}
            title="Capture just part of the window instead"
          >
            Region ⌥R
          </button>
          <span className="screenask__spacer" />
          <button disabled={busy} onClick={() => cancelScreenAsk()}>
            Cancel
          </button>
          <button
            className="screenask__send"
            disabled={busy || question.trim() === ''}
            onClick={submit}
          >
            {busy ? 'Starting…' : 'Ask ⏎'}
          </button>
        </div>
      </div>
    </div>
  )
}
