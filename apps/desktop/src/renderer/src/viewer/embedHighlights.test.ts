import { describe, expect, it } from 'vitest'
import { planSync, type DesiredHighlight, type FileAnnotation } from './embedHighlights'
import type { HighlightRect } from './pdfGeometry'

/**
 * The reconcile that keeps a PDF's own annotations in step with the sidecar
 * (ADR-008). Identity is geometry, resolved fresh every run — the property
 * that makes a foreign edit a non-event rather than a lockout.
 */

const rect = (top: number): HighlightRect => ({ left: 100, top, width: 200, height: 14 })

const want = (
  noteId: string,
  top: number,
  color = 'rgb(255, 212, 0)',
  contents = ''
): DesiredHighlight => ({ noteId, page: 1, rects: [rect(top)], color, contents })

const inFile = (
  id: string,
  top: number,
  color: string | null = 'rgb(255, 212, 0)',
  contents: string | null = null
): FileAnnotation => ({ id, page: 1, rects: [rect(top)], color, contents })

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
    const plan = planSync([want('n1', 100, 'rgb(95, 178, 54)')], [inFile('10R', 100)])
    expect(plan.remove.map((a) => a.id)).toEqual(['10R'])
    expect(plan.create).toHaveLength(1)
  })

  it('replaces when a note body changed, so /Contents follows', () => {
    const plan = planSync([want('n1', 100, 'rgb(255, 212, 0)', 'new note')], [inFile('10R', 100)])
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
      const plan = planSync([], [inFile('99R', 500)], [{ page: 1, rects: [rect(500)] }])
      expect(plan.remove.map((a) => a.id)).toEqual(['99R'])
    })

    it('leaves other pages alone when a removal names one page', () => {
      const otherPage: FileAnnotation = { ...inFile('88R', 500), page: 2 }
      const plan = planSync([], [inFile('99R', 500), otherPage], [{ page: 1, rects: [rect(500)] }])
      expect(plan.remove.map((a) => a.id)).toEqual(['99R'])
    })

    it('does not remove a region a live note still claims', () => {
      // A stale removal must not take out a note that was re-made in the
      // same place before the reconcile ran.
      const plan = planSync([want('n1', 100)], [inFile('10R', 100)], [{ page: 1, rects: [rect(100)] }])
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

  it('is empty for nothing wanted and nothing present', () => {
    expect(planSync([], [])).toEqual({ create: [], remove: [], unchanged: 0 })
  })
})
