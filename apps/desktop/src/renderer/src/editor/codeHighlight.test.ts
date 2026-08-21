import { describe, expect, it } from 'vitest'
import { classHighlighter } from '@lezer/highlight'
import { supportedCodeLanguages, tokenizeCode } from './codeHighlight'

/**
 * The tests run against @lezer/highlight's `classHighlighter` — stable,
 * readable `tok-*` names — rather than themes.ts's HighlightStyle, whose
 * class names are generated. Both are ordinary Highlighters, so what these
 * assert about one holds for the other; the app passes the themed one.
 */
const tokens = (code: string, lang: string | undefined): { text: string; classes: string }[] | null =>
  tokenizeCode(code, lang, classHighlighter)

/** The classes assigned to `needle`, or null if it was never its own token. */
function classesOf(code: string, lang: string, needle: string): string | null {
  return tokens(code, lang)?.find((token) => token.text === needle)?.classes ?? null
}

describe('tokenizeCode', () => {
  it('colours a Lezer-parsed language', () => {
    expect(classesOf('import numpy as np\n', 'python', 'import')).toContain('tok-keyword')
  })

  it('colours a legacy stream mode, which is how bash gets colour at all', () => {
    // The fence in the screenshot that started this: ```bash. Nothing in
    // CodeMirror ships a Lezer grammar for shell, so this path has to work.
    const classes = classesOf('python analysis/fit.py --input data.fits\n', 'bash', '--input')
    expect(classes).not.toBeNull()
  })

  it('reconstructs the source exactly, so no character is dropped or invented', () => {
    const code = 'def f(x):\n    # comment\n    return x ** 2\n'
    const out = tokens(code, 'python')
    expect(out).not.toBeNull()
    expect(out?.map((token) => token.text).join('')).toBe(code)
  })

  it('emits line breaks as their own unstyled token', () => {
    const out = tokens('a = 1\nb = 2\n', 'python')
    const breaks = out?.filter((token) => token.text === '\n') ?? []
    expect(breaks).toHaveLength(2)
    expect(breaks.every((token) => token.classes === '')).toBe(true)
  })

  it('matches the info string case-insensitively', () => {
    expect(tokens('x = 1\n', 'Python')).not.toBeNull()
  })

  it('returns null for a fence with no info string or an unknown one', () => {
    expect(tokens('some prose\n', undefined)).toBeNull()
    expect(tokens('10 PRINT "hi"\n', 'basic')).toBeNull()
  })

  it('returns null past the size cap instead of parsing a pathological fence', () => {
    expect(tokens(`x = 1\n`.repeat(40_000), 'python')).toBeNull()
  })

  it('covers the languages an astronomy manuscript actually fences', () => {
    // Each of these is a real fence someone will write in this app; a
    // language silently dropped from the registry is a silent loss of colour.
    const expected = ['bash', 'bibtex', 'c', 'fortran', 'json', 'julia', 'latex', 'matlab', 'python', 'r', 'sql', 'yaml']
    expect(supportedCodeLanguages()).toEqual(expect.arrayContaining(expected))
    for (const lang of expected) expect(tokens('x\n', lang)).not.toBeNull()
  })
})
