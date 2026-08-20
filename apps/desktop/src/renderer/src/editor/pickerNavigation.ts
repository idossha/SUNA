/**
 * Shared keyboard navigation for the insert palettes (CitationPicker,
 * FigurePicker): what counts as "move the highlight", and keeping the
 * highlighted row on screen.
 *
 * The list scrolls — it holds every figure in the project — so moving the
 * highlight past the last visible row has to bring that row into view, or the
 * arrow keys walk the selection somewhere the reader cannot see.
 *
 * Vim users get ⌃j/⌃k (and ⌃n/⌃p) as well as the arrows. Bare j/k are NOT
 * bound: the focused element is a text input and typing "j" must search for
 * "j", the same reason vim's own command line does not take motions.
 */

/** Which way a key event moves the highlight, or null if it moves nothing. */
export function pickerNavDirection(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): 'down' | 'up' | null {
  if (event.key === 'ArrowDown') return 'down'
  if (event.key === 'ArrowUp') return 'up'
  if (!event.ctrlKey || event.metaKey || event.altKey) return null
  const key = event.key.toLowerCase()
  if (key === 'j' || key === 'n') return 'down'
  if (key === 'k' || key === 'p') return 'up'
  return null
}

/** New highlight index after `direction`, clamped to `[0, count - 1]`. */
export function nextActiveIndex(current: number, direction: 'down' | 'up', count: number): number {
  if (count === 0) return 0
  const next = direction === 'down' ? current + 1 : current - 1
  return Math.min(Math.max(next, 0), count - 1)
}

/** Geometry of one row inside its scrolling list, in list-content pixels. */
export interface RowMetrics {
  top: number
  height: number
  scrollTop: number
  viewportHeight: number
}

/** The list's new scrollTop so that the row is fully visible — unchanged when
 *  it already is. Pure, so the "follows the selection" rule is testable
 *  without a DOM. */
export function scrollTopFor({ top, height, scrollTop, viewportHeight }: RowMetrics): number {
  if (top < scrollTop) return top
  const bottom = top + height
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight
  return scrollTop
}

/**
 * Scroll `list`'s active row into view. Manual rather than
 * `Element.scrollIntoView`, which in a `position: fixed` palette also scrolls
 * the ancestor page; this touches the list's own scrollTop and nothing else.
 */
export function scrollActiveIntoView(list: HTMLElement | null, activeIndex: number): void {
  if (list === null) return
  const item = list.querySelectorAll<HTMLElement>('[data-picker-item]')[activeIndex]
  if (item === undefined) return
  list.scrollTop = scrollTopFor({
    top: item.offsetTop - list.offsetTop,
    height: item.offsetHeight,
    scrollTop: list.scrollTop,
    viewportHeight: list.clientHeight
  })
}
