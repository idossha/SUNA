import { describe, expect, it } from 'vitest'
import type { ReviewPointRecord, ReviewerReport, Round } from '@suna/core'
import {
  MAX_SIBLINGS,
  pointLabelFor,
  pointReplyContext,
  reportWindow,
  siblingReplies
} from './replyContext'

function point(over: Partial<ReviewPointRecord> = {}): ReviewPointRecord {
  return {
    id: 'p1',
    reviewerIndex: 1,
    pointIndex: 1,
    section: null,
    verbatim: 'The stimulation montage is underspecified.',
    from: 0,
    to: 41,
    reason: 'numbered',
    ...over
  }
}

function report(points: ReviewPointRecord[], sourceText: string): ReviewerReport {
  return { schemaVersion: 1, index: 1, label: 'Reviewer 1', sourceText, points, unassigned: [] }
}

function round(over: Partial<Round> = {}): Round {
  return {
    schemaVersion: 1,
    id: 'r2',
    kind: 'external',
    label: 'Round 2 — Nature Neuroscience',
    venue: 'Nature Neuroscience',
    state: 'returned',
    createdAt: '2026-01-01T00:00:00.000Z',
    freeze: null,
    recipients: [],
    pointStates: [],
    decision: 'major-revision',
    decidedAt: null,
    responseDocumentId: null,
    ...over
  }
}

describe('reportWindow', () => {
  it('carries the reviewer text around the point, marking both elisions', () => {
    const before = 'a'.repeat(900)
    const after = 'b'.repeat(900)
    const p = point({ from: before.length, to: before.length + 5 })
    const source = `${before}POINT${after}`
    const win = reportWindow(report([p], source), p)
    expect(win.startsWith('…')).toBe(true)
    expect(win.endsWith('…')).toBe(true)
    expect(win).toContain('POINT')
  })

  it('is empty when the report is the point and nothing else — no context to add', () => {
    const p = point({ from: 0, to: 41 })
    expect(reportWindow(report([p], p.verbatim), p)).toBe('')
  })

  it('is empty rather than throwing when the point has no report', () => {
    expect(reportWindow(undefined, point())).toBe('')
  })
})

describe('siblingReplies', () => {
  const points = [
    point({ id: 'a', pointIndex: 1 }),
    point({ id: 'b', pointIndex: 2 }),
    point({ id: 'c', pointIndex: 3 }),
    point({ id: 'd', reviewerIndex: 2, pointIndex: 1 })
  ]
  const reports = [report(points.slice(0, 3), 'x'), { ...report([points[3]!], 'y'), index: 2 }]

  it('sends only points that have actually been answered', () => {
    const r = round({
      pointStates: [
        { pointId: 'a', status: 'done', assignee: null, reply: 'We added it.', links: [] },
        { pointId: 'c', status: 'unaddressed', assignee: null, reply: '   ', links: [] }
      ]
    })
    const siblings = siblingReplies(r, reports, points[1]!)
    expect(siblings.map((s) => s.label)).toEqual(['Reviewer 1, point 1'])
  })

  it('never includes the point being answered', () => {
    const r = round({
      pointStates: [{ pointId: 'b', status: 'done', assignee: null, reply: 'mine', links: [] }]
    })
    expect(siblingReplies(r, reports, points[1]!)).toEqual([])
  })

  it('puts the same reviewer’s nearest points first, other reviewers last', () => {
    const r = round({
      pointStates: [
        { pointId: 'a', status: 'done', assignee: null, reply: 'one', links: [] },
        { pointId: 'd', status: 'done', assignee: null, reply: 'other reviewer', links: [] }
      ]
    })
    const siblings = siblingReplies(r, reports, points[1]!)
    expect(siblings.map((s) => s.label)).toEqual(['Reviewer 1, point 1', 'Reviewer 2, point 1'])
  })

  it('caps the list so a sixty-point round cannot crowd out the manuscript', () => {
    const many = Array.from({ length: 30 }, (_, i) => point({ id: `m${i}`, pointIndex: i + 2 }))
    const r = round({
      pointStates: many.map((p) => ({
        pointId: p.id,
        status: 'done' as const,
        assignee: null,
        reply: 'answered',
        links: []
      }))
    })
    expect(siblingReplies(r, [report(many, 'z')], points[0]!)).toHaveLength(MAX_SIBLINGS)
  })
})

describe('pointReplyContext', () => {
  it('carries the round’s venue and decision, and leaves currentReply to the live box', () => {
    const p = points0()
    const ctx = pointReplyContext(
      { rootDir: '/proj', round: round(), reports: [report([p], p.verbatim)], report: report([p], p.verbatim), guidelines: '# Answering\n- be brief', onGuidelinesApproved: () => undefined },
      p
    )
    expect(ctx.venue).toBe('Nature Neuroscience')
    expect(ctx.decision).toBe('major-revision')
    expect(ctx.pointLabel).toBe(pointLabelFor(p))
    expect(ctx.peerReviewGuidelines).toContain('be brief')
    // The tab reads PEER-REVIEW.md; the assistant supplies the unsaved keystrokes.
    expect(ctx.currentReply).toBe('')
  })
})

function points0(): ReviewPointRecord {
  return point()
}
