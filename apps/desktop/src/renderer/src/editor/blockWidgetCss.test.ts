import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * CodeMirror measures a block widget's height from its element rect, which
 * EXCLUDES margins. A vertical margin on a block widget is therefore height the
 * height map never learns about, and the error accumulates down the document.
 *
 * Once map and DOM disagree by more than half a line, drawSelection's
 * `wrappedLine()` — which feeds a y from `coordsAtPos` (DOM-driven) into
 * `posAtCoords` (height-map-driven) — resolves the wrong visual line, returns an
 * inverted range, and paints a selection rectangle a full line-height into the
 * text below. Measured against the real app before the fix: the map ran 13.5px
 * behind the DOM by line 36 and 69.5px by line 46, and a `v j j j j` selection
 * drew a 41.4px-tall, full-width band over the blank line beneath it.
 *
 * Vertical space on these elements belongs in `padding`, which the rect
 * includes. This test is the guard, because nothing else in the suite can see
 * geometry — apps/desktop has no DOM test environment.
 */
const CSS = readFileSync(fileURLToPath(new URL('./editor.css', import.meta.url)), 'utf8')

/** Block widget roots — every `Decoration.replace({ block: true })` in livePreview.ts. */
const BLOCK_WIDGET_ROOTS = ['cm-lp-figure', 'cm-lp-table', 'cm-lp-math-block']

interface CssRule {
  selector: string
  body: string
}

export function parseRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(withoutComments)) !== null) {
    const selector = match[1]?.trim()
    const body = match[2]
    if (selector !== undefined && body !== undefined) rules.push({ selector, body })
  }
  return rules
}

/**
 * The vertical margin a declaration block sets, or null. `margin-inline` and an
 * all-zero shorthand are fine; `margin: 12px 0 16px` is not.
 */
export function verticalMargin(body: string): string | null {
  for (const raw of body.split(';')) {
    const decl = raw.trim()
    if (decl === '') continue
    const [prop, ...rest] = decl.split(':')
    const name = prop?.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (name === undefined || value === '') continue

    if (name === 'margin-top' || name === 'margin-bottom' || name === 'margin-block') {
      if (!isZero(value)) return decl
      continue
    }
    if (name === 'margin-block-start' || name === 'margin-block-end') {
      if (!isZero(value)) return decl
      continue
    }
    if (name === 'margin') {
      const parts = value.split(/\s+/)
      // 1 value sets all sides; 2 and 3 put the vertical pair first/third; 4 is
      // top right bottom left.
      const vertical = parts.length === 1 ? [parts[0]] : [parts[0], parts[2] ?? parts[0]]
      if (vertical.some((v) => v !== undefined && !isZero(v))) return decl
    }
  }
  return null
}

function isZero(value: string): boolean {
  return /^0[a-z%]*$/i.test(value.trim())
}

/** Only the widget root itself — `.cm-lp-table table` and `.cm-lp-figure__body` are ordinary children. */
function targetsRoot(selector: string, root: string): boolean {
  return selector
    .split(',')
    .some((part) => new RegExp(`\\.${root}(?![\\w-])\\s*$`).test(part.trim()))
}

describe('block widget CSS', () => {
  const rules = parseRules(CSS)

  it.each(BLOCK_WIDGET_ROOTS)('.%s declares no vertical margin', (root) => {
    const offenders = rules
      .filter((rule) => targetsRoot(rule.selector, root))
      .map((rule) => ({ selector: rule.selector, margin: verticalMargin(rule.body) }))
      .filter((found) => found.margin !== null)

    expect(offenders).toEqual([])
  })

  it('still finds the widget roots, so the test cannot pass by matching nothing', () => {
    for (const root of BLOCK_WIDGET_ROOTS) {
      expect(rules.some((rule) => targetsRoot(rule.selector, root))).toBe(true)
    }
  })
})

describe('verticalMargin', () => {
  it('accepts what does not affect measured height', () => {
    expect(verticalMargin('margin-inline: auto;')).toBeNull()
    expect(verticalMargin('margin: 0;')).toBeNull()
    expect(verticalMargin('margin: 0 auto;')).toBeNull()
    expect(verticalMargin('padding: 12px 16px;')).toBeNull()
  })

  it('catches every shorthand arity, which is how the bug was written', () => {
    expect(verticalMargin('margin: 12px 0 16px;')).toBe('margin: 12px 0 16px')
    expect(verticalMargin('margin: 6px 0;')).toBe('margin: 6px 0')
    expect(verticalMargin('margin: 8px;')).toBe('margin: 8px')
    expect(verticalMargin('margin: 1px 2px 3px 4px;')).toBe('margin: 1px 2px 3px 4px')
    expect(verticalMargin('margin-top: 6px;')).toBe('margin-top: 6px')
    expect(verticalMargin('margin-block: 1em;')).toBe('margin-block: 1em')
  })
})
