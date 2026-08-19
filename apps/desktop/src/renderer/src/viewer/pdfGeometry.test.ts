import { describe, expect, it } from 'vitest'
import {
  foreignOnly,
  highlightRectsFromAnnotations,
  noteAtPoint,
  overlaps,
  type ForeignHighlight,
  type HighlightRect
} from './pdfGeometry'

/**
 * The pure half of PDF highlight geometry. `rectsForOffsets` needs a live text
 * layer and is measured by the drive probes instead.
 */

const rect = (left: number, top: number, width = 100, height = 14): HighlightRect => ({
  left,
  top,
  width,
  height
})

/** A viewport at scale 1 on a 612x792 page: PDF y grows up, viewport y down. */
const viewport = {
  convertToViewportPoint: (x: number, y: number): number[] => [x, 792 - y]
}

describe('noteAtPoint', () => {
  const byNote = new Map<string, Map<number, HighlightRect[]>>([
    ['n-a', new Map([[1, [rect(10, 10), rect(10, 30)]]])],
    ['n-b', new Map([[1, [rect(200, 10)]], [2, [rect(10, 10)]]])]
  ])

  it('finds the note under a point', () => {
    expect(noteAtPoint(byNote, 1, 50, 15)?.noteId).toBe('n-a')
    expect(noteAtPoint(byNote, 1, 250, 15)?.noteId).toBe('n-b')
  })

  it('returns the rectangle it hit, so the popover can be placed on it', () => {
    expect(noteAtPoint(byNote, 1, 50, 35)?.rect).toEqual(rect(10, 30))
  })

  it('is page-scoped — the same coordinates on another page are another note', () => {
    expect(noteAtPoint(byNote, 2, 50, 15)?.noteId).toBe('n-b')
  })

  it('misses cleanly between and outside highlights', () => {
    expect(noteAtPoint(byNote, 1, 150, 15)).toBeNull()
    expect(noteAtPoint(byNote, 1, 50, 200)).toBeNull()
    expect(noteAtPoint(byNote, 3, 50, 15)).toBeNull()
  })

  it('prefers the later note where two overlap', () => {
    const stacked = new Map<string, Map<number, HighlightRect[]>>([
      ['under', new Map([[1, [rect(0, 0, 200, 20)]]])],
      ['over', new Map([[1, [rect(0, 0, 200, 20)]]])]
    ])
    expect(noteAtPoint(stacked, 1, 100, 10)?.noteId).toBe('over')
  })

  it('is empty for no notes', () => {
    expect(noteAtPoint(new Map(), 1, 10, 10)).toBeNull()
  })
})

describe('highlightRectsFromAnnotations', () => {
  const quad = (x0: number, y0: number, x1: number, y1: number): number[] =>
    // spec order: upper-left, upper-right, lower-left, lower-right
    [x0, y1, x1, y1, x0, y0, x1, y0]

  it('carries each annotation own ref, since several can share every other field', () => {
    const found = highlightRectsFromAnnotations(
      [
        { id: '10R', subtype: 'Highlight', quadPoints: quad(100, 700, 300, 720) },
        { id: '11R', subtype: 'Highlight', quadPoints: quad(100, 600, 300, 620) }
      ],
      viewport
    )
    expect(found.map((f) => f.id)).toEqual(['10R', '11R'])
  })

  it('maps QuadPoints through the viewport, flipping the y axis', () => {
    const [found] = highlightRectsFromAnnotations(
      [{ subtype: 'Highlight', quadPoints: quad(100, 700, 300, 720), color: [255, 102, 102] }],
      viewport
    )
    expect(found!.rects).toEqual([{ left: 100, top: 72, width: 200, height: 20 }])
    expect(found!.color).toBe('rgb(255, 102, 102)')
  })

  it('emits one rectangle per quad, so a multi-line highlight stays multi-line', () => {
    const [found] = highlightRectsFromAnnotations(
      [{ subtype: 'Highlight', quadPoints: [...quad(100, 700, 300, 720), ...quad(100, 670, 250, 690)] }],
      viewport
    )
    expect(found!.rects).toHaveLength(2)
  })

  it('takes the extremes rather than trusting corner order', () => {
    // Not every producer writes the corners in spec order; the box is the box.
    const scrambled = [300, 700, 100, 720, 300, 720, 100, 700]
    const [found] = highlightRectsFromAnnotations(
      [{ subtype: 'Highlight', quadPoints: scrambled }],
      viewport
    )
    expect(found!.rects).toEqual([{ left: 100, top: 72, width: 200, height: 20 }])
  })

  it('carries the note text and author other apps attached', () => {
    const [found] = highlightRectsFromAnnotations(
      [
        {
          subtype: 'Highlight',
          quadPoints: quad(100, 700, 300, 720),
          contentsObj: { str: '  made outside SUNA  ' },
          titleObj: { str: 'Ada' }
        }
      ],
      viewport
    )
    expect(found!.contents).toBe('made outside SUNA')
    expect(found!.author).toBe('Ada')
  })

  it('ignores annotations that are not highlights, and degenerate quads', () => {
    expect(
      highlightRectsFromAnnotations(
        [
          { subtype: 'Link', quadPoints: quad(100, 700, 300, 720) },
          { subtype: 'Highlight', quadPoints: null },
          { subtype: 'Highlight', quadPoints: quad(100, 700, 100, 700) }
        ],
        viewport
      )
    ).toEqual([])
  })

  it('reports a null colour rather than inventing one', () => {
    const [found] = highlightRectsFromAnnotations(
      [{ subtype: 'Highlight', quadPoints: quad(100, 700, 300, 720) }],
      viewport
    )
    expect(found!.color).toBeNull()
  })
})

describe('foreignOnly', () => {
  const make = (rects: HighlightRect[]): ForeignHighlight => ({
    id: '0R',
    quads: [],
    rects,
    color: null,
    contents: null,
    author: null
  })

  it('drops the file annotation that is our own note, found by geometry', () => {
    // After an embed the PDF carries our highlights too; reading them back
    // without this would paint everything twice.
    const found = [make([rect(10, 10)])]
    expect(foreignOnly(found, [rect(10, 10)])).toEqual([])
  })

  it('keeps a highlight made somewhere else on the page', () => {
    const found = [make([rect(10, 400)])]
    expect(foreignOnly(found, [rect(10, 10)])).toHaveLength(1)
  })

  it('keeps everything when we have painted nothing', () => {
    const found = [make([rect(10, 10)]), make([rect(10, 40)])]
    expect(foreignOnly(found, [])).toHaveLength(2)
  })

  it('drops a multi-rect annotation when any part of it is ours', () => {
    const found = [make([rect(10, 400), rect(10, 10)])]
    expect(foreignOnly(found, [rect(10, 10)])).toEqual([])
  })
})

describe('overlaps', () => {
  it('is true for touching boxes, within the slack', () => {
    expect(overlaps(rect(0, 0, 10, 10), rect(11, 0, 10, 10))).toBe(true)
  })

  it('is false for clearly separate boxes', () => {
    expect(overlaps(rect(0, 0, 10, 10), rect(40, 0, 10, 10))).toBe(false)
    expect(overlaps(rect(0, 0, 10, 10), rect(0, 40, 10, 10))).toBe(false)
  })
})
