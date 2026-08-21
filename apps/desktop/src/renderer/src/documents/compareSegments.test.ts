import { describe, expect, it } from 'vitest'
import { diffSections } from '@suna/core'
import {
  changeRangesIn,
  groupSegments,
  hunkCount,
  paragraphAround,
  quoteBlockFor,
  segmentsFor,
  splitRows
} from './compareSegments'

const BASE = '# Methods\n\nWe used a t-test to compare groups.\n'
const HEAD = '# Methods\n\nWe used a linear mixed model to compare groups.\n'

function methods(): ReturnType<typeof diffSections>[number] {
  return diffSections(BASE, HEAD)[0]!
}

describe('segmentsFor', () => {
  it('tiles the head text with equal and insert segments', () => {
    const s = methods()
    const segments = segmentsFor(s.baseText, s.headText, s.ops)
    const rebuilt = segments
      .filter((seg) => seg.kind !== 'delete')
      .map((seg) => seg.text)
      .join('')
    expect(rebuilt).toBe(s.headText)
  })

  it('tiles the base text with equal and delete segments', () => {
    const s = methods()
    const segments = segmentsFor(s.baseText, s.headText, s.ops)
    const rebuilt = segments
      .filter((seg) => seg.kind !== 'insert')
      .map((seg) => seg.text)
      .join('')
    expect(rebuilt).toBe(s.baseText)
  })

  it('counts a replacement as one change, not two', () => {
    const s = methods()
    const segments = segmentsFor(s.baseText, s.headText, s.ops)
    expect(segments.some((seg) => seg.kind === 'delete')).toBe(true)
    expect(segments.some((seg) => seg.kind === 'insert')).toBe(true)
    expect(hunkCount(segments)).toBe(1)
  })

  it('keeps offsets that address the original strings', () => {
    const s = methods()
    for (const segment of segmentsFor(s.baseText, s.headText, s.ops)) {
      const source = segment.kind === 'delete' ? s.baseText : s.headText
      expect(source.slice(segment.from, segment.from + segment.text.length)).toBe(segment.text)
    }
  })

  it('renders an unchanged section as one equal run', () => {
    const segments = segmentsFor('', 'Nothing changed here.', [])
    expect(segments).toEqual([{ kind: 'equal', text: 'Nothing changed here.', hunk: null, from: 0 }])
  })
})

describe('paragraphAround', () => {
  const text = 'First para.\n\nSecond para, longer.\n\nThird.'

  it('expands to the blank lines around the change', () => {
    const at = text.indexOf('longer')
    const range = paragraphAround(text, at, at + 6)
    expect(text.slice(range.from, range.to)).toBe('Second para, longer.')
  })

  it('handles the first paragraph', () => {
    const range = paragraphAround(text, 0, 5)
    expect(text.slice(range.from, range.to)).toBe('First para.')
  })

  it('handles the last paragraph', () => {
    const at = text.indexOf('Third')
    const range = paragraphAround(text, at, at + 5)
    expect(text.slice(range.from, range.to)).toBe('Third.')
  })

  it('never returns a range shorter than the selection it was given', () => {
    const range = paragraphAround(text, 0, text.length)
    expect(range.to).toBe(text.length)
  })
})

