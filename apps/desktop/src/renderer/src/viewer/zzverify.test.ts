import { describe, expect, it } from 'vitest'
import { planSync, sameQuads, annotationsForNote, type DesiredHighlight, type FileAnnotation } from './embedHighlights'
import type { PdfNote } from '@suna/core'

const R = (left: number, top: number, width: number, height: number) => ({ left, top, width, height })

function want(noteId: string, page: number, rects: ReturnType<typeof R>[], color = 'rgb(255, 212, 0)', contents = ''): DesiredHighlight {
  return { noteId, page, rects, color, contents }
}
function ann(id: string, page: number, rects: ReturnType<typeof R>[], quads: number[], color = 'rgb(255, 212, 0)', contents: string | null = null): FileAnnotation {
  return { id, page, rects, quads, color, contents }
}

describe('F1 adjacent-line mis-claim', () => {
  it('shows the mis-claim', () => {
    const A = R(100, 100, 200, 14)   // line N  (bottom 114)
    const B = R(100, 115, 150, 14)   // line N+1 (top 115, gap 1px)
    const qA = [72, 700, 272, 700, 72, 688, 272, 688]
    const qB = [72, 688, 222, 688, 72, 676, 222, 676]
    const plan = planSync([want('B', 1, [B])], [ann('annA', 1, [A], qA), ann('annB', 1, [B], qB)], [{ page: 1, quads: qA }])
    console.log('F1 remove ids =', JSON.stringify(plan.remove.map((a) => a.id)))
    console.log('F1 located    =', JSON.stringify(plan.located))
    console.log('F1 create     =', JSON.stringify(plan.create.map((c) => c.noteId)))
    console.log('F1 unchanged  =', plan.unchanged)
    expect(true).toBe(true)
  })
  it('gap of 3px does not mis-claim', () => {
    const A = R(100, 100, 200, 14)
    const B = R(100, 117, 150, 14)
    const qA = [72, 700, 272, 700, 72, 688, 272, 688]
    const qB = [72, 688, 222, 688, 72, 676, 222, 676]
    const plan = planSync([want('B', 1, [B])], [ann('annA', 1, [A], qA), ann('annB', 1, [B], qB)], [{ page: 1, quads: qA }])
    console.log('F1b remove ids =', JSON.stringify(plan.remove.map((a) => a.id)), 'located', JSON.stringify(plan.located))
  })
})

describe('F2 sameQuads bbox + no break', () => {
  it('bbox equality', () => {
    const twoLine = [72, 700, 272, 700, 72, 688, 272, 688, 72, 688, 150, 688, 72, 676, 150, 676]
    const oneBox = [72, 700, 272, 700, 72, 676, 272, 676]
    console.log('F2 sameQuads(twoLine, oneBox) =', sameQuads(twoLine, oneBox))
    const plan = planSync([], [ann('ours', 1, [R(0, 0, 10, 10)], twoLine), ann('preview', 1, [R(0, 0, 10, 10)], oneBox)], [{ page: 1, quads: twoLine }])
    console.log('F2 remove ids =', JSON.stringify(plan.remove.map((a) => a.id)))
  })
})

describe('F7 moved note', () => {
  it('leaves the old annotation', () => {
    const plan = planSync([want('n1', 1, [R(100, 400, 200, 14)])], [ann('10R', 1, [R(100, 100, 200, 14)], [72, 700, 272, 700, 72, 688, 272, 688])])
    console.log('F7 create=', plan.create.length, 'remove=', JSON.stringify(plan.remove.map((a) => a.id)))
  })
})

describe('F10 degenerate creates', () => {
  it('annotationsForNote returns nothing', () => {
    const note = { id: 'n', color: 'yellow', runs: [], body: '', tags: [], author: { kind: 'human', name: 'me' }, createdAt: '', updatedAt: '', ambiguous: false, embed: [] } as unknown as PdfNote
    const viewport = {
      convertToPdfPoint: (x: number, y: number) => [x * 0.001, 100 - y * 0.001],
      convertToViewportPoint: (x: number, y: number) => [x, y]
    }
    const specs = annotationsForNote(note, new Map([[1, [R(10, 10, 0.6, 0.6)]]]), new Map([[1, viewport as never]]), 'me')
    console.log('F10 specs =', JSON.stringify(specs))
  })
})
