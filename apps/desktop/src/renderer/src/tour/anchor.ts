/**
 * Where the tour card and its arrow go, given the rectangle being pointed at.
 *
 * Pure geometry on purpose: the overlay measures the DOM, this decides the
 * layout, and the decision is unit-testable without a browser (the desktop
 * test runner has no DOM).
 */

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

export interface Anchored {
  /** Which side of the target the card ended up on. */
  readonly side: Side
  /** Top-left of the card, in viewport coordinates. */
  readonly card: { readonly x: number; readonly y: number }
  /**
   * Where the arrow meets the card, in viewport coordinates: the midpoint of
   * the card edge that faces the target, slid along that edge towards the
   * target's centre and kept clear of the rounded corners.
   */
  readonly beak: { readonly x: number; readonly y: number }
}

/**
 * Space left between the highlighted element and the card. Wide enough that
 * the card never crowds what it is talking about, and wide enough to hold the
 * bouncing pointer a call-to-action step draws in the gap.
 */
export const TOUR_GAP = 44
/** The card never comes closer than this to a viewport edge. */
export const TOUR_MARGIN = 12
/** How far the beak stays from a card corner. */
const BEAK_INSET = 22

export const DEFAULT_SIDES: readonly Side[] = ['bottom', 'right', 'top', 'left']

/** Grow a rectangle by `pad` on every side — the spotlight ring's geometry. */
export function padRect(rect: Rect, pad: number): Rect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2
  }
}

function clamp(value: number, min: number, max: number): number {
  // min wins when the range is inverted (a card wider than the viewport):
  // overflowing the far edge beats overflowing the near one, which would
  // push the card's own text off-screen to the left.
  return Math.max(min, Math.min(max, value))
}

/** Room between the target's edge and the viewport edge on `side`. */
function freeSpace(target: Rect, viewport: Size, side: Side): number {
  switch (side) {
    case 'top':
      return target.y - TOUR_MARGIN
    case 'bottom':
      return viewport.height - (target.y + target.height) - TOUR_MARGIN
    case 'left':
      return target.x - TOUR_MARGIN
    case 'right':
      return viewport.width - (target.x + target.width) - TOUR_MARGIN
  }
}

function needed(card: Size, side: Side): number {
  return side === 'top' || side === 'bottom' ? card.height + TOUR_GAP : card.width + TOUR_GAP
}

/**
 * Pick the first preferred side the card actually fits on. When none fits —
 * a big card beside a target that fills the window — take the roomiest side
 * rather than the first, so the card overlaps as little of the target as it
 * can.
 */
export function chooseSide(
  target: Rect,
  card: Size,
  viewport: Size,
  prefer: readonly Side[] = DEFAULT_SIDES
): Side {
  const order = prefer.length > 0 ? prefer : DEFAULT_SIDES
  for (const side of order) {
    if (freeSpace(target, viewport, side) >= needed(card, side)) return side
  }
  let best = order[0] ?? 'bottom'
  let bestSpace = -Infinity
  for (const side of DEFAULT_SIDES) {
    const space = freeSpace(target, viewport, side) - needed(card, side)
    if (space > bestSpace) {
      best = side
      bestSpace = space
    }
  }
  return best
}

/** Place the card and its arrow against `target`. */
export function anchorCard(
  target: Rect,
  card: Size,
  viewport: Size,
  prefer: readonly Side[] = DEFAULT_SIDES
): Anchored {
  const side = chooseSide(target, card, viewport, prefer)
  const targetCx = target.x + target.width / 2
  const targetCy = target.y + target.height / 2

  const maxX = viewport.width - card.width - TOUR_MARGIN
  const maxY = viewport.height - card.height - TOUR_MARGIN

  let x: number
  let y: number
  switch (side) {
    case 'bottom':
      x = clamp(targetCx - card.width / 2, TOUR_MARGIN, maxX)
      y = clamp(target.y + target.height + TOUR_GAP, TOUR_MARGIN, maxY)
      break
    case 'top':
      x = clamp(targetCx - card.width / 2, TOUR_MARGIN, maxX)
      y = clamp(target.y - TOUR_GAP - card.height, TOUR_MARGIN, maxY)
      break
    case 'right':
      x = clamp(target.x + target.width + TOUR_GAP, TOUR_MARGIN, maxX)
      y = clamp(targetCy - card.height / 2, TOUR_MARGIN, maxY)
      break
    case 'left':
      x = clamp(target.x - TOUR_GAP - card.width, TOUR_MARGIN, maxX)
      y = clamp(targetCy - card.height / 2, TOUR_MARGIN, maxY)
      break
  }

  // The beak sits on the card edge that faces the target and slides along it
  // to line up with the target's centre — that is what makes it read as
  // pointing at a specific control rather than at the card's own middle.
  const inset = (extent: number): number => Math.min(BEAK_INSET, extent / 2)
  const beak =
    side === 'bottom'
      ? { x: clamp(targetCx, x + inset(card.width), x + card.width - inset(card.width)), y }
      : side === 'top'
        ? {
            x: clamp(targetCx, x + inset(card.width), x + card.width - inset(card.width)),
            y: y + card.height
          }
        : side === 'right'
          ? { x, y: clamp(targetCy, y + inset(card.height), y + card.height - inset(card.height)) }
          : {
              x: x + card.width,
              y: clamp(targetCy, y + inset(card.height), y + card.height - inset(card.height))
            }

  return { side, card: { x, y }, beak }
}

/** Centre the card — the layout used by steps that point at nothing. */
export function centreCard(card: Size, viewport: Size): { x: number; y: number } {
  return {
    x: Math.max(TOUR_MARGIN, (viewport.width - card.width) / 2),
    y: Math.max(TOUR_MARGIN, (viewport.height - card.height) / 2)
  }
}

/** True when the rectangle has real extent — a hidden element measures 0×0. */
export function isVisibleRect(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0
}