describe('quoteBlockFor', () => {
  it('quotes the current text and marks what is new in it', () => {
    const s = methods()
    const segments = segmentsFor(s.baseText, s.headText, s.ops)
    const at = s.headText.indexOf('We used')
    const para = paragraphAround(s.headText, at, at + 10)
    const block = quoteBlockFor(s.headText, segments, para.from, para.to)
    expect(block.startsWith('::quote\n')).toBe(true)
    expect(block).toContain('+++')
    expect(block).toContain('linear mixed model')
    // The old wording is the reviewer's copy, not ours to quote back at them.
    expect(block).not.toContain('t-test')
  })

  it('quotes unchanged prose without any red', () => {
    const s = methods()
    const segments = segmentsFor(s.baseText, s.headText, s.ops)
    const at = s.headText.indexOf('to compare groups.')
    const block = quoteBlockFor(s.headText, segments, at, s.headText.length)
    expect(block).toBe('::quote\nto compare groups.\n::\n')
  })

  it('reports change ranges relative to the excerpt', () => {
    const s = methods()
    const segments = segmentsFor(s.baseText, s.headText, s.ops)
    const start = s.headText.indexOf('We used')
    const ranges = changeRangesIn(segments, start, s.headText.length)
    expect(ranges.every((r) => r.from >= 0 && r.to > r.from)).toBe(true)
    expect(s.headText.slice(start + ranges[0]!.from, start + ranges[0]!.to)).toContain('linear')
  })

  it('finds no changes in a range that holds none', () => {
    const s = methods()
    const segments = segmentsFor(s.baseText, s.headText, s.ops)
    expect(changeRangesIn(segments, 0, 5)).toEqual([])
  })
})

describe('splitRows', () => {
  const base = 'One unchanged.\n\nWe used a t-test.\n\nLast one.'
  const head = 'One unchanged.\n\nWe used a linear mixed model that is much longer.\n\nLast one.'

  function rows(): ReturnType<typeof splitRows> {
    const [section] = diffSections(base, head)
    const s = section!
    return splitRows(segmentsFor(s.baseText, s.headText, s.ops))
  }

  it('cuts at the paragraph breaks both versions share', () => {
    expect(rows()).toHaveLength(3)
  })

  it('keeps every character: the rows rebuild both sides', () => {
    const [section] = diffSections(base, head)
    const all = rows().flatMap((r) => r.segments)
    expect(all.filter((s) => s.kind !== 'delete').map((s) => s.text).join('')).toBe(
      section!.headText
    )
    expect(all.filter((s) => s.kind !== 'insert').map((s) => s.text).join('')).toBe(
      section!.baseText
    )
  })

  it('puts a change in the row of the paragraph it belongs to', () => {
    const changed = rows().map((r) => r.segments.some((s) => s.kind !== 'equal'))
    expect(changed).toEqual([false, true, false])
  })

  it('leaves offsets addressing the original strings after a cut', () => {
    const [section] = diffSections(base, head)
    for (const segment of rows().flatMap((r) => r.segments)) {
      const source = segment.kind === 'delete' ? section!.baseText : section!.headText
      expect(source.slice(segment.from, segment.from + segment.text.length)).toBe(segment.text)
    }
  })

  it('returns one row when nothing shares a paragraph break', () => {
    const [section] = diffSections('single line', 'single line changed')
    const s = section!
    expect(splitRows(segmentsFor(s.baseText, s.headText, s.ops))).toHaveLength(1)
  })
})

describe('groupSegments', () => {
  it('makes a replacement one group, not two', () => {
    const s = methods()
    const groups = groupSegments(segmentsFor(s.baseText, s.headText, s.ops))
    const hunks = groups.filter((g) => g.kind === 'hunk')
    expect(hunks).toHaveLength(1)
    const first = hunks[0]
    expect(first?.kind === 'hunk' ? first.segments.map((x) => x.kind) : []).toEqual([
      'delete',
      'insert'
    ])
  })

  it('keeps unchanged runs as their own groups', () => {
    const s = methods()
    const groups = groupSegments(segmentsFor(s.baseText, s.headText, s.ops))
    expect(groups.filter((g) => g.kind === 'equal').length).toBeGreaterThan(0)
    expect(groups.map((g) => g.kind).join(',')).toContain('equal,hunk')
  })

  it('loses nothing', () => {
    const s = methods()
    const segments = segmentsFor(s.baseText, s.headText, s.ops)
    const back = groupSegments(segments).flatMap((g) =>
      g.kind === 'equal' ? [g.segment] : g.segments
    )
    expect(back).toEqual(segments)
  })
})
