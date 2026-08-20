import { describe, expect, it, vi } from 'vitest'
import type { ReviewerReport, Round } from '@suna/core'
import {
  buildResponseHtml,
  responseSections,
  responseSubtitle,
  unaddressedLabels
} from './export-response'

/** Same reason as export-letter.test: no BrowserWindow, no printed PDF. */
vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: () => '/tmp' }
}))

function report(overrides: Partial<ReviewerReport> = {}): ReviewerReport {
  return {
    schemaVersion: 1,
    index: 2,
    label: 'Reviewer 2',
    sourceText: 'The analysis in Fig. 3 pools cells across animals.\nA second thing.',
    points: [
      {
        id: 'r2.1',
        reviewerIndex: 2,
        pointIndex: 1,
        section: null,
        verbatim: 'The analysis in Fig. 3 pools cells across animals.',
        from: 0,
        to: 49,
        reason: 'numbered'
      },
      {
        id: 'r2.2',
        reviewerIndex: 2,
        pointIndex: 2,
        section: 'Methods',
        verbatim: 'A second thing.',
        from: 50,
        to: 65,
        reason: 'numbered'
      }
    ],
    unassigned: [],
    ...overrides
  }
}

function round(overrides: Partial<Round> = {}): Round {
  return {
    schemaVersion: 1,
    id: 'r2-nature-astronomy',
    kind: 'external',
    label: 'Round 2 — Nature Astronomy',
    venue: 'Nature Astronomy',
    state: 'returned',
    createdAt: '2026-01-02T00:00:00.000Z',
    freeze: null,
    recipients: [],
    pointStates: [
      { pointId: 'r2.1', status: 'done', assignee: null, reply: 'We agree, and have refit.', links: [] }
    ],
    decision: null,
    decidedAt: null,
    responseDocumentId: null,
    ...overrides
  }
}

describe('responseSections', () => {
  it('pairs each point with the reply written against it', () => {
    const [section] = responseSections(round(), [report()])
    expect(section?.label).toBe('Reviewer 2')
    expect(section?.points[0]?.heading).toBe('Reviewer 2, point 1')
    expect(section?.points[0]?.reply[0]?.text).toBe('We agree, and have refit.')
  })

  it('names the reviewer’s own section when the point carries one', () => {
    const [section] = responseSections(round(), [report()])
    expect(section?.points[1]?.heading).toBe('Reviewer 2, point 2 · Methods')
  })

  it('writes nothing where the author has written nothing', () => {
    const [section] = responseSections(round(), [report()])
    expect(section?.points[1]?.reply).toEqual([])
  })

  it('quotes the reviewer’s words exactly as received', () => {
    const [section] = responseSections(round(), [report()])
    expect(section?.points[0]?.verbatim).toBe(report().points[0]?.verbatim)
  })
})

describe('unaddressedLabels', () => {
  it('names each point rather than counting them', () => {
    expect(unaddressedLabels(round(), [report()])).toEqual(['Reviewer 2, point 2'])
  })

  it('counts a rebuttal as answered — disagreeing in writing is answering', () => {
    const r = round({
      pointStates: [
        { pointId: 'r2.1', status: 'done', assignee: null, reply: 'Refit.', links: [] },
        { pointId: 'r2.2', status: 'rebutted', assignee: null, reply: 'We disagree because…', links: [] }
      ]
    })
    expect(unaddressedLabels(r, [report()])).toEqual([])
  })
})

describe('buildResponseHtml', () => {
  const html = (): string =>
    buildResponseHtml('Response to reviewers — Round 2', 'External review', responseSections(round(), [report()]))

  it('sets the reviewer’s words apart from ours', () => {
    expect(html()).toContain('<blockquote class="rx-verbatim">The analysis in Fig. 3')
    expect(html()).toContain('<p class="rx-body">We agree, and have refit.</p>')
  })

  it('gives the page a margin and marks our reply with an arrow', () => {
    const out = html()
    expect(out).toContain('<div class="rx-page">')
    expect(out).toContain('.rx-page { max-width: 44em; margin: 0 auto; padding: 44px 44px 64px; }')
    // The arrow is CSS furniture, not text, so a copied reply stays a reply.
    expect(out).toContain('<div class="rx-reply">')
    expect(out).toContain('.rx-reply::before')
    expect(out).toContain('content: "\\21B3"')
  })

  it('leaves no arrow hanging where no reply was written', () => {
    const out = buildResponseHtml('t', '', responseSections(round({ pointStates: [] }), [report()]))
    expect(out).not.toContain('rx-reply">')
  })

  it('escapes a reviewer who wrote markup', () => {
    const r = report({
      points: [
        {
          id: 'r2.1',
          reviewerIndex: 2,
          pointIndex: 1,
          section: null,
          verbatim: 'Why is <b>n</b> & the SEM missing?',
          from: 0,
          to: 33,
          reason: 'numbered'
        }
      ]
    })
    const out = buildResponseHtml('t', '', responseSections(round(), [r]))
    expect(out).toContain('&lt;b&gt;n&lt;/b&gt; &amp; the SEM')
    expect(out).not.toContain('<b>n</b>')
  })

  it('carries no status bookkeeping into the document an editor reads', () => {
    const out = html()
    expect(out).not.toContain('rebutted')
    expect(out).not.toContain('drafted')
  })
})

describe('responseSubtitle', () => {
  it('says what the round was and how much of it there is', () => {
    expect(responseSubtitle(round(), 2)).toBe('External review · Nature Astronomy · 2 points')
  })

  it('agrees in number with one point', () => {
    expect(responseSubtitle(round({ venue: null }), 1)).toBe('External review · 1 point')
  })
})
