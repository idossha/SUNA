/**
 * Pure collision layout for the margin comment gutter (comments/CommentGutter).
 *
 * The gutter computes each comment's *ideal* vertical position from its
 * anchor's on-screen row (comments/anchorExtension's coordsAtPos-based
 * helpers) — this module never touches CodeMirror, the DOM, or React; it
 * only turns "ideal top + measured card height" into "final top, no two
 * cards overlap" so it can be unit tested without any of that machinery.
 */

/** A card's ideal (anchor-derived) top and its own rendered height, both in px. */
export interface CardAnchor {
  id: string
  /** Ideal top, e.g. the anchor's on-screen row. May be negative or exceed the viewport — this function does not clamp. */
  top: number
  /** The card's own rendered height (compact or expanded). */
  height: number
}

export interface CardPosition {
  id: string
  top: number
}

/**
 * Pushes cards down, in anchor order, so none overlap by less than `gap`.
 * Each card lands at `max(its own anchor top, previous card's bottom + gap)`
 * — the closest position to its anchor that does not collide with the card
 * immediately above it. Ties (identical anchor top) keep the input array's
 * relative order, so callers control stacking order for "many cards on one
 * line" by array order (e.g. comment creation time).
 */
export function layoutCards(anchors: readonly CardAnchor[], gap: number): CardPosition[] {
  const ordered = anchors
    .map((anchor, index) => ({ anchor, index }))
    .sort((a, b) => a.anchor.top - b.anchor.top || a.index - b.index)

  const out: CardPosition[] = []
  let prevBottom = Number.NEGATIVE_INFINITY
  for (const { anchor } of ordered) {
    const top = Math.max(anchor.top, prevBottom + gap)
    out.push({ id: anchor.id, top })
    prevBottom = top + anchor.height
  }
  return out
}

export interface ViewportPartition {
  /** Ids whose ideal top is above the visible window, nearest-first. */
  above: string[]
  /** Ids whose ideal top is below the visible window, nearest-first. */
  below: string[]
  /** Anchors within the visible window, original order preserved. */
  inRange: CardAnchor[]
}

/**
 * Splits anchors by whether their ideal top falls within [0, containerHeight]
 * — the gutter's currently-visible viewport strip. Anchors above/below
 * collapse into an edge badge; only `inRange` should be fed to layoutCards.
 * `margin` extends the visible window slightly so a card whose anchor sits
 * just past the edge is not needlessly bucketed away.
 */
export function partitionByViewport(
  anchors: readonly CardAnchor[],
  containerHeight: number,
  margin = 0
): ViewportPartition {
  const above: Array<{ id: string; top: number }> = []
  const below: Array<{ id: string; top: number }> = []
  const inRange: CardAnchor[] = []
  for (const anchor of anchors) {
    if (anchor.top < -margin) above.push(anchor)
    else if (anchor.top > containerHeight + margin) below.push(anchor)
    else inRange.push(anchor)
  }
  above.sort((a, b) => b.top - a.top) // nearest to the top edge first
  below.sort((a, b) => a.top - b.top) // nearest to the bottom edge first
  return { above: above.map((a) => a.id), below: below.map((a) => a.id), inRange }
}
