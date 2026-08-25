/**
 * Where Ctrl-h / Ctrl-l goes: the app's three horizontally-arranged regions
 * and the moves between them (vim-motion users' `<C-w>h`-style window hops,
 * spelled with the plain Ctrl chords because SUNA's "windows" are chrome, not
 * splits).
 *
 * Deliberately one axis. The chrome the user hops through is a row — rail,
 * sidebar, editor — and every region's own content scrolls VERTICALLY, so
 * Ctrl-j/k are left alone rather than given a second, competing meaning.
 *
 * Pure and DOM-free so the graph is testable in node — apps/desktop has no
 * jsdom. useVimNav.ts owns the focusing.
 *
 * `null` means "no region move": the key is left to whatever has focus, which
 * is what makes plain h/j/k/l keep working INSIDE a region (j/k walking the
 * explorer's rows, h/l collapsing a folder) once the user has hopped there.
 */

export const NAV_REGIONS = ['rail', 'sidebar', 'dock'] as const

export type NavRegion = (typeof NAV_REGIONS)[number]

export type NavDirection = 'h' | 'j' | 'k' | 'l'

/** Which left-hand chrome is on screen. Both hidden is a real state (⌘⌥B). */
export interface ChromeVisibility {
  rail: boolean
  sidebar: boolean
}

/** The first visible region to the LEFT of the dock stage, if any. */
function leftOfDock(visible: ChromeVisibility): NavRegion | null {
  if (visible.sidebar) return 'sidebar'
  if (visible.rail) return 'rail'
  return null
}

export function moveRegion(
  from: NavRegion,
  direction: NavDirection,
  visible: ChromeVisibility
): NavRegion | null {
  if (direction === 'h') {
    if (from === 'dock') return leftOfDock(visible)
    if (from === 'sidebar') return visible.rail ? 'rail' : null
    return null
  }
  if (direction === 'l') {
    if (from === 'rail') return visible.sidebar ? 'sidebar' : 'dock'
    if (from === 'sidebar') return 'dock'
    return null
  }
  // j/k: the region's own vertical motion, never a hop.
  return null
}

/** Arrow key a plain h/j/k/l stands in for inside a chrome region. */
export const ARROW_FOR_DIRECTION: Record<NavDirection, string> = {
  h: 'ArrowLeft',
  j: 'ArrowDown',
  k: 'ArrowUp',
  l: 'ArrowRight'
}

/** The direction a key press means, or null if it is not one of h/j/k/l. */
export function directionForCode(code: string): NavDirection | null {
  switch (code) {
    case 'KeyH':
      return 'h'
    case 'KeyJ':
      return 'j'
    case 'KeyK':
      return 'k'
    case 'KeyL':
      return 'l'
    default:
      return null
  }
}
