import { describe, expect, it } from 'vitest'
import { planSync, sameQuads, type DesiredHighlight, type FileAnnotation } from './embedHighlights'
import type { HighlightRect } from './pdfGeometry'

/**
 * The reconcile that keeps a PDF's own annotations in step with the sidecar
 * (ARCHITECTURE §14.4). Identity is geometry, resolved fresh every run — the property
 * that makes a foreign edit a non-event rather than a lockout.
 */

const rect = (top: number): HighlightRect => ({ left: 100, top, width: 200, height: 14 })

const want = (
  noteId: string,
  top: number,
  color = 'rgb(255, 212, 0)',
  contents = '',
  embed?: number[]
): DesiredHighlight => ({
  noteId,
  page: 1,
  rects: [rect(top)],
  color,
  contents,
  ...(embed === undefined ? {} : { embed })
})

/** User-space quads standing in for the screen rect at `top`. */
const quadsAt = (top: number): number[] => [100, 800 - top, 300, 800 - top, 100, 786 - top, 300, 786 - top]

const inFile = (
  id: string,
  top: number,
  color: string | null = 'rgb(255, 212, 0)',
  contents: string | null = null
): FileAnnotation => ({ id, page: 1, rects: [rect(top)], quads: quadsAt(top), color, contents })

describe('planSync', () => {
  it('creates an annotation for a note the file does not have', () => {
    const plan = planSync([want('n1', 100)], [])
    expect(plan.create).toHaveLength(1)
    expect(plan.remove).toEqual([])
  })

  it('does nothing when the file already says the right thing', () => {
    const plan = planSync([want('n1', 100)], [inFile('10R', 100)])
    expect(plan.create).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.unchanged).toBe(1)
  })

  it('is idempotent — running it again after a sync is still a no-op', () => {
    const desired = [want('n1', 100), want('n2', 140)]
    const file = [inFile('10R', 100), inFile('11R', 140)]
    expect(planSync(desired, file)).toEqual(planSync(desired, file))
    expect(planSync(desired, file).create).toEqual([])
  })

  it('replaces rather than edits when a note is recoloured', () => {
    // pdf.js can add and remove but not modify in place (#18407).
    // The note carries its recorded location, the normal state after its first
    // sync — that is what authorises replacing the annotation rather than
    // leaving a stranger's alone.
    const plan = planSync(
      [want('n1', 100, 'rgb(95, 178, 54)', '', quadsAt(100))],
      [inFile('10R', 100)]
    )
    expect(plan.remove.map((a) => a.id)).toEqual(['10R'])
    expect(plan.create).toHaveLength(1)
  })

  it('replaces when a note body changed, so /Contents follows', () => {
    const plan = planSync(
      [want('n1', 100, 'rgb(255, 212, 0)', 'new note', quadsAt(100))],
      [inFile('10R', 100)]
    )
    expect(plan.remove.map((a) => a.id)).toEqual(['10R'])
    expect(plan.create).toHaveLength(1)
  })

  it('treats a null /Contents and an empty body as the same thing', () => {
    const plan = planSync([want('n1', 100)], [inFile('10R', 100, 'rgb(255, 212, 0)', null)])
    expect(plan.unchanged).toBe(1)
    expect(plan.remove).toEqual([])
  })

  describe('what belongs to somebody else', () => {
    it('never touches an annotation no note claims', () => {
      // A highlight made in Preview or Zotero. This is the whole safety
      // property: an unclaimed annotation is a stranger's work.
      const plan = planSync([want('n1', 100)], [inFile('10R', 100), inFile('99R', 500)])
      expect(plan.remove).toEqual([])
      expect(plan.create).toEqual([])
    })

    it('removes an unclaimed annotation ONLY where the caller names the region', () => {
      const plan = planSync([], [inFile('99R', 500)], [{ page: 1, quads: quadsAt(500) }])
      expect(plan.remove.map((a) => a.id)).toEqual(['99R'])
    })

    it('leaves other pages alone when a removal names one page', () => {
      const otherPage: FileAnnotation = { ...inFile('88R', 500), page: 2 }
      const plan = planSync([], [inFile('99R', 500), otherPage], [{ page: 1, quads: quadsAt(500) }])
      expect(plan.remove.map((a) => a.id)).toEqual(['99R'])
    })

    it('does not remove a region a live note still claims', () => {
      // A stale removal must not take out a note that was re-made in the
      // same place before the reconcile ran.
      const plan = planSync([want('n1', 100)], [inFile('10R', 100)], [{ page: 1, quads: quadsAt(100) }])
      expect(plan.remove).toEqual([])
      expect(plan.unchanged).toBe(1)
    })
  })

  it('matches on any overlapping rectangle, not on exact equality', () => {
    const shifted: FileAnnotation = {
      ...inFile('10R', 100),
      rects: [{ left: 101, top: 101, width: 200, height: 14 }]
    }
    expect(planSync([want('n1', 100)], [shifted]).unchanged).toBe(1)
  })

  it('does not let one annotation satisfy two notes', () => {
    const plan = planSync([want('n1', 100), want('n2', 100)], [inFile('10R', 100)])
    expect(plan.unchanged).toBe(1)
    expect(plan.create).toHaveLength(1)
  })

  it('is page-scoped', () => {
    const onPageTwo: FileAnnotation = { ...inFile('10R', 100), page: 2 }
    expect(planSync([want('n1', 100)], [onPageTwo]).create).toHaveLength(1)
  })

  it('reports where each matched note lives, so removal never needs the DOM', () => {
    const plan = planSync([want('n1', 100)], [inFile('10R', 100)])
    expect(plan.located).toEqual([{ noteId: 'n1', page: 1, quads: quadsAt(100) }])
  })

  describe('removal without the page on screen', () => {
    it('matches a removal by user-space quads alone', () => {
      // The bug this fixes: the rail lists notes on every page, so removing one
      // whose page is scrolled out of view has NO screen rectangle to compare.
      // Matching on quads means a page nobody is looking at is no different.
      const plan = planSync([], [inFile('99R', 500)], [{ page: 1, quads: quadsAt(500) }])
      expect(plan.remove.map((a) => a.id)).toEqual(['99R'])
    })

    it('tolerates a hair of drift in the recorded quads', () => {
      const drifted = quadsAt(500).map((n, i) => (i % 2 === 0 ? n + 0.4 : n - 0.4))
      expect(planSync([], [inFile('99R', 500)], [{ page: 1, quads: drifted }]).remove).toHaveLength(1)
    })

    it('does not remove an annotation somewhere else on the page', () => {
      expect(planSync([], [inFile('99R', 500)], [{ page: 1, quads: quadsAt(120) }]).remove).toEqual([])
    })

    it('ignores a removal with no recorded quads rather than guessing', () => {
      expect(planSync([], [inFile('99R', 500)], [{ page: 1, quads: [] }]).remove).toEqual([])
    })
  })

  it('is empty for nothing wanted and nothing present', () => {
    expect(planSync([], [])).toEqual({
      create: [],
      remove: [],
      unchanged: 0,
      located: [],
      unmatchedRemovals: []
    })
  })
})

