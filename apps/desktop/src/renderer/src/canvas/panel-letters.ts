import type { PublisherProfile } from '@suna/core'
import type { WorldPoint, WorldRect } from './canvas-util'

/**
 * Auto-letter panels (canvas parity spec §3.3): locate suna_mpl's top-level
 * axes groups, order them in reading order, and compute each panel letter's
 * text and placement per the active journal profile's convention.
 */

/** ids suna_mpl assigns to axes groups ('ax0', 'ax1', …). */
export const AXES_ID_RE = /^ax\d+$/

/**
 * Marks a `<text>` this feature inserted, so re-running it replaces its own
 * previous labels instead of stacking a second set on top of the first. It
 * rides along in the saved SVG (a plain XML attribute, ignored by every
 * renderer and by every publisher) — which is the point: the letters are
 * still there to replace after the file has been closed and reopened.
 */
export const PANEL_LETTER_ATTR = 'data-suna-panel-letter'

/** Minimal structural shape a real DOM Element (or a test double) satisfies. */
export interface ElementLike {
  getAttribute(name: string): string | null
  readonly children: ArrayLike<ElementLike>
}

/**
 * Every element (anywhere in the tree) whose id matches an axes-group
 * pattern, in document order. A matched group is not descended into further
 * — axes groups never nest, and this keeps a stray id that happens to match
 * inside one from being reported twice.
 */
export function findAxesGroupIds(root: ElementLike, pattern: RegExp = AXES_ID_RE): string[] {
  const found: string[] = []
  const walk = (el: ElementLike): void => {
    const id = el.getAttribute('id')
    if (id !== null && pattern.test(id)) {
      found.push(id)
      return
    }
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i]
      if (child) walk(child)
    }
  }
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]
    if (child) walk(child)
  }
  return found
}

/**
 * ids of the panel letters a previous run inserted, anywhere in the tree.
 * Unlike axes groups these DO get descended into — a marked `<text>` has no
 * element children, so the walk costs nothing extra and cannot miss one that
 * a later grouping operation moved inside another element.
 */
export function findPanelLetterIds(root: ElementLike): string[] {
  const found: string[] = []
  const walk = (el: ElementLike): void => {
    if (el.getAttribute(PANEL_LETTER_ATTR) !== null) {
      const id = el.getAttribute('id')
      if (id !== null && id !== '') found.push(id)
    }
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i]
      if (child) walk(child)
    }
  }
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]
    if (child) walk(child)
  }
  return found
}

export interface PanelLabelConvention {
  letterCase: 'lower' | 'upper'
  weight: 'bold' | 'regular'
  wrapper: 'parens' | 'none'
}

/** Sensible defaults (lowercase, bold, unwrapped) for a profile that states none of this. */
export function resolvePanelLabelConvention(
  profile: PublisherProfile | null
): PanelLabelConvention {
  const rule = profile?.figures.panelLabel
  return {
    letterCase: rule?.letterCase ?? 'lower',
    weight: rule?.weight ?? 'bold',
    wrapper: rule?.wrapper ?? 'none'
  }
}

/** 0→'a' … 25→'z', 26→'aa' … (spreadsheet-column style, for >26 panels). */
export function letterFor(index: number, letterCase: 'lower' | 'upper'): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letterCase === 'upper' ? out.toUpperCase() : out
}

export function formatPanelLabel(letter: string, wrapper: 'parens' | 'none'): string {
  return wrapper === 'parens' ? `(${letter})` : letter
}

/**
 * Reading-order sort (row-major, top-to-bottom then left-to-right). Rows
 * tolerate y jitter (half the shortest panel's height) so a visually
 * aligned row sorts purely by x even when bboxes — which include tick
 * labels and titles — don't share an exact y.
 */
export function orderPanelsForLettering<T extends { bbox: WorldRect }>(
  panels: readonly T[]
): T[] {
  if (panels.length < 2) return [...panels]
  const minHeight = Math.min(...panels.map((p) => p.bbox.height))
  const rowEpsilon = Math.max(minHeight * 0.5, 1e-6)
  return [...panels].sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y
    if (Math.abs(dy) > rowEpsilon) return dy
    return a.bbox.x - b.bbox.x
  })
}

/** Baseline lift above the panel's top edge, in multiples of the font size. */
const LABEL_GAP_EM = 0.4

/**
 * Ascent above the baseline, in multiples of the font size — a whole em.
 * Measured, not assumed: Chromium reports the ink box of a 7-unit bold
 * Helvetica 'a' as reaching ~0.93 em above its baseline (the font's full
 * ascent, not the glyph's x-height), so the ~0.75 em an ascender nominally
 * occupies still clipped. One em clears every face the profiles name.
 */
const LABEL_ASCENT_EM = 1

/**
 * Anchor for a panel-letter `<text>`: flush to the panel's left edge, with
 * the baseline lifted clear of the panel's top edge by a fraction of the
 * label's own font size — the common "letter sits just above-left of the
 * panel" convention, and never overlaps the plotted content.
 *
 * `bounds` (the artboard) is what makes that placement usable on a real
 * matplotlib export. A measured axes bbox includes the panel's tick labels
 * and title, so its top edge sits within a point or two of the artboard's:
 * the unclamped anchor puts the letter's ink ABOVE the artboard, where the
 * SVG viewport clips it and the button looks like it did nothing. Clamping
 * keeps every letter inside the page — flush to the top edge when there is
 * no room above the panel, which is where a reader expects it anyway.
 */
export function panelLabelAnchor(
  bbox: WorldRect,
  fontSizeUser: number,
  bounds: WorldRect | null = null
): WorldPoint {
  const x = bbox.x
  const y = bbox.y - fontSizeUser * LABEL_GAP_EM
  if (bounds === null) return { x, y }
  // A letter is about half an em wide; keep that much of the artboard to its
  // right so a panel flush with the right edge does not push it off the page.
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - fontSizeUser)
  const minY = bounds.y + fontSizeUser * LABEL_ASCENT_EM
  const maxY = Math.max(minY, bounds.y + bounds.height)
  return {
    x: Math.min(Math.max(x, bounds.x), maxX),
    y: Math.min(Math.max(y, minY), maxY)
  }
}
