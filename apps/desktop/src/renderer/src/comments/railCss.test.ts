import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * CSS guards for the comments rail. This suite exists because a single dead
 * selector once broke the whole comments UI silently — the old gutter's
 * `.msdoc__body > .cmt-gutter:not(:has(.cmt, .cmt-dot))` collapse matched
 * NOTHING (`.cmt` is not a class any element carries), so the gutter and its
 * compose box rendered at width 0 in the manuscript tab for weeks. Nothing
 * else in the suite can see CSS — apps/desktop has no DOM test environment
 * (same rationale as editor/blockWidgetCss.test.ts, whose parseRules pattern
 * this reuses).
 */

const COMMENTS_CSS = readFileSync(
  fileURLToPath(new URL('./comments.css', import.meta.url)),
  'utf8'
)
const MANUSCRIPT_CSS = readFileSync(
  fileURLToPath(new URL('../manuscript/manuscript.css', import.meta.url)),
  'utf8'
)
const EDITOR_CSS = readFileSync(
  fileURLToPath(new URL('../editor/editor.css', import.meta.url)),
  'utf8'
)

interface CssRule {
  selector: string
  body: string
}

function parseRules(css: string): CssRule[] {
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

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of body.split(';')) {
    const decl = raw.trim()
    if (decl === '') continue
    const colon = decl.indexOf(':')
    if (colon === -1) continue
    out.set(decl.slice(0, colon).trim().toLowerCase(), decl.slice(colon + 1).trim())
  }
  return out
}

const ALL_RULES = [...parseRules(COMMENTS_CSS), ...parseRules(MANUSCRIPT_CSS), ...parseRules(EDITOR_CSS)]

describe('comments rail CSS guards', () => {
  it('the aligned viewport clips; the track is transform-driven', () => {
    const viewport = parseRules(COMMENTS_CSS).find((r) => r.selector === '.cmt-rail__viewport')
    expect(viewport).toBeDefined()
    expect(declarations(viewport!.body).get('overflow')).toBe('hidden')
    const track = parseRules(COMMENTS_CSS).find((r) => r.selector === '.cmt-rail__track')
    expect(track).toBeDefined()
    expect(declarations(track!.body).get('will-change')).toBe('transform')
  })

  /**
   * The alignment invariant, in two halves. `.cmt-rail__header` is exactly as
   * tall as `.msdoc__toolbar`, which is what puts the rail viewport's top edge
   * level with the document area's — and nothing may sit in flow above the
   * viewport, or that band becomes dead space where no card can be drawn
   * level with its anchor. The outline learned this the hard way: in flow,
   * two rows of it cost 67px of the page's top.
   */
  it('the rail header matches the manuscript toolbar, so the viewport starts level', () => {
    const header = parseRules(COMMENTS_CSS).find((r) => r.selector === '.cmt-rail__header')
    const toolbar = parseRules(MANUSCRIPT_CSS).find((r) => r.selector === '.msdoc__toolbar')
    expect(header).toBeDefined()
    expect(toolbar).toBeDefined()
    expect(declarations(header!.body).get('height')).toBe(declarations(toolbar!.body).get('height'))
  })

  it('the outline floats over the track instead of shortening it', () => {
    const outline = parseRules(COMMENTS_CSS).find((r) => r.selector === '.cmt-outline')
    expect(outline).toBeDefined()
    const decls = declarations(outline!.body)
    expect(decls.get('position')).toBe('absolute')
    // opaque, or the cards it covers would show through it
    expect(decls.get('background')).toBeDefined()
    // and under the resize grip, so the rail edge stays draggable
    const grip = parseRules(COMMENTS_CSS).find((r) => r.selector === '.cmt-rail__grip')
    expect(Number(decls.get('z-index'))).toBeLessThan(Number(declarations(grip!.body).get('z-index')))
  })

  it('the action row wraps — a 3-button row can never overflow the card again', () => {
    const rule = parseRules(COMMENTS_CSS).find((r) => r.selector.includes('.cmt__actions'))
    expect(rule).toBeDefined()
    expect(declarations(rule!.body).get('flex-wrap')).toBe('wrap')
  })

  it('no rule anywhere collapses a rail element to width 0', () => {
    for (const rule of ALL_RULES) {
      if (!rule.selector.includes('.cmt-rail')) continue
      const width = declarations(rule.body).get('width')
      expect(width, `"${rule.selector}" sets width: ${width}`).not.toBe('0')
      expect(width, `"${rule.selector}" sets width: ${width}`).not.toBe('0px')
    }
  })

  it('no selector references the deleted gutter-era classes', () => {
    for (const rule of ALL_RULES) {
      for (const dead of ['.cmt-gutter', '.cmt-dot', '.cmt-popover', '.cmt-line-dot']) {
        expect(rule.selector, `"${rule.selector}" references ${dead}`).not.toContain(dead)
      }
    }
  })

  it('nothing animates `top` or `transform` — the scroll-lag class of bug must not return', () => {
    for (const rule of ALL_RULES) {
      const transition = declarations(rule.body).get('transition')
      if (transition === undefined) continue
      expect(transition, `"${rule.selector}" transitions top`).not.toMatch(/(^|[\s,])top([\s,]|$)/)
      if (rule.selector.includes('.cmt-rail')) {
        expect(transition, `"${rule.selector}" transitions transform`).not.toMatch(/transform/)
      }
    }
  })
})
