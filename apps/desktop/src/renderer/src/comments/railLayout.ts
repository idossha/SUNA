/**
 * Pure layout math for the anchor-aligned comments rail (CommentsRail.tsx).
 * Separated so it can be unit-tested headlessly — the component itself pulls
 * in CSS and stores.
 */

/** Vertical gap kept between two stacked cards. */
export const CARD_GAP = 10

export interface SlotEntry {
  id: string
  /** Document-space top the card wants (its anchor's line top). */
  desiredTop: number
  /** Measured card height (px). */
  height: number
}

/**
 * Push-down collision pass: sorted by desired top, each slot lands at
 * max(desired, previous bottom + gap) — a card never overlaps the one above
 * it, and never sits above its own anchor.
 */
export function layoutSlots(
  entries: readonly SlotEntry[],
  gap: number = CARD_GAP
): Map<string, number> {
  const sorted = [...entries].sort((a, b) => a.desiredTop - b.desiredTop)
  const out = new Map<string, number>()
  let cursor = Number.NEGATIVE_INFINITY
  for (const entry of sorted) {
    const top = Math.max(entry.desiredTop, cursor)
    out.set(entry.id, top)
    cursor = top + entry.height + gap
  }
  return out
}
