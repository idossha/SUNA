/**
 * The guided tour: a spotlight ring over one element, an arrow, and a card
 * that says what you are looking at (tour/steps.ts).
 *
 * Two things shape the implementation:
 *
 * 1. The overlay never swallows a click. The dim is a huge `box-shadow`
 *    spread on a `pointer-events: none` ring rather than a backdrop, so the
 *    app underneath stays fully usable — which is the whole point of a step
 *    that asks the user to click the thing being pointed at.
 * 2. Positioning is imperative, inside one rAF loop. The anchors move for
 *    reasons React does not see (dock layout, sidebar drags, scrolling, a
 *    panel that mounts a frame late), and re-rendering the card sixty times
 *    a second to chase them would be pure waste — the loop writes transforms
 *    on refs and React re-renders only when the STEP changes.
 *
 * Selectors are API for scripts/e2e probes: `.tour-card` (with
 * `data-tour-step` = the current step id) and `.tour-spot`.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { useTourStore } from '../state/tour'
import { anchorCard, centreCard, isVisibleRect, padRect, type Rect } from './anchor'
import { applyEffects, isCueSatisfied } from './effects'
import { TOUR_STEPS } from './steps'
import './tour.css'

/** How far the spotlight ring stands off the element it surrounds. */
const SPOT_PAD = 6
/** How long a step keeps pulling its target back into view (see enteredAtRef). */
const SCROLL_GRACE_MS = 1200

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** Off-screen parking spot for the beak on a step that points at nothing. */
const HIDDEN = -9999

