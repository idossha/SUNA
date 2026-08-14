import type { interact } from '@suna/canvas'

/**
 * DOM-adjacent helpers shared by the canvas UI. Everything here reads the
 * mirror clone (layout) or the engine document (attributes) — never both for
 * the same fact (canvas-editing-suite.md §8).
 */

/** Semantic gids from suna_mpl ('ax0.legend', 'ax0', 'suptitle', 'legend'). */
export function isSemanticId(id: string): boolean {
  return id.includes('.') || /^(ax\d+|suptitle|legend\d*)$/.test(id)
}

/**
 * Selectable unit: nearest semantic-gid ancestor if one exists (matplotlib
 * internals like patch_2/text_5 are not units), else the deepest id'd element.
 */
export function pickTarget(eventTarget: EventTarget | null, svg: SVGSVGElement): string | null {
  let el = eventTarget instanceof Element ? eventTarget : null
  // Only figure content is selectable — never ids from the surrounding app DOM.
  if (!el || !svg.contains(el)) return null
  let fallback: string | null = null
  while (el && el !== svg) {
    const id = el.getAttribute('id')
    if (id) {
      if (isSemanticId(id)) return id
      fallback ??= id
    }
    el = el.parentElement
  }
  return fallback
}

/**
 * Marquee/snap candidate units from the mirror: elements whose own id is
 * their selectable unit, minus non-semantic containers of other units (a
 * marquee should hit `line2d_3`, not the `figure_1` wrapper around
 * everything). `<defs>` content never participates.
 */
export function collectUnitElements(svg: SVGSVGElement): { id: string; el: Element }[] {
  const own: { id: string; el: Element }[] = []
  for (const el of svg.querySelectorAll('[id]')) {
    if (el === svg || el.closest('defs') !== null) continue
    const id = el.getAttribute('id')
    if (!id) continue
    // Nearest semantic ancestor-or-self decides the unit this element belongs to.
    let unit: string | null = null
    let cursor: Element | null = el
    while (cursor && cursor !== svg) {
      const cid = cursor.getAttribute('id')
      if (cid && isSemanticId(cid)) {
        unit = cid
        break
      }
      cursor = cursor.parentElement
    }
    if (unit === null || unit === id) own.push({ id, el })
  }
  // Drop non-semantic wrappers that contain other candidates (semantic units
  // may nest legitimately, e.g. ax0 ⊃ ax0.legend).
  return own.filter(
    (c) => isSemanticId(c.id) || !own.some((o) => o.el !== c.el && c.el.contains(o.el))
  )
}

/**
 * Engine-bus target for a mirror element: its id when present, else a
 * structural address ('#<anchor>>nth:<k>…') rooted at the nearest id'd
 * ancestor (or '#root'). Mirror and engine documents share structure, so the
 * address resolves identically in both.
 */
export function targetForElement(el: Element, svg: SVGSVGElement): string | null {
  const ownId = el.getAttribute('id')
  if (ownId) return ownId
  const segments: number[] = []
  let cursor: Element = el
  while (cursor !== svg) {
    const parent: Element | null = cursor.parentElement
    if (parent === null) return null
    segments.unshift(Array.prototype.indexOf.call(parent.children, cursor))
    const pid = parent.getAttribute('id')
    if (pid && parent !== svg) {
      return `#${pid}>${segments.map((k) => `nth:${k}`).join('>')}`
    }
    cursor = parent
  }
  return `#root>${segments.map((k) => `nth:${k}`).join('>')}`
}

/**
 * Effective value of a style-ish property on an engine element: the style
 * attribute wins (the matplotlib way), else the presentation attribute.
 */
export function styleValue(el: Element, prop: string): string | null {
  const raw = el.getAttribute('style')
  if (raw !== null) {
    let match: string | null = null
    for (const entry of raw.split(';')) {
      const colon = entry.indexOf(':')
      if (colon < 0) continue
      if (entry.slice(0, colon).trim() === prop) match = entry.slice(colon + 1).trim()
    }
    if (match !== null) return match
  }
  return el.getAttribute(prop)
}

/** First number in an attribute value ('12', '12px', '12,13 14'). */
export function firstNumber(raw: string | null): number | null {
  if (raw === null) return null
  const m = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(raw)
  return m ? Number(m[0]) : null
}

/** Compact attribute-value formatting (≤3 decimals, no -0). */
export function fmt(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** Normalize any CSS color to #rrggbb for <input type="color">; null if not a color. */
export function toHexColor(value: string | null): string | null {
  if (value === null || value === 'none' || value === '') return null
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [r, g, b] = [value[1], value[2], value[3]]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  // Delegate named/rgb() forms to the browser.
  const probe = document.createElement('span')
  probe.style.color = value
  if (probe.style.color === '') return null
  document.body.appendChild(probe)
  const rgb = getComputedStyle(probe).color
  probe.remove()
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  if (!m) return null
  const hex = (s: string): string => Number(s).toString(16).padStart(2, '0')
  return `#${hex(m[1] ?? '0')}${hex(m[2] ?? '0')}${hex(m[3] ?? '0')}`
}

export type WorldRect = interact.WorldRect
