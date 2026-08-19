/* ---------------------------------------------------------------------------
   Timeline geometry and labelling — the parts with no DOM in them.

   Kept out of the component so the graph's shape can be asserted directly:
   an edge that bends the wrong way is a wrong string here, not a screenshot
   somebody has to look at.
   --------------------------------------------------------------------------- */

/** Column pitch in px. Narrow on purpose — this lives in a 272px sidebar. */
export const LANE_W = 12
/** Row height in px; two lines of text (subject, then author and time). */
export const ROW_H = 42
export const DOT_R = 3.5
/** How many columns the gutter will draw before it stops widening. */
export const MAX_LANES = 6
/** Matches the DOT sentinel in the main process's graph service. */
export const DOT = -1

export const GRAPH_COLORS = 8

/** Centre x of a column. */
export function laneX(lane: number): number {
  return lane * LANE_W + LANE_W / 2
}

/**
 * The SVG path for one edge crossing a row's band.
 *
 * Three shapes: a line leaving the dot downward (`from === DOT`), a line
 * arriving at the dot from above (`to === DOT`), and a line passing straight
 * through. The bends are cubics whose control points sit on the vertical, so
 * a branch leaves its parent's line tangentially instead of as a hard corner.
 */
export function edgePath(from: number, to: number, lane: number, height = ROW_H): string {
  const mid = height / 2
  if (from === DOT) {
    const x0 = laneX(lane)
    const x1 = laneX(to)
    if (x0 === x1) return `M${x0},${mid} L${x1},${height}`
    return `M${x0},${mid} C${x0},${mid + height * 0.25} ${x1},${mid + height * 0.25} ${x1},${height}`
  }
  if (to === DOT) {
    const x0 = laneX(from)
    const x1 = laneX(lane)
    if (x0 === x1) return `M${x0},0 L${x1},${mid}`
    return `M${x0},0 C${x0},${height * 0.25} ${x1},${height * 0.25} ${x1},${mid}`
  }
  const x0 = laneX(from)
  const x1 = laneX(to)
  if (x0 === x1) return `M${x0},0 L${x1},${height}`
  return `M${x0},0 C${x0},${mid} ${x1},${mid} ${x1},${height}`
}

/** Gutter width for a graph this wide, capped so the text keeps its room. */
export function gutterWidth(laneCount: number): number {
  return Math.min(Math.max(laneCount, 1), MAX_LANES) * LANE_W
}

/**
 * A small, stable number from a string — used to give an author a colour that
 * does not move between sessions. FNV-1a: short, no dependency, and spreads
 * near-identical inputs (two addresses at one institution) into different
 * buckets.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Author colour index, keyed on the email so a renamed author keeps it. */
export function authorColor(email: string, name: string): number {
  const key = email.trim() !== '' ? email.trim().toLowerCase() : name.trim().toLowerCase()
  return hashString(key) % GRAPH_COLORS
}

/**
 * One or two letters for the avatar. Takes the first letter of the first and
 * last whitespace-separated parts, which gets "Ada Lovelace" → AL and
 * "ada@lab.edu" → A.
 */
export function initials(name: string, email: string): string {
  const source = name.trim() !== '' ? name.trim() : (email.split('@')[0] ?? '')
  const parts = source.split(/[\s._-]+/).filter((part) => part !== '')
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "just now", "14m", "3h", "2d", then a date. Compact because it shares a
 * line with the author's name in a narrow panel.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const delta = now - then
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`
  const date = new Date(then)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

/** Full timestamp for the row's tooltip. */
export function absoluteTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  return new Date(then).toLocaleString()
}
