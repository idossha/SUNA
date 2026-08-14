import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { type DecorationSet, EditorView } from '@codemirror/view'
import { extractSpans, livePreview } from './livePreview'

describe('extractSpans', () => {
  it('finds display math with an equation label at exact offsets', () => {
    const source = '# Title\n\n$$ {#eq:mass}\nE = mc^2\n$$\n'
    const { blocks } = extractSpans(source)
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block?.kind).toBe('blockMath')
    if (block?.kind !== 'blockMath') return
    expect(block.tex).toBe('E = mc^2')
    expect(block.label).toBe('eq:mass')
    expect(block.from).toBe(source.indexOf('$$'))
    expect(block.to).toBe(source.lastIndexOf('$$') + 2)
  })

  it('finds unlabeled display math', () => {
    const { blocks } = extractSpans('$$\nx + y\n$$\n')
    expect(blocks[0]?.kind).toBe('blockMath')
    expect(blocks[0]?.kind === 'blockMath' && blocks[0].label).toBeUndefined()
  })

  it('finds figure embeds as block spans', () => {
    const source = 'Intro.\n\n![[fig:overview]]\n\nMore.\n'
    const { blocks } = extractSpans(source)
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    if (block?.kind !== 'figure') throw new Error('expected figure span')
    expect(block.figureId).toBe('overview')
    expect(source.slice(block.from, block.to)).toBe('![[fig:overview]]')
  })

  it('finds inline math at exact offsets', () => {
    const source = 'The value $x^2$ grows.\n'
    const { inline } = extractSpans(source)
    const math = inline.find((span) => span.kind === 'inlineMath')
    if (math?.kind !== 'inlineMath') throw new Error('expected inline math')
    expect(math.tex).toBe('x^2')
    expect(source.slice(math.from, math.to)).toBe('$x^2$')
  })

  it('finds bracketed citations with multiple keys', () => {
    const source = 'Known result [@smith2020; @doe2019].\n'
    const { inline } = extractSpans(source)
    const cite = inline.find((span) => span.kind === 'cite')
    if (cite?.kind !== 'cite') throw new Error('expected citation')
    expect(cite.keys).toEqual(['smith2020', 'doe2019'])
    expect(source.slice(cite.from, cite.to)).toBe('[@smith2020; @doe2019]')
  })

  it('finds narrative citations and trims trailing punctuation', () => {
    const source = 'As shown by @smith2020.\n'
    const { inline } = extractSpans(source)
    const cite = inline.find((span) => span.kind === 'cite')
    if (cite?.kind !== 'cite') throw new Error('expected citation')
    expect(cite.keys).toEqual(['smith2020'])
    expect(source.slice(cite.from, cite.to)).toBe('@smith2020')
  })

  it('finds crossrefs with panel suffixes', () => {
    const source = 'See @fig:overview{a} for details.\n'
    const { inline } = extractSpans(source)
    const xref = inline.find((span) => span.kind === 'xref')
    if (xref?.kind !== 'xref') throw new Error('expected crossref')
    expect(xref.refKind).toBe('fig')
    expect(xref.id).toBe('overview')
    expect(xref.suffix).toBe('a')
    expect(source.slice(xref.from, xref.to)).toBe('@fig:overview{a}')
  })

  it('finds bare crossrefs without suffixes', () => {
    const { inline } = extractSpans('See @eq:mass here.\n')
    const xref = inline.find((span) => span.kind === 'xref')
    if (xref?.kind !== 'xref') throw new Error('expected crossref')
    expect(xref.refKind).toBe('eq')
    expect(xref.id).toBe('mass')
    expect(xref.suffix).toBeUndefined()
  })

  it('does not scan citations inside code fences', () => {
    const { inline } = extractSpans('```\n[@nope] and @fig:x\n```\n')
    expect(inline).toHaveLength(0)
  })

  it('does not scan citations inside inline code or math', () => {
    const { inline } = extractSpans('Use `@config` with $@x$ carefully.\n')
    expect(inline.filter((span) => span.kind === 'cite')).toHaveLength(0)
    expect(inline.filter((span) => span.kind === 'xref')).toHaveLength(0)
  })

  it('does not treat email-like text as a citation', () => {
    const { inline } = extractSpans('mail me a@example.com today\n')
    expect(inline.filter((span) => span.kind === 'cite')).toHaveLength(0)
  })

  it('emits heading line classes and dims the hash prefix', () => {
    const source = '## Methods\n'
    const { lines, marks } = extractSpans(source)
    expect(lines).toEqual([{ at: 0, cls: 'cm-lp-h2' }])
    expect(marks).toContainEqual({ from: 0, to: 3, cls: 'cm-lp-syntax' })
  })

  it('caps heading classes at h4', () => {
    const { lines } = extractSpans('###### Deep\n')
    expect(lines[0]?.cls).toBe('cm-lp-h4')
  })

  it('marks strong spans and dims their asterisks', () => {
    const source = 'A **bold** claim.\n'
    const { marks } = extractSpans(source)
    const from = source.indexOf('**')
    const to = source.indexOf('claim') - 1
    expect(marks).toContainEqual({ from, to, cls: 'cm-lp-strong' })
    expect(marks).toContainEqual({ from, to: from + 2, cls: 'cm-lp-syntax' })
    expect(marks).toContainEqual({ from: to - 2, to, cls: 'cm-lp-syntax' })
  })

  it('marks emphasis spans and dims their delimiters', () => {
    const source = 'An *odd* result.\n'
    const { marks } = extractSpans(source)
    const from = source.indexOf('*')
    const to = source.indexOf(' result')
    expect(marks).toContainEqual({ from, to, cls: 'cm-lp-em' })
  })

  it('returns sorted, non-overlapping replace spans for mixed content', () => {
    const source =
      '# Title\n\nSee [@a2020] and $y$ near @fig:one{b}.\n\n$$\nz\n$$\n\n![[fig:two]]\n'
    const { blocks, inline } = extractSpans(source)
    expect(blocks.map((span) => span.kind)).toEqual(['blockMath', 'figure'])
    expect(inline.map((span) => span.kind)).toEqual(['cite', 'inlineMath', 'xref'])
    const all = [...inline, ...blocks]
    for (const span of all) {
      expect(span.from).toBeGreaterThanOrEqual(0)
      expect(span.to).toBeGreaterThan(span.from)
    }
    for (let i = 1; i < inline.length; i += 1) {
      expect(inline[i]!.from).toBeGreaterThanOrEqual(inline[i - 1]!.to)
    }
  })
})