describe('sameQuads', () => {
  const q = [100, 700, 300, 700, 100, 686, 300, 686]

  it('matches the same region', () => {
    expect(sameQuads(q, [...q])).toBe(true)
  })

  it('matches whatever order the corners were written in', () => {
    // Producers do not agree on corner order; the box is the box.
    expect(sameQuads(q, [300, 686, 100, 700, 300, 700, 100, 686])).toBe(true)
  })

  it('tolerates sub-pixel drift but not a real move', () => {
    expect(sameQuads(q, q.map((n) => n + 0.5))).toBe(true)
    expect(sameQuads(q, q.map((n) => n + 20))).toBe(false)
  })

  it('never matches an empty run — an unrecorded note is not "everywhere"', () => {
    expect(sameQuads([], q)).toBe(false)
    expect(sameQuads(q, [])).toBe(false)
  })
})

/**
 * Regressions from the robustness audit. Each names the way the paradigm broke
 * before it was pinned; several were reproduced by executing `planSync`.
 */
describe('planSync — audit regressions', () => {
  const rect2 = (top: number, height = 14): HighlightRect => ({ left: 100, top, width: 200, height })
  const qAt = (top: number): number[] => [100, 800 - top, 300, 800 - top, 100, 786 - top, 300, 786 - top]
  const ann = (
    id: string,
    top: number,
    color = 'rgb(255, 212, 0)',
    contents: string | null = null
  ): FileAnnotation => ({ id, page: 1, rects: [rect2(top)], quads: qAt(top), color, contents })

  it('a surviving note does not claim a deleted neighbour annotation', () => {
    // Highlight a phrase, then a longer passage containing it, then delete the
    // phrase. The survivor used to claim the phrase's annotation by overlap,
    // so the removal matched nothing and the highlight stayed in the PDF —
    // and the survivor recorded the WRONG location for its own next removal.
    const phrase = ann('annPhrase', 120)
    const para = ann('annPara', 100)
    const survivor = { ...want('para', 100), embed: qAt(100) }
    const plan = planSync([survivor], [phrase, para], [{ page: 1, quads: qAt(120) }])
    expect(plan.remove.map((a) => a.id)).toEqual(['annPhrase'])
    expect(plan.unmatchedRemovals).toEqual([])
    expect(plan.located).toEqual([{ noteId: 'para', page: 1, quads: qAt(100) }])
  })

  it('never claims — or deletes — an annotation that disagrees with the note', () => {
    // Somebody highlighted this passage in Preview and wrote on it. Ours goes
    // in beside theirs; theirs is not touched.
    const theirs = ann('preview', 100, 'rgb(46, 168, 229)', 'their note')
    const plan = planSync([want('n1', 100)], [theirs])
    expect(plan.remove).toEqual([])
    expect(plan.create).toHaveLength(1)
  })

  it('does not claim a merely adjacent foreign annotation', () => {
    const nearby = ann('foreign', 115, 'rgb(46, 168, 229)', 'theirs')
    expect(planSync([want('n1', 100)], [nearby]).remove).toEqual([])
  })

  it('removes exactly one annotation per named region', () => {
    // The same sentence highlighted in both SUNA and Preview yields two
    // annotations over the same quads; removing ours must not take theirs.
    const ours = ann('a1', 100)
    const theirs = ann('a2', 100, 'rgb(46, 168, 229)', 'preview note')
    const plan = planSync([], [ours, theirs], [{ page: 1, quads: qAt(100) }])
    expect(plan.remove).toHaveLength(1)
  })

  it('reports a removal it could not match instead of reporting success', () => {
    const plan = planSync([], [ann('a1', 100)], [{ page: 1, quads: qAt(500) }])
    expect(plan.remove).toEqual([])
    expect(plan.unmatchedRemovals).toEqual([{ page: 1, quads: qAt(500) }])
  })

  it('recreates a recorded note whose annotation has vanished from the file', () => {
    // Another application rewrote the paper and dropped it. The note is still
    // the user's, so it goes back in rather than being silently unrepresented.
    const plan = planSync([{ ...want('n1', 100), embed: qAt(100) }], [])
    expect(plan.create).toHaveLength(1)
  })

  it('an unrecorded note adopts an annotation that already says the same thing', () => {
    // The backfill path for sidecars written before locations were recorded:
    // this must NOT duplicate the annotation on every reopen.
    const plan = planSync([want('n1', 100)], [ann('a1', 100)])
    expect(plan.create).toEqual([])
    expect(plan.unchanged).toBe(1)
  })
})

describe('sameQuads — audit regressions', () => {
  it('does not confuse a two-line run with a block covering the same box', () => {
    // An L-shaped run over two lines has the same OUTER box as a solid block
    // spanning both lines and the gap; comparing outer boxes said they were
    // the same annotation.
    const twoLines = [72, 700, 272, 700, 72, 688, 272, 688, 72, 688, 150, 688, 72, 676, 150, 676]
    const block = [72, 700, 272, 700, 72, 676, 272, 676]
    expect(sameQuads(twoLines, block)).toBe(false)
  })

  it('still matches the same two-line run', () => {
    const run = [72, 700, 272, 700, 72, 688, 272, 688, 72, 688, 150, 688, 72, 676, 150, 676]
    expect(sameQuads(run, [...run])).toBe(true)
  })

  it('matches when the file reordered the quads', () => {
    const a = [72, 700, 272, 700, 72, 688, 272, 688, 72, 688, 150, 688, 72, 676, 150, 676]
    const b = [72, 688, 150, 688, 72, 676, 150, 676, 72, 700, 272, 700, 72, 688, 272, 688]
    expect(sameQuads(a, b)).toBe(true)
  })
})
