import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHROME_TOKENS, EDITOR_TOKENS, SYNTAX_TOKENS } from '@suna/core'

/**
 * A stylesheet may only use the app's real design tokens.
 *
 * This exists because of a specific bug. `documents.css` was written with
 * INVENTED variable names — `--panel`, `--fg-dim`, `--border` — each with a
 * dark hex fallback. Nothing in the app defines those, so every rule silently
 * fell back to its fallback, and the whole feature rendered dark-on-dark in
 * the light theme: the "+" menu was a black rectangle with black text.
 *
 * Typecheck cannot catch it, unit tests cannot catch it, and it looks correct
 * in the default theme. A grep is the only thing that can, so here it is.
 */

const STYLE_DIR = join(__dirname)
const TOKENS_CSS = join(__dirname, '..', 'styles', 'tokens.css')

/**
 * Every custom property the app really defines: the metrics and font stacks
 * declared in tokens.css, plus every COLOUR token, which is generated per
 * theme from @suna/core's registry rather than written in any stylesheet.
 * Both halves matter — a name absent from either is the invented-variable bug
 * this test exists for.
 */
function definedTokens(): Set<string> {
  const css = readFileSync(TOKENS_CSS, 'utf8')
  const declared = [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]!)
  const themed = [...CHROME_TOKENS, ...EDITOR_TOKENS, ...SYNTAX_TOKENS].map((t) => t.cssVar)
  return new Set([...declared, ...themed])
}

function cssFiles(): string[] {
  return readdirSync(STYLE_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => join(STYLE_DIR, f))
}

describe('documents stylesheets use real tokens', () => {
  it('references no variable that tokens.css does not define', () => {
    const defined = definedTokens()
    expect(defined.size).toBeGreaterThan(20)

    const offenders: string[] = []
    for (const path of cssFiles()) {
      const css = readFileSync(path, 'utf8')
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)/gi)) {
        const name = m[1]!
        if (!defined.has(name)) offenders.push(`${path.split('/').pop()}: ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares no fallback value inside var(), which would mask a wrong name', () => {
    // `var(--wrong, #191919)` renders perfectly in one theme and is unreadable
    // in the other. Without a fallback the same mistake renders as nothing,
    // which is noticed immediately.
    const offenders: string[] = []
    for (const path of cssFiles()) {
      const css = readFileSync(path, 'utf8')
      for (const m of css.matchAll(/var\(--[a-z0-9-]+\s*,/gi)) {
        offenders.push(`${path.split('/').pop()}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('hardcodes no hex colour', () => {
    const offenders: string[] = []
    for (const path of cssFiles()) {
      const css = readFileSync(path, 'utf8')
      for (const m of css.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
        offenders.push(`${path.split('/').pop()}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