describe('livePreview block decorations (headless state field)', () => {
  function countBlockDecorations(state: EditorState): number {
    const sets = state
      .facet(EditorView.decorations)
      .filter((value): value is DecorationSet => typeof value !== 'function')
    let count = 0
    for (const set of sets) {
      const cursor = set.iter()
      while (cursor.value !== null) {
        count += 1
        cursor.next()
      }
    }
    return count
  }

  it('replaces display math while the selection is elsewhere', () => {
    const doc = 'Text.\n\n$$\nE = mc^2\n$$\n'
    const state = EditorState.create({ doc, extensions: [livePreview()] })
    expect(countBlockDecorations(state)).toBe(1)
  })

  it('reveals raw source when the cursor enters the range, and re-renders on leave', () => {
    const doc = 'Text.\n\n$$\nE = mc^2\n$$\n'
    const initial = EditorState.create({ doc, extensions: [livePreview()] })
    const inside = initial.update({
      selection: EditorSelection.cursor(doc.indexOf('E ='))
    }).state
    expect(countBlockDecorations(inside)).toBe(0)
    const outside = inside.update({ selection: EditorSelection.cursor(0) }).state
    expect(countBlockDecorations(outside)).toBe(1)
  })

  it('rebuilds spans when the document changes', () => {
    const initial = EditorState.create({ doc: 'Plain.\n', extensions: [livePreview()] })
    expect(countBlockDecorations(initial)).toBe(0)
    const withFigure = initial.update({
      changes: { from: initial.doc.length, insert: '\n![[fig:new]]\n' },
      selection: EditorSelection.cursor(0)
    }).state
    expect(countBlockDecorations(withFigure)).toBe(1)
  })
})
