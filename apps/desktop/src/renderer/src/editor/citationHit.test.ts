import { describe, expect, it } from 'vitest'
import { citationKeyAtLineOffset } from './citationHit'

describe('citationKeyAtLineOffset — single bracketed citation', () => {
  const line = 'This was shown earlier [@Gunn1972].'
  // "[" at 23, the "Gunn1972" token spans 24..33, "]" at 33.

  it('resolves anywhere inside the brackets, including their edges', () => {
    expect(citationKeyAtLineOffset(line, 23)).toBe('Gunn1972') // "["
    expect(citationKeyAtLineOffset(line, 26)).toBe('Gunn1972')
    expect(citationKeyAtLineOffset(line, 30)).toBe('Gunn1972')
    expect(citationKeyAtLineOffset(line, 34)).toBe('Gunn1972') // just past "]"
  })

  it('returns null before the citation and past the end of the line', () => {
    expect(citationKeyAtLineOffset(line, 0)).toBeNull()
    expect(citationKeyAtLineOffset(line, 20)).toBeNull()
    expect(citationKeyAtLineOffset(line, 36)).toBeNull()
  })
})

describe('citationKeyAtLineOffset — multi-key clusters', () => {
  const line = 'See [@Smith2020; @Jones2021] for details.'
  // cluster "[@Smith2020; @Jones2021]" spans 4..28; "Smith2020" token 5..15;
  // "Jones2021" token 17..27.

  it('resolves to the key whose own token span contains the offset', () => {
    expect(citationKeyAtLineOffset(line, 10)).toBe('Smith2020')
    expect(citationKeyAtLineOffset(line, 22)).toBe('Jones2021')
  })

  it('resolves the gap between the two tokens to whichever is closer', () => {
    expect(citationKeyAtLineOffset(line, 16)).toBe('Smith2020') // just after "Smith2020;"
    expect(citationKeyAtLineOffset(line, 17)).toBe('Jones2021') // right at "@Jones2021"
  })

  it('resolves at the outer bracket edges to the nearest key', () => {
    expect(citationKeyAtLineOffset(line, 4)).toBe('Smith2020') // "["
    expect(citationKeyAtLineOffset(line, 28)).toBe('Jones2021') // "]"
  })
})

describe('citationKeyAtLineOffset — narrative (bare) @key', () => {
  it('resolves a bare @key preceded by whitespace (start of line)', () => {
    const line = '@Gunn1972 showed the effect first.'
    expect(citationKeyAtLineOffset(line, 0)).toBe('Gunn1972')
    expect(citationKeyAtLineOffset(line, 5)).toBe('Gunn1972')
    expect(citationKeyAtLineOffset(line, 9)).toBe('Gunn1972')
  })

  it('resolves a bare @key preceded by an opening bracket', () => {
    const line = 'the effect (@Gunn1972) is well known.'
    expect(citationKeyAtLineOffset(line, 15)).toBe('Gunn1972')
  })

  it('does not resolve a mid-word @ (no whitespace/bracket before it)', () => {
    const line = 'user@Gunn1972 is not a citation'
    expect(citationKeyAtLineOffset(line, 8)).toBeNull()
  })
})

describe('citationKeyAtLineOffset — key adjacent to punctuation', () => {
  it('trims a trailing period and excludes it from the hit range', () => {
    const line = 'As shown by @Smith2020.'
    // key token spans 12..22 (right up to, but not including, the ".")
    expect(citationKeyAtLineOffset(line, 20)).toBe('Smith2020')
    expect(citationKeyAtLineOffset(line, 22)).toBe('Smith2020') // right before the "."
    expect(citationKeyAtLineOffset(line, 23)).toBeNull() // past the "."
  })

  it('stops the key at a comma (not part of the token grammar at all)', () => {
    const line = 'As shown by @Smith2020, and others.'
    expect(citationKeyAtLineOffset(line, 20)).toBe('Smith2020')
    expect(citationKeyAtLineOffset(line, 23)).toBeNull() // past the comma
  })

  it('handles a citekey containing hyphens without over-trimming', () => {
    const line = 'via @van-der-Waals1950 forces'
    expect(citationKeyAtLineOffset(line, 10)).toBe('van-der-Waals1950')
  })
})

describe('citationKeyAtLineOffset — cursor outside any citation', () => {
  it('returns null for plain prose with no citations', () => {
    expect(citationKeyAtLineOffset('Nothing to see here.', 5)).toBeNull()
  })

  it('returns null on an empty line', () => {
    expect(citationKeyAtLineOffset('', 0)).toBeNull()
  })

  it('returns null in the gap between two citations on the same line', () => {
    const line = '[@A2020] and also [@B2021].'
    expect(citationKeyAtLineOffset(line, line.indexOf('and'))).toBeNull()
    // sanity: the two citations on either side of the gap do resolve
    expect(citationKeyAtLineOffset(line, 0)).toBe('A2020')
    expect(citationKeyAtLineOffset(line, line.indexOf('B2021'))).toBe('B2021')
  })
})

describe('citationKeyAtLineOffset — cross-reference tokens are not citations', () => {
  it('ignores a bare @fig:/@tbl:/@eq:/@sec: cross-reference', () => {
    expect(citationKeyAtLineOffset('see @fig:spectrum for the plot', 6)).toBeNull()
    expect(citationKeyAtLineOffset('see @tbl:results below', 6)).toBeNull()
    expect(citationKeyAtLineOffset('as derived in @eq:stripping', 16)).toBeNull()
    expect(citationKeyAtLineOffset('described in @sec:methods', 15)).toBeNull()
  })

  it('ignores a cross-reference-shaped key inside a bracket cluster', () => {
    expect(citationKeyAtLineOffset('[@fig:spectrum]', 5)).toBeNull()
  })

  it('still resolves a real citation key that merely contains a colon-free prefix', () => {
    // "figure2020" doesn't match a crossref kind ("figure" isn't in the
    // set), so it's a normal key, not a cross-reference.
    const line = '@figure2020 reported it'
    expect(citationKeyAtLineOffset(line, 3)).toBe('figure2020')
  })
})
