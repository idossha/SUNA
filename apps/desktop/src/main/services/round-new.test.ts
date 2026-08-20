import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewerReportSchema, reportIsFaithful } from '@suna/core'
import {
  analyseReviewerReport,
  commitReviewerReports,
  createRound,
  listRounds,
  readReviewerReports,
  readRound,
  writeRound
} from './round-new'

/**
 * feature-plan-12 §3/§6 on disk. The contract under test is the two-step
 * import: analyse writes nothing, commit writes only what a human confirmed,
 * and neither can produce a verbatim that is not a slice of the source.
 */

let dir: string

const REPORT = `Dear Dr Ramos,

Your manuscript has been reviewed by three referees.

**Reviewer #1**:

Major comments\\
The validation section needs a quantitative comparison against ground truth data.

Figure 4 is difficult to read at print size and should probably be split in two.

**Reviewer #2:**

1. The methods do not state how many animals contributed to each panel of Figure 3.
2. Please report effect sizes alongside the p-values throughout.

**Reviewer #3**:

I have no further comments and recommend acceptance of this manuscript as it stands.
`

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-round-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createRound', () => {
  it('writes round.json and indexes it', async () => {
    const round = await createRound({
      rootDir: dir,
      id: 'round-2',
      kind: 'external',
      label: 'Round 2 — Nature Neuroscience',
      venue: 'Nature Neuroscience'
    })
    expect(round.state).toBe('open')
    expect(await readRound(dir, 'round-2')).toEqual(round)
    expect((await listRounds(dir)).map((r) => r.id)).toEqual(['round-2'])
  })

  it('puts rounds/ at the project root, not under a configurable dir', async () => {
    await createRound({ rootDir: dir, id: 'r1', kind: 'internal', label: 'Internal' })
    await expect(readFile(join(dir, 'rounds', 'r1', 'round.json'), 'utf8')).resolves.toContain('"id"')
  })

  it('refuses a duplicate id and a non-slug id', async () => {
    await createRound({ rootDir: dir, id: 'r1', kind: 'internal', label: 'Internal' })
    await expect(
      createRound({ rootDir: dir, id: 'r1', kind: 'internal', label: 'Again' })
    ).rejects.toThrow(/already exists/)
    await expect(
      createRound({ rootDir: dir, id: 'Round 1', kind: 'internal', label: 'x' })
    ).rejects.toThrow(/lowercase slug/)
  })

  it('lists nothing for a project with no rounds', async () => {
    expect(await listRounds(dir)).toEqual([])
  })

  it('survives a round directory deleted by hand', async () => {
    await createRound({ rootDir: dir, id: 'r1', kind: 'internal', label: 'Internal' })
    await createRound({ rootDir: dir, id: 'r2', kind: 'internal', label: 'Internal 2' })
    await rm(join(dir, 'rounds', 'r1'), { recursive: true })
    expect((await listRounds(dir)).map((r) => r.id)).toEqual(['r2'])
  })
})

describe('analyseReviewerReport writes nothing', () => {
  it('segments without touching disk', async () => {
    const before = await readFile(join(dir, 'suna.json'), 'utf8').catch(() => null)
    const a = analyseReviewerReport(REPORT)
    expect(a.reviewers).toHaveLength(3)
    expect(a.totalPoints).toBeGreaterThan(3)
    expect(a.coveragePercent).toBeGreaterThan(50)
    expect(before).toBeNull()
    await expect(readFile(join(dir, 'rounds', 'x', 'round.json'), 'utf8')).rejects.toThrow()
  })

  it('separates the editor letter from the reviewers', () => {
    const a = analyseReviewerReport(REPORT)
    expect(a.preamble).toContain('Dear Dr Ramos')
    expect(a.preamble).not.toContain('validation section')
  })

  it('names the reviewer it could not split', () => {
    const a = analyseReviewerReport(REPORT)
    // Reviewer 3 is a single paragraph recommending acceptance.
    expect(a.unsplitReviewers).toContain(3)
  })
})

describe('commitReviewerReports', () => {
  beforeEach(async () => {
    await createRound({ rootDir: dir, id: 'round-2', kind: 'external', label: 'Round 2' })
  })

  it('writes one file per reviewer, each faithful to the source', async () => {
    const reports = await commitReviewerReports({
      rootDir: dir,
      roundId: 'round-2',
      analysis: analyseReviewerReport(REPORT)
    })
    expect(reports).toHaveLength(3)
    for (const r of reports) expect(reportIsFaithful(r)).toBe(true)

    const onDisk = await readReviewerReports(dir, 'round-2')
    expect(onDisk.map((r) => r.index)).toEqual([1, 2, 3])
    for (const r of onDisk) expect(reportIsFaithful(r)).toBe(true)
  })

  it('keeps the editor letter beside the reviewers rather than discarding it', async () => {
    await commitReviewerReports({
      rootDir: dir,
      roundId: 'round-2',
      analysis: analyseReviewerReport(REPORT)
    })
    const letter = await readFile(join(dir, 'rounds', 'round-2', 'editor-letter.txt'), 'utf8')
    expect(letter).toContain('Dear Dr Ramos')
  })

  it('retains the whole source on every reviewer, so a split can be re-derived', async () => {
    const reports = await commitReviewerReports({
      rootDir: dir,
      roundId: 'round-2',
      analysis: analyseReviewerReport(REPORT)
    })
    for (const r of reports) expect(r.sourceText).toBe(REPORT)
  })

  it('refuses an analysis whose verbatim is not a slice of the source', async () => {
    const analysis = analyseReviewerReport(REPORT)
    const tampered = {
      ...analysis,
      reviewers: analysis.reviewers.map((rev, i) =>
        i === 0
          ? {
              ...rev,
              points: rev.points.map((p, j) =>
                j === 0 ? { ...p, verbatim: 'Something the reviewer never wrote.' } : p
              )
            }
          : rev
      )
    }
    await expect(
      commitReviewerReports({ rootDir: dir, roundId: 'round-2', analysis: tampered })
    ).rejects.toThrow(/contiguous slice/)
  })

  it('parses back through the schema unchanged', async () => {
    await commitReviewerReports({
      rootDir: dir,
      roundId: 'round-2',
      analysis: analyseReviewerReport(REPORT)
    })
    const raw = await readFile(join(dir, 'rounds', 'round-2', 'reviewers', '1.json'), 'utf8')
    expect(() => ReviewerReportSchema.parse(JSON.parse(raw))).not.toThrow()
  })

  it('returns no reports for a round that was never imported into', async () => {
    expect(await readReviewerReports(dir, 'round-2')).toEqual([])
  })
})

describe('round state round-trips', () => {
  it('writeRound persists a decision and point states', async () => {
    const round = await createRound({
      rootDir: dir,
      id: 'round-2',
      kind: 'external',
      label: 'Round 2'
    })
    await writeRound(dir, {
      ...round,
      state: 'closed',
      decision: 'major-revision',
      decidedAt: '2026-08-19T12:00:00.000Z',
      pointStates: [{ pointId: 'r1.1', status: 'rebutted', assignee: 'AT', reply: '', links: [] }]
    })
    const back = await readRound(dir, 'round-2')
    expect(back.decision).toBe('major-revision')
    expect(back.pointStates[0]?.status).toBe('rebutted')
    expect(back.pointStates[0]?.assignee).toBe('AT')
  })
})