export function TourOverlay(): JSX.Element | null {
  const active = useTourStore((s) => s.active)
  const index = useTourStore((s) => s.index)
  const visit = useTourStore((s) => s.visit)

  const cardRef = useRef<HTMLDivElement | null>(null)
  const beakRef = useRef<HTMLDivElement | null>(null)
  const spotRef = useRef<HTMLDivElement | null>(null)
  /**
   * When the current step was entered. The target is kept in view for a
   * short window after that rather than scrolled once: a panel that mounts,
   * measures and re-lays out over the next few frames can carry the element
   * straight back off-screen, and a single scroll on the first frame it
   * appears loses that race. After the window, scrolling belongs to the user.
   */
  const enteredAtRef = useRef(0)
  /**
   * A cue only advances the tour once it has been seen UNSATISFIED. Without
   * that latch a step whose state the user is already in would skip itself
   * the instant it appeared.
   */
  const armedRef = useRef(false)
  const [showCue, setShowCue] = useState(false)

  const step = TOUR_STEPS[index]

  // Put the app into the state this step describes. Runs on every entry —
  // forwards, backwards and on start — which is why effects are idempotent.
  useEffect(() => {
    if (!active || step === undefined) return
    applyEffects(step.arrange)
    const satisfied = step.cue !== undefined && isCueSatisfied(step.cue.when)
    armedRef.current = step.cue !== undefined && !satisfied
    setShowCue(armedRef.current)
    enteredAtRef.current = performance.now()
  }, [active, visit, step])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const tour = useTourStore.getState()
      if (event.key === 'Escape') {
        event.preventDefault()
        tour.stop()
        return
      }
      // Arrows are the editor's and the explorer's before they are ours.
      if (isTyping(event.target)) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        tour.next()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        tour.back()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])

  // One loop for everything that moves: where the target is now, whether the
  // user has done what the step asked, and where that puts the card.
  useEffect(() => {
    if (!active || step === undefined) return
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const card = cardRef.current
      const beak = beakRef.current
      const spot = spotRef.current
      if (card === null || beak === null || spot === null) return

      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const size = { width: card.offsetWidth, height: card.offsetHeight }
      const el = step.target === null ? null : document.querySelector(step.target)
      const rect = el === null ? null : measure(el)

      if (rect !== null && isVisibleRect(rect)) {
        const offScreen =
          rect.y < 0 ||
          rect.x < 0 ||
          rect.y + rect.height > viewport.height ||
          rect.x + rect.width > viewport.width
        if (offScreen && performance.now() - enteredAtRef.current < SCROLL_GRACE_MS) {
          el?.scrollIntoView({ block: 'center', inline: 'nearest' })
        }
        const ring = padRect(rect, SPOT_PAD)
        spot.style.opacity = '1'
        spot.style.borderWidth = '1px'
        spot.style.transform = `translate(${ring.x}px, ${ring.y}px)`
        spot.style.width = `${ring.width}px`
        spot.style.height = `${ring.height}px`
        const placed = anchorCard(ring, size, viewport, step.prefer)
        card.style.transform = `translate(${placed.card.x}px, ${placed.card.y}px)`
        card.dataset['side'] = placed.side
        beak.style.opacity = '1'
        beak.style.transform = `translate(${placed.beak.x}px, ${placed.beak.y}px) rotate(45deg)`
      } else {
        // No anchor — either the step points at nothing on purpose, or the
        // surface it wanted is not on screen. Same answer either way: say the
        // piece in the middle rather than point at the wrong thing.
        // The dim stays — it is the spotlight's own box-shadow — but the ring
        // collapses to nothing, so an intro/outro card sits over an evenly
        // dimmed window instead of over a stray 0x0 outline.
        spot.style.opacity = '1'
        spot.style.borderWidth = '0'
        spot.style.width = '0px'
        spot.style.height = '0px'
        spot.style.transform = `translate(${viewport.width / 2}px, ${viewport.height / 2}px)`
        beak.style.opacity = '0'
        beak.style.transform = `translate(${HIDDEN}px, ${HIDDEN}px)`
        const centre = centreCard(size, viewport)
        card.style.transform = `translate(${centre.x}px, ${centre.y}px)`
        card.dataset['side'] = 'none'
      }
      card.style.visibility = 'visible'

      if (step.cue !== undefined && armedRef.current && isCueSatisfied(step.cue.when)) {
        armedRef.current = false
        useTourStore.getState().next()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, visit, step])

  if (!active || step === undefined) return null

  const last = index === TOUR_STEPS.length - 1
  const stop = (): void => useTourStore.getState().stop()

  return (
    <div className="tour-layer" aria-live="polite">
      <div ref={spotRef} className="tour-spot" />
      <div ref={beakRef} className="tour-beak" />
      <div
        ref={cardRef}
        className="tour-card"
        data-tour-step={step.id}
        role="dialog"
        aria-label={`App tour: ${step.title}`}
        style={{ visibility: 'hidden' }}
      >
        <div className="tour-card__head">
          <span className="tour-card__count">
            {index + 1}
            <span className="tour-card__count-total">/{TOUR_STEPS.length}</span>
          </span>
          <span className="tour-card__eyebrow">App tour</span>
          <button
            type="button"
            className="tour-card__close"
            aria-label="Leave the tour"
            title="Leave the tour (Esc)"
            onClick={stop}
          >
            ×
          </button>
        </div>
        <h2 className="tour-card__title">{step.title}</h2>
        <p className="tour-card__body">{step.body}</p>
        {showCue && step.cue !== undefined && (
          <p className="tour-card__cue">
            <span className="tour-card__cue-arrow" aria-hidden="true">
              →
            </span>
            {step.cue.hint}
          </p>
        )}
        <div className="tour-card__progress" aria-hidden="true">
          <div
            className="tour-card__progress-fill"
            style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }}
          />
        </div>
        <div className="tour-card__foot">
          <button type="button" className="tour-card__skip" onClick={stop}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          <span className="tour-card__nav">
            <button
              type="button"
              className="tour-card__arrow"
              aria-label="Previous step"
              title="Previous step (←)"
              disabled={index === 0}
              onClick={() => useTourStore.getState().back()}
            >
              ‹
            </button>
            <button
              type="button"
              className="tour-card__arrow tour-card__arrow--next"
              aria-label={last ? 'Finish the tour' : 'Next step'}
              title={last ? 'Finish' : 'Next step (→)'}
              onClick={() => useTourStore.getState().next()}
            >
              {last ? 'Done' : '›'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
