import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state'
import { type DecorationSet, EditorView } from '@codemirror/view'
import {
  buildInlineDecorations,
  extractSpans,
  intrinsicSizeFromViewBox,
  intrinsicSvgSize,
  livePreview,
  renderTableHtml
} from './livePreview'

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

  it('finds a markdown image as a block span, with its url and alt', () => {
    const source = 'Intro.\n\n![A spectrum](images/plot.png)\n\nMore.\n'
    const { blocks } = extractSpans(source)
    const image = blocks.find((span) => span.kind === 'image')
    if (image?.kind !== 'image') throw new Error('expected image span')
    expect(image.url).toBe('images/plot.png')
    expect(image.alt).toBe('A spectrum')
    expect(source.slice(image.from, image.to)).toBe('![A spectrum](images/plot.png)')
  })

  it('keeps an image with no alt text', () => {
    const { blocks } = extractSpans('![](p.png)\n')
    const image = blocks.find((span) => span.kind === 'image')
    if (image?.kind !== 'image') throw new Error('expected image span')
    expect(image.alt).toBe('')
  })

  it('carries an explicit width and swallows the attribute block into the span', () => {
    const source = 'Intro.\n\n![A spectrum](images/plot.png){width=50%}\n\nMore.\n'
    const { blocks } = extractSpans(source)
    const image = blocks.find((span) => span.kind === 'image')
    if (image?.kind !== 'image') throw new Error('expected image span')
    expect(image.width).toBe('50%')
    // The braces being inside [from,to) is what hides them in reading mode.
    expect(source.slice(image.from, image.to)).toBe('![A spectrum](images/plot.png){width=50%}')
  })

  it('reads a px width and a bare number as px', () => {
    const px = extractSpans('![a](p.png){width=320px}\n').blocks[0]
    expect(px?.kind === 'image' && px.width).toBe('320px')
    const bare = extractSpans('![a](p.png){width=320}\n').blocks[0]
    expect(bare?.kind === 'image' && bare.width).toBe('320px')
  })

  it('leaves a plain image with no width — the common case', () => {
    const { blocks } = extractSpans('![A spectrum](images/plot.png)\n')
    const image = blocks.find((span) => span.kind === 'image')
    if (image?.kind !== 'image') throw new Error('expected image span')
    expect(image.width).toBeUndefined()
  })

  it('leaves a malformed attribute block outside the span, so it stays visible', () => {
    const source = '![a](p.png){width=abc}\n'
    const { blocks } = extractSpans(source)
    const image = blocks.find((span) => span.kind === 'image')
    if (image?.kind !== 'image') throw new Error('expected image span')
    expect(image.width).toBeUndefined()
    expect(source.slice(image.from, image.to)).toBe('![a](p.png)')
  })

  it('does not treat an image inside a code fence as an image', () => {
    const source = '```\n![alt](p.png)\n```\n'
    const { blocks } = extractSpans(source)
    expect(blocks.some((span) => span.kind === 'image')).toBe(false)
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

  // The demo manuscript's Results section writes every figure reference as
  // "(@fig:x{a})". A whitespace-only preceding gate skipped those entirely —
  // the braces rendered literally (ui-fix-plan defect 9). Must stay in
  // lockstep with PRECEDING_OK in packages/markdown/src/parse.ts.
  it('finds a crossref with a panel suffix directly after an opening paren', () => {
    const source = 'The line profile (@fig:fig-spectrum{a}) is broad.\n'
    const { inline } = extractSpans(source)
    const xref = inline.find((span) => span.kind === 'xref')
    if (xref?.kind !== 'xref') throw new Error('expected crossref')
    expect(xref.refKind).toBe('fig')
    expect(xref.id).toBe('fig-spectrum')
    expect(xref.suffix).toBe('a')
    // the parens themselves stay in the prose — only the token is replaced
    expect(source.slice(xref.from, xref.to)).toBe('@fig:fig-spectrum{a}')
  })

  it('finds a suffixless crossref directly after an opening paren', () => {
    const source = 'in closed form (@eq:stripping) for a disk\n'
    const { inline } = extractSpans(source)
    const xref = inline.find((span) => span.kind === 'xref')
    if (xref?.kind !== 'xref') throw new Error('expected crossref')
    expect(xref.refKind).toBe('eq')
    expect(xref.id).toBe('stripping')
    expect(source.slice(xref.from, xref.to)).toBe('@eq:stripping')
  })

  // `[@key]` stays a *citation cluster* (the bracket branch of SCAN wins), so
  // the bracket in PRECEDING_OK only matters for a crossref nested deeper in
  // bracketed prose — asserted here so a future edit can't quietly turn
  // "[@tbl:x]" into a cross-reference.
  it('finds a crossref after an opening brace, and keeps [@key] a citation', () => {
    const braced = extractSpans('see {@tbl:observed} above\n').inline
    const xref = braced.find((span) => span.kind === 'xref')
    if (xref?.kind !== 'xref') throw new Error('expected crossref after {')
    expect(xref.refKind).toBe('tbl')
    expect(xref.id).toBe('observed')

    const bracketed = extractSpans('see [@tbl:observed] above\n').inline
    expect(bracketed.filter((span) => span.kind === 'xref')).toHaveLength(0)
    expect(bracketed.filter((span) => span.kind === 'cite')).toHaveLength(1)
  })

  it('still refuses a bare token glued to a word character', () => {
    const { inline } = extractSpans('mail me a@fig:nope today\n')
    expect(inline.filter((span) => span.kind === 'xref')).toHaveLength(0)
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

  it('emits a heading line class and a hide span covering the hash prefix', () => {
    const source = '## Methods\n'
    const { lines, inline } = extractSpans(source)
    expect(lines).toEqual([{ at: 0, cls: 'cm-lp-h2' }])
    const hide = inline.find((span) => span.kind === 'hide' && span.from === 0)
    if (hide?.kind !== 'hide') throw new Error('expected a hide span for the heading prefix')
    expect(hide.to).toBe(3) // "## "
    // reveal is extended to the whole line, not just the "## " prefix
    expect(hide.revealFrom).toBe(0)
    expect(hide.revealTo).toBe(source.indexOf('\n'))
  })

  it('caps heading classes at h4', () => {
    const { lines } = extractSpans('###### Deep\n')
    expect(lines[0]?.cls).toBe('cm-lp-h4')
  })

  it('hides a heading with no text at all, and does not throw', () => {
    const source = '##\n'
    expect(() => extractSpans(source)).not.toThrow()
    const { inline } = extractSpans(source)
    const hide = inline.find((span) => span.kind === 'hide')
    if (hide?.kind !== 'hide') throw new Error('expected a hide span')
    expect(hide.from).toBe(0)
    expect(hide.to).toBe(2)
  })

  it('marks strong spans and hides both "**" delimiter pairs', () => {
    const source = 'A **bold** claim.\n'
    const { marks, inline } = extractSpans(source)
    const from = source.indexOf('**')
    const to = source.indexOf('claim') - 1
    expect(marks).toContainEqual({ from, to, cls: 'cm-lp-strong' })
    const hides = inline.filter((span) => span.kind === 'hide')
    expect(hides).toContainEqual({ kind: 'hide', from, to: from + 2, revealFrom: from, revealTo: to })
    expect(hides).toContainEqual({ kind: 'hide', from: to - 2, to, revealFrom: from, revealTo: to })
  })

  it('marks emphasis spans and hides their single-char delimiters', () => {
    const source = 'An *odd* result.\n'
    const { marks, inline } = extractSpans(source)
    const from = source.indexOf('*')
    const to = source.indexOf(' result')
    expect(marks).toContainEqual({ from, to, cls: 'cm-lp-em' })
    const hides = inline.filter((span) => span.kind === 'hide')
    expect(hides).toContainEqual({ kind: 'hide', from, to: from + 1, revealFrom: from, revealTo: to })
    expect(hides).toContainEqual({ kind: 'hide', from: to - 1, to, revealFrom: from, revealTo: to })
  })

  it('does not create any strong/emphasis span for an unclosed "**" at EOF', () => {
    const source = 'This has **unclosed at eof'
    expect(() => extractSpans(source)).not.toThrow()
    const { marks, inline } = extractSpans(source)
    expect(marks.filter((m) => m.cls === 'cm-lp-strong' || m.cls === 'cm-lp-em')).toHaveLength(0)
    expect(inline.filter((span) => span.kind === 'hide')).toHaveLength(0)
  })

  it('does not hide backslash-escaped emphasis markers', () => {
    const source = 'This is \\*not emphasis\\* here.\n'
    const { marks, inline } = extractSpans(source)
    expect(marks).toHaveLength(0)
    expect(inline.filter((span) => span.kind === 'hide')).toHaveLength(0)
  })

  it('marks strikethrough and hides the "~~" delimiter pairs', () => {
    const source = 'This is ~~gone~~ now.\n'
    const { marks, inline } = extractSpans(source)
    const from = source.indexOf('~~')
    const to = source.indexOf(' now')
    expect(marks).toContainEqual({ from, to, cls: 'cm-lp-strike' })
    const hides = inline.filter((span) => span.kind === 'hide')
    expect(hides).toContainEqual({ kind: 'hide', from, to: from + 2, revealFrom: from, revealTo: to })
    expect(hides).toContainEqual({ kind: 'hide', from: to - 2, to, revealFrom: from, revealTo: to })
  })

  it('hides only the backtick fence of inline code, keeping content untouched', () => {
    const source = 'Use `**not bold**` here.\n'
    const { marks, inline } = extractSpans(source)
    const codeStart = source.indexOf('`')
    const codeEnd = source.lastIndexOf('`') + 1
    expect(marks).toContainEqual({ from: codeStart + 1, to: codeEnd - 1, cls: 'cm-lp-code' })
    const hides = inline.filter((span) => span.kind === 'hide')
    expect(hides).toContainEqual({
      kind: 'hide',
      from: codeStart,
      to: codeStart + 1,
      revealFrom: codeStart,
      revealTo: codeEnd
    })
    expect(hides).toContainEqual({
      kind: 'hide',
      from: codeEnd - 1,
      to: codeEnd,
      revealFrom: codeStart,
      revealTo: codeEnd
    })
    // the "**" inside the code span never becomes a strong mark/hide
    expect(marks.filter((m) => m.cls === 'cm-lp-strong')).toHaveLength(0)
  })

  it('hides link brackets/parens/URL and styles the text as a link', () => {
    const source = 'See [my text](https://example.com/path) here.\n'
    const { marks, inline } = extractSpans(source)
    const linkFrom = source.indexOf('[')
    const linkTo = source.indexOf(')') + 1
    const textFrom = source.indexOf('my text')
    const textTo = textFrom + 'my text'.length
    expect(marks).toContainEqual({ from: textFrom, to: textTo, cls: 'cm-lp-link' })
    const hides = inline.filter((span) => span.kind === 'hide')
    expect(hides).toContainEqual({
      kind: 'hide',
      from: linkFrom,
      to: textFrom,
      revealFrom: linkFrom,
      revealTo: linkTo
    })
    expect(hides).toContainEqual({
      kind: 'hide',
      from: textTo,
      to: linkTo,
      revealFrom: linkFrom,
      revealTo: linkTo
    })
  })

  it('leaves a bare autolink untouched', () => {
    const source = 'See <https://example.com> for details.\n'
    const { marks, inline } = extractSpans(source)
    expect(marks.filter((m) => m.cls === 'cm-lp-link')).toHaveLength(0)
    expect(inline.filter((span) => span.kind === 'hide')).toHaveLength(0)
  })

  it('replaces an unordered bullet marker with a widget span, and leaves ordered numbers alone', () => {
    const source = '- one\n- two\n'
    const { inline } = extractSpans(source)
    const bullets = inline.filter((span) => span.kind === 'bullet')
    expect(bullets).toHaveLength(2)
    const first = bullets[0]
    if (first?.kind !== 'bullet') throw new Error('expected a bullet span')
    expect(first.from).toBe(0)
    expect(first.to).toBe(source.indexOf('one'))
    expect(first.revealFrom).toBe(0)
    expect(first.revealTo).toBe(source.indexOf('\n'))

    const orderedSource = '1. one\n2. two\n'
    expect(extractSpans(orderedSource).inline.filter((span) => span.kind === 'bullet')).toHaveLength(0)
  })

  it('replaces a nested bullet marker at its own (indented) offset', () => {
    const source = '- one\n  - nested\n'
    const { inline } = extractSpans(source)
    const bullets = inline.filter((span) => span.kind === 'bullet')
    expect(bullets).toHaveLength(2)
    const nested = bullets.find((span) => span.kind === 'bullet' && span.from > 0)
    if (nested?.kind !== 'bullet') throw new Error('expected the nested bullet span')
    expect(source.slice(nested.from, nested.to)).toBe('- ')
  })

  it('hides a blockquote marker per line and keeps a stable line class', () => {
    const source = '> quoted line one\n> quoted line two\n'
    const { lines, inline } = extractSpans(source)
    expect(lines.filter((l) => l.cls === 'cm-lp-quote')).toHaveLength(2)
    const hides = inline.filter((span) => span.kind === 'hide')
    expect(hides).toHaveLength(2)
    const first = hides[0]
    if (first?.kind !== 'hide') throw new Error('expected a hide span')
    expect(source.slice(first.from, first.to)).toBe('> ')
  })

  it('hides both ">" levels of a nested blockquote line in one span', () => {
    const source = '> outer\n> > inner\n> outer again\n'
    const { inline } = extractSpans(source)
    const hides = inline.filter((span) => span.kind === 'hide')
    expect(hides).toHaveLength(3) // one per physical line, including the doubly-marked middle line
    const nested = hides.find((span) => source.slice(span.from, span.to) === '> > ')
    expect(nested).toBeDefined()
  })

  it('does not hide a lazy-continuation blockquote line lacking its own ">"', () => {
    const source = '> quoted line one\nquoted line two\n'
    const { lines, inline } = extractSpans(source)
    // both lines still get the quote-bar line class...
    expect(lines.filter((l) => l.cls === 'cm-lp-quote')).toHaveLength(2)
    // ...but only the first line has a literal ">" to hide
    expect(inline.filter((span) => span.kind === 'hide')).toHaveLength(1)
  })

  it('finds a GFM table as a block span covering whole lines', () => {
    const source = 'Intro.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n'
    const { blocks } = extractSpans(source)
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    if (block?.kind !== 'table') throw new Error('expected table span')
    expect(block.md).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(source.charAt(block.from - 1)).toBe('\n')
    expect(source.charAt(block.to)).toBe('\n')
  })

  it('does not emit inline spans for citations inside table cells', () => {
    const source = '| ref |\n| --- |\n| [@smith2020] |\n'
    const { blocks, inline } = extractSpans(source)
    expect(blocks[0]?.kind).toBe('table')
    expect(inline).toHaveLength(0)
  })

  it('does not treat a pipe table inside a code fence as a table', () => {
    const { blocks } = extractSpans('```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n')
    expect(blocks).toHaveLength(0)
  })

  it('returns sorted, non-overlapping replace spans for mixed content', () => {
    const source =
      '# Title\n\nSee [@a2020] and $y$ near @fig:one{b}.\n\n$$\nz\n$$\n\n![[fig:two]]\n'
    const { blocks, inline } = extractSpans(source)
    expect(blocks.map((span) => span.kind)).toEqual(['blockMath', 'figure'])
    const contentKinds = inline.map((span) => span.kind).filter((kind) => kind !== 'hide')
    expect(contentKinds).toEqual(['cite', 'inlineMath', 'xref'])
    const all = [...inline, ...blocks]
    for (const span of all) {
      expect(span.from).toBeGreaterThanOrEqual(0)
      expect(span.to).toBeGreaterThan(span.from)
    }
    for (let i = 1; i < inline.length; i += 1) {
      expect(inline[i]!.from).toBeGreaterThanOrEqual(inline[i - 1]!.from)
    }
  })
})

/* ---------------------------------------------------------------------------
   The sizing seam paintAsset uses on an inlined <svg>. An SVG carrying only a
   viewBox has no intrinsic size and collapses to 0x0 — invisible — so these
   pin the recovery of a real width/height from the viewBox, and the fallback
   to "no attributes at all" for anything unusable (never `width="0"`).
   ------------------------------------------------------------------------- */

describe('intrinsicSizeFromViewBox', () => {
  it('recovers the extent from a plain space-separated viewBox', () => {
    expect(intrinsicSizeFromViewBox('0 0 940 500')).toEqual({ width: 940, height: 500 })
  })

  it('accepts comma separators, a non-zero origin, and surrounding whitespace', () => {
    expect(intrinsicSizeFromViewBox('0,0,940,500')).toEqual({ width: 940, height: 500 })
    expect(intrinsicSizeFromViewBox('10 20 940 500')).toEqual({ width: 940, height: 500 })
    expect(intrinsicSizeFromViewBox('  0 0 940 500  ')).toEqual({ width: 940, height: 500 })
    expect(intrinsicSizeFromViewBox('0,  0 , 940 ,500')).toEqual({ width: 940, height: 500 })
  })

  // matplotlib writes pt-derived fractions — examples/demo-paper's figures are
  // exactly these two strings, so a whole-number-only parser would drop them.
  it('keeps fractional extents from matplotlib output', () => {
    expect(intrinsicSizeFromViewBox('0 0 510.23622 164.409449')).toEqual({
      width: 510.23622,
      height: 164.409449
    })
    expect(intrinsicSizeFromViewBox('0 0 249.448819 198.425197')).toEqual({
      width: 249.448819,
      height: 198.425197
    })
  })

  it('returns null for an absent, empty or wrong-arity viewBox', () => {
    expect(intrinsicSizeFromViewBox(null)).toBeNull()
    expect(intrinsicSizeFromViewBox('')).toBeNull()
    expect(intrinsicSizeFromViewBox('   ')).toBeNull()
    expect(intrinsicSizeFromViewBox('0 0 940')).toBeNull()
    expect(intrinsicSizeFromViewBox('0 0 940 500 60')).toBeNull()
  })

  it('returns null for a non-numeric token', () => {
    expect(intrinsicSizeFromViewBox('0 0 940px 500px')).toBeNull()
    expect(intrinsicSizeFromViewBox('0 0 auto 500')).toBeNull()
  })

  it('returns null for a zero or negative extent, so no width="0" is ever written', () => {
    expect(intrinsicSizeFromViewBox('0 0 0 500')).toBeNull()
    expect(intrinsicSizeFromViewBox('0 0 940 0')).toBeNull()
    expect(intrinsicSizeFromViewBox('0 0 -940 500')).toBeNull()
  })
})

describe('intrinsicSvgSize', () => {
  // The regression: re-stating a pt viewBox as unitless numbers renders a
  // matplotlib figure at 75% of its authored physical size (1pt = 4/3 px).
  it('keeps the authored physical size when the file states one', () => {
    expect(
      intrinsicSvgSize('249.448819pt', '198.425197pt', '0 0 249.448819 198.425197')
    ).toEqual({ width: '249.448819pt', height: '198.425197pt' })
    expect(intrinsicSvgSize('180mm', '120mm', '0 0 180 120')).toEqual({
      width: '180mm',
      height: '120mm'
    })
    expect(intrinsicSvgSize('940', '500', '0 0 940 500')).toEqual({ width: '940', height: '500' })
  })

  it('falls back to the viewBox extent when the file has no usable size', () => {
    expect(intrinsicSvgSize(null, null, '0 0 940 500')).toEqual({ width: '940', height: '500' })
    // `%` is relative to a containing block, i.e. no intrinsic size at all.
    expect(intrinsicSvgSize('100%', '100%', '0 0 940 500')).toEqual({
      width: '940',
      height: '500'
    })
    // One axis alone cannot describe a size.
    expect(intrinsicSvgSize('940', null, '0 0 940 500')).toEqual({ width: '940', height: '500' })
  })

  it('returns null when nothing usable is on offer, so no attribute is written', () => {
    expect(intrinsicSvgSize(null, null, null)).toBeNull()
    expect(intrinsicSvgSize('100%', '100%', null)).toBeNull()
    expect(intrinsicSvgSize('0pt', '0pt', null)).toBeNull()
  })
})

describe('livePreview block decorations (headless state field)', () => {
  function blockDecorationRanges(state: EditorState): OffsetPair[] {
    const sets = state
      .facet(EditorView.decorations)
      .filter((value): value is DecorationSet => typeof value !== 'function')
    const ranges: OffsetPair[] = []
    for (const set of sets) {
      const cursor = set.iter()
      while (cursor.value !== null) {
        ranges.push({ from: cursor.from, to: cursor.to })
        cursor.next()
      }
    }
    return ranges
  }

  function countBlockDecorations(state: EditorState): number {
    return blockDecorationRanges(state).length
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

  it('replaces a table, and reveals its source while the cursor is inside it', () => {
    const doc = 'Intro.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n'
    const outside = EditorState.create({ doc, extensions: [livePreview()] })
    expect(countBlockDecorations(outside)).toBe(1)
    const inside = outside.update({
      selection: EditorSelection.cursor(doc.indexOf('| 1 |') + 2)
    }).state
    expect(countBlockDecorations(inside)).toBe(0)
    const left = inside.update({ selection: EditorSelection.cursor(0) }).state
    expect(countBlockDecorations(left)).toBe(1)
  })

  // The attribute block is hidden by the image's own block replacement, not by
  // a decoration of its own — so the range has to reach past the closing brace
  // or the braces would be left dangling under the rendered picture.
  it('replaces a width-attributed image over its attribute block too', () => {
    const doc = 'Intro.\n\n![a](p.png){width=50%}\n\nAfter.\n'
    const state = EditorState.create({ doc, extensions: [livePreview()] })
    expect(blockDecorationRanges(state)).toEqual([
      { from: doc.indexOf('!['), to: doc.indexOf('}') + 1 }
    ])
  })

  it('reveals the attribute block with the image source when the cursor enters it', () => {
    const doc = 'Intro.\n\n![a](p.png){width=50%}\n\nAfter.\n'
    const outside = EditorState.create({ doc, extensions: [livePreview()] })
    const inside = outside.update({ selection: EditorSelection.cursor(doc.indexOf('50%')) }).state
    expect(countBlockDecorations(inside)).toBe(0)
    const left = inside.update({ selection: EditorSelection.cursor(0) }).state
    expect(countBlockDecorations(left)).toBe(1)
  })

  it('renders table markdown to an HTML table through @suna/markdown', () => {
    const html = renderTableHtml('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('</table>')
  })

  // editor.css's cell default is `text-align: start`, deliberately weaker than
  // this inline style — if the renderer ever stopped emitting it, GFM column
  // alignment would silently vanish from reading mode with no other symptom.
  it('keeps the inline GFM column alignment the reading-mode table styling defers to', () => {
    const html = renderTableHtml('| a | b |\n| :--- | :---: |\n| 1 | 2 |')
    expect(html).toContain('style="text-align:center"')
    expect(html).toContain('style="text-align:left"')
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

/* ---------------------------------------------------------------------------
   Inline hide/reveal, driven directly against buildInlineDecorations() over a
   headless EditorState — this repo has no DOM test environment (jsdom is a
   packages/canvas-only dependency; see editor/keymap.test.ts), so these tests
   never touch a real EditorView or call a widget's toDOM(). Zero-width hides
   (headings, emphasis, links, blockquote/backtick markers) are asserted by
   reconstructing the *visible text* of a line from the decoration set —
   possible without DOM because an empty replace decoration contributes no
   text, exactly like it wouldn't in the real editor. Widget spans (the
   bullet glyph) are asserted structurally instead (a replace decoration with
   a widget at the expected range), since only DOM would reveal the glyph text.
   ------------------------------------------------------------------------- */

/**
 * `allowMultipleSelections` is opt-in per EditorState.create's own contract
 * (a multi-range selection silently collapses to its primary range without
 * it — see `checkSelection`/`asSingle()` in @codemirror/state); enabling it
 * unconditionally here just lets the multi-cursor test build a real
 * multi-range selection. It has no effect on any single-cursor test.
 */
function decoBuild(
  doc: string,
  selection: EditorSelection | SelectionRange
): { state: EditorState; deco: DecorationSet } {
  const sel = selection instanceof EditorSelection ? selection : EditorSelection.create([selection])
  const state = EditorState.create({
    doc,
    selection: sel,
    extensions: [EditorState.allowMultipleSelections.of(true), livePreview()]
  })
  return { state, deco: buildInlineDecorations(state, [{ from: 0, to: doc.length }]) }
}

interface OffsetPair {
  from: number
  to: number
}

/**
 * Reconstructs what a line would show with its REPLACING decorations
 * removed. Distinguishes a replace/widget decoration (hide, bullet, cite,
 * math, ...) from a pure style Decoration.mark (cm-lp-strong/em/code/link,
 * which stays *visible*, just styled) by spec shape rather than the
 * `.point` field CodeMirror keeps off its public Decoration type: this
 * module never gives a mark decoration a `widget`, and never gives a
 * replace decoration a `class` — a mark decoration is also never non-empty
 * without a `class`. Line decorations are zero-width in this module
 * (`Decoration.line(...).range(lineStart)`), so the `to <= from` guard
 * excludes them for free regardless of their own `class`.
 */
function visibleLineText(state: EditorState, deco: DecorationSet, lineNumber: number): string {
  const line = state.doc.line(lineNumber)
  const removed: OffsetPair[] = []
  deco.between(line.from, line.to, (from, to, value) => {
    if (to <= from) return
    const spec = value.spec as { class?: string; widget?: unknown }
    if (spec.widget === undefined && spec.class !== undefined) return
    removed.push({ from: Math.max(from, line.from), to: Math.min(to, line.to) })
  })
  removed.sort((a, b) => a.from - b.from)
  let result = ''
  let cursor = line.from
  for (const piece of removed) {
    result += state.doc.sliceString(cursor, piece.from)
    cursor = Math.max(cursor, piece.to)
  }
  result += state.doc.sliceString(cursor, line.to)
  return result
}

function widgetSpanAt(deco: DecorationSet, from: number, to: number): boolean {
  let found = false
  deco.between(from, to, (spanFrom, spanTo, value) => {
    const spec = value.spec as { widget?: unknown }
    if (spanFrom === from && spanTo === to && spec.widget !== undefined) found = true
  })
  return found
}

describe('buildInlineDecorations: hide + reveal', () => {
  it('hides the heading prefix, and reveals it while any cursor is on that line', () => {
    const doc = '## Results\n\nMore text.\n'
    const neutral = EditorSelection.cursor(doc.indexOf('More'))

    const hidden = decoBuild(doc, neutral)
    expect(visibleLineText(hidden.state, hidden.deco, 1)).toBe('Results')

    const revealed = decoBuild(doc, EditorSelection.cursor(doc.indexOf('Results')))
    expect(visibleLineText(revealed.state, revealed.deco, 1)).toBe('## Results')

    // clicking elsewhere on the same line still reveals it
    const revealedElsewhere = decoBuild(doc, EditorSelection.cursor(doc.indexOf('\n')))
    expect(visibleLineText(revealedElsewhere.state, revealedElsewhere.deco, 1)).toBe('## Results')

    // moving to a different line hides it again
    const away = decoBuild(doc, neutral)
    expect(visibleLineText(away.state, away.deco, 1)).toBe('Results')
  })

  it('hides a heading that is only "##" with no text, and reveals just the hashes', () => {
    const doc = '##\nBody.\n'
    const hidden = decoBuild(doc, EditorSelection.cursor(doc.indexOf('Body')))
    expect(visibleLineText(hidden.state, hidden.deco, 1)).toBe('')
    const revealed = decoBuild(doc, EditorSelection.cursor(1))
    expect(visibleLineText(revealed.state, revealed.deco, 1)).toBe('##')
  })

  it('renders nested emphasis inside strong with all delimiters hidden', () => {
    const doc = '**bold *and* more**\n\nElsewhere.\n'
    const { state, deco } = decoBuild(doc, EditorSelection.cursor(doc.indexOf('Elsewhere')))
    expect(visibleLineText(state, deco, 1)).toBe('bold and more')
  })

  it('reveals only the enclosing level a cursor sits inside for nested emphasis', () => {
    const doc = '**bold *and* more**\n'
    // cursor inside the nested emphasis: both ** and * reveal together
    const insideNested = decoBuild(doc, EditorSelection.cursor(doc.indexOf('and')))
    expect(visibleLineText(insideNested.state, insideNested.deco, 1)).toBe('**bold *and* more**')

    // cursor inside "bold", inside strong but outside the nested emphasis:
    // only the outer ** reveals, the inner * stays hidden
    const insideOuterOnly = decoBuild(doc, EditorSelection.cursor(doc.indexOf('bold')))
    expect(visibleLineText(insideOuterOnly.state, insideOuterOnly.deco, 1)).toBe('**bold and more**')
  })

  it('does not throw on an unclosed "**" at EOF, and leaves it as plain text', () => {
    const doc = 'This has **unclosed at eof'
    const cursor = EditorSelection.cursor(0)
    expect(() => decoBuild(doc, cursor)).not.toThrow()
    const { state, deco } = decoBuild(doc, cursor)
    expect(visibleLineText(state, deco, 1)).toBe(doc)
  })

  it('leaves "**" inside a code span untouched, hiding only the backticks', () => {
    const doc = 'Use `**not bold**` here.\n'
    const { state, deco } = decoBuild(doc, EditorSelection.cursor(0))
    expect(visibleLineText(state, deco, 1)).toBe('Use **not bold** here.')
  })

  it('leaves backslash-escaped emphasis markers untouched', () => {
    const doc = 'This is \\*not emphasis\\* here.\n'
    const { state, deco } = decoBuild(doc, EditorSelection.cursor(0))
    expect(visibleLineText(state, deco, 1)).toBe(doc.slice(0, doc.indexOf('\n')))
  })

  it("hides a link's brackets/parens/URL, and reveals the raw markdown on cursor entry", () => {
    const doc = 'See [my text](https://example.com/path) here.\n'
    const hidden = decoBuild(doc, EditorSelection.cursor(0))
    expect(visibleLineText(hidden.state, hidden.deco, 1)).toBe('See my text here.')

    const revealed = decoBuild(doc, EditorSelection.cursor(doc.indexOf('my text')))
    expect(visibleLineText(revealed.state, revealed.deco, 1)).toBe(
      'See [my text](https://example.com/path) here.'
    )
  })

  it("replaces a bullet line's marker with a widget decoration, and reveals raw text on the line", () => {
    const doc = '- one\n- two\n'
    const hidden = decoBuild(doc, EditorSelection.cursor(doc.indexOf('two')))
    expect(widgetSpanAt(hidden.deco, 0, doc.indexOf('one'))).toBe(true)
    expect(visibleLineText(hidden.state, hidden.deco, 1)).toBe('one')

    const revealed = decoBuild(doc, EditorSelection.cursor(doc.indexOf('one')))
    expect(widgetSpanAt(revealed.deco, 0, doc.indexOf('one'))).toBe(false)
    expect(visibleLineText(revealed.state, revealed.deco, 1)).toBe('- one')
  })

  it('hides a blockquote marker, and reveals the raw ">" on cursor entry', () => {
    const doc = '> quoted\n\nAfter.\n'
    const hidden = decoBuild(doc, EditorSelection.cursor(doc.indexOf('After')))
    expect(visibleLineText(hidden.state, hidden.deco, 1)).toBe('quoted')
    const revealed = decoBuild(doc, EditorSelection.cursor(doc.indexOf('quoted')))
    expect(visibleLineText(revealed.state, revealed.deco, 1)).toBe('> quoted')
  })

  it('reveals independently for multiple cursors, one per node, leaving untouched nodes hidden', () => {
    const doc = '## First\n\n## Second\n\n## Third\n'
    const firstAt = doc.indexOf('First')
    const thirdAt = doc.indexOf('Third')
    const multi = decoBuild(
      doc,
      EditorSelection.create([EditorSelection.cursor(firstAt), EditorSelection.cursor(thirdAt)])
    )
    expect(visibleLineText(multi.state, multi.deco, 1)).toBe('## First')
    expect(visibleLineText(multi.state, multi.deco, 3)).toBe('Second')
    expect(visibleLineText(multi.state, multi.deco, 5)).toBe('## Third')
  })
})

describe('buildInlineDecorations: line-break safety', () => {
  it('drops an inline replace span that crosses a line break', () => {
    // remark-math reads `$x\ny$` as a single inlineMath node, so an ordinary
    // paragraph can produce an inline span across a newline. A plugin may not
    // supply a replace decoration over a line break — CodeMirror throws
    // "Decorations that replace line breaks may not be specified via plugins"
    // and the editor renders empty, losing the whole document view.
    const doc = '# T\n\npara\n\n$\nE = mc^2\n$\n\nmore\n'
    const { inline } = extractSpans(doc)
    expect(inline.some((span) => span.kind === 'inlineMath')).toBe(true)

    const { state, deco } = decoBuild(doc, EditorSelection.cursor(0))
    let crossing = 0
    deco.between(0, doc.length, (from, to, value) => {
      if (to <= from) return
      const spec = value.spec as { class?: string; widget?: unknown }
      if (spec.widget === undefined && spec.class !== undefined) return
      if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number) crossing += 1
    })
    expect(crossing).toBe(0)
  })
})
