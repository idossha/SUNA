import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ReviewerReportSchema,
  RoundSchema,
  RoundsIndexSchema,
  emptyRoundsIndex,
  reportIsFaithful,
  segmentReviewerReport,
  verbatimIsContiguous,
  type ReviewerReport,
  type Round,
  type RoundKind,
  type SegmentationResult
} from '@suna/core'
import { writeFileAtomic } from './atomic'
import { extractPlainText } from './document-import'
import { roundDir, roundsDir } from './paths'

/**
 * Rounds on disk (ARCHITECTURE §4.5; document-kinds-ux.md §B).
 *
 * Import is two calls on purpose, because the UX is two steps and the house
 * contract is that nothing is written until the human confirms:
 *
 *   analyseReviewerReport(text)   pure, instant, offline — feeds the review
 *                                 screen, writes NOTHING
 *   commitReviewerReport(...)     writes rounds/<id>/reviewers/*.json
 *
 * The same shape DocxImportTab already uses: analyse, show what was found and
 * why, let the user correct it, write on confirm.
 */

const ROUND_ID_RE = /^[a-z0-9][a-z0-9-]*$/

export interface NewRoundInput {
  rootDir: string
  id: string
  kind: RoundKind
  label: string
  venue?: string | null
  createdAt?: string
}

export async function createRound(input: NewRoundInput): Promise<Round> {
  if (!ROUND_ID_RE.test(input.id)) {
    throw new Error(`round id "${input.id}" must be a lowercase slug`)
  }
  const dir = roundDir(input.rootDir, input.id)
  const existing = await readRound(input.rootDir, input.id).catch(() => null)
  if (existing !== null) throw new Error(`round "${input.id}" already exists`)

  const round = RoundSchema.parse({
    schemaVersion: 1,
    id: input.id,
    kind: input.kind,
    label: input.label,
    venue: input.venue ?? null,
    createdAt: input.createdAt ?? new Date().toISOString()
  })

  await mkdir(dir, { recursive: true })
  await writeFileAtomic(join(dir, 'round.json'), `${JSON.stringify(round, null, 2)}\n`)
  await addToIndex(input.rootDir, input.id)
  return round
}

export async function readRound(rootDir: string, roundId: string): Promise<Round> {
  const raw = await readFile(join(roundDir(rootDir, roundId), 'round.json'), 'utf8')
  return RoundSchema.parse(JSON.parse(raw))
}

export async function writeRound(rootDir: string, round: Round): Promise<void> {
  await writeFileAtomic(
    join(roundDir(rootDir, round.id), 'round.json'),
    `${JSON.stringify(RoundSchema.parse(round), null, 2)}\n`
  )
}

export async function listRounds(rootDir: string): Promise<Round[]> {
  const index = await readIndex(rootDir)
  const out: Round[] = []
  for (const id of index.rounds) {
    try {
      out.push(await readRound(rootDir, id))
    } catch {
      // A round directory that has been deleted by hand is skipped rather
      // than making the whole ledger unreadable.
    }
  }
  return out
}

async function readIndex(rootDir: string): Promise<ReturnType<typeof emptyRoundsIndex>> {
  try {
    const raw = await readFile(join(roundsDir(rootDir), 'index.json'), 'utf8')
    return RoundsIndexSchema.parse(JSON.parse(raw))
  } catch {
    return emptyRoundsIndex()
  }
}

async function addToIndex(rootDir: string, id: string): Promise<void> {
  const index = await readIndex(rootDir)
  if (index.rounds.includes(id)) return
  await mkdir(roundsDir(rootDir), { recursive: true })
  await writeFileAtomic(
    join(roundsDir(rootDir), 'index.json'),
    `${JSON.stringify(RoundsIndexSchema.parse({ ...index, rounds: [...index.rounds, id] }), null, 2)}\n`
  )
}

/* ------------------------------------------------------------------ */
/* Reviewer import                                                      */
/* ------------------------------------------------------------------ */

export interface ReviewerAnalysis extends SegmentationResult {
  /** The exact text the points were cut from, carried through to the commit. */
  sourceText: string
  totalPoints: number
  /** Percentage, rounded, for the coverage meter. */
  coveragePercent: number
}

/**
 * Pass 1: deterministic, offline, instant. Writes nothing.
 *
 * `sourceText` is carried through unchanged so the commit step can assert
 * that every verbatim is still a contiguous slice of exactly this text — a
 * guarantee that would be worthless if the two steps re-derived it.
 */
export function analyseReviewerReport(sourceText: string): ReviewerAnalysis {
  const result = segmentReviewerReport(sourceText)
  const totalPoints = result.reviewers.reduce((n, r) => n + r.points.length, 0)
  return {
    ...result,
    sourceText,
    totalPoints,
    coveragePercent: Math.round(result.coverage * 100)
  }
}

export interface CommitReviewersInput {
  rootDir: string
  roundId: string
  analysis: ReviewerAnalysis
}

/**
 * Pass 2: write the reviewer records, after a human has looked at them.
 *
 * Refuses outright if any verbatim is not a contiguous slice of the retained
 * source. That check is cheap and it is the difference between "we quote the
 * reviewer" and "we quote something we believe the reviewer said".
 */
export async function commitReviewerReports(
  input: CommitReviewersInput
): Promise<ReviewerReport[]> {
  const { rootDir, roundId, analysis } = input
  if (!verbatimIsContiguous(analysis, analysis.sourceText)) {
    throw new Error(
      'refusing to import: a point is not a contiguous slice of the source text'
    )
  }

  const dir = join(roundDir(rootDir, roundId), 'reviewers')
  await mkdir(dir, { recursive: true })

  const reports: ReviewerReport[] = []
  for (const block of analysis.reviewers) {
    // Each reviewer keeps the WHOLE source. Storage is a few kilobytes and it
    // means a split or merge can always be re-derived, and any reader can
    // verify every verbatim without another file.
    const report = ReviewerReportSchema.parse({
      schemaVersion: 1,
      index: block.index,
      label: block.label,
      sourceText: analysis.sourceText,
      points: block.points.map((p) => ({
        id: p.id,
        reviewerIndex: p.reviewerIndex,
        pointIndex: p.pointIndex,
        section: p.section,
        verbatim: p.verbatim,
        from: p.from,
        to: p.to,
        reason: p.reason
      })),
      unassigned: analysis.unassigned
        .filter((u) => u.from >= block.from && u.to <= block.to)
        .map((u) => ({ from: u.from, to: u.to }))
    })
    if (!reportIsFaithful(report)) {
      throw new Error(`refusing to import reviewer ${block.index}: verbatim does not match source`)
    }
    await writeFileAtomic(
      join(dir, `${block.index}.json`),
      `${JSON.stringify(report, null, 2)}\n`
    )
    reports.push(report)
  }

  // The preamble — the editor's own letter — is kept beside the reviewers. It
  // is not a reviewer point and never becomes one, but throwing it away would
  // lose the decision itself.
  if (analysis.preamble.trim() !== '') {
    await writeFileAtomic(join(roundDir(rootDir, roundId), 'editor-letter.txt'), `${analysis.preamble}\n`)
  }

  return reports
}

/**
 * Text for the reviewer-import sheet's file route. Delegates to the SAME
 * extraction the manuscript importer uses, so a .docx, a .pdf and a paste all
 * become one string before anything is segmented.
 */
export async function extractReviewText(path: string): Promise<string> {
  return extractPlainText(path)
}

export async function readReviewerReports(
  rootDir: string,
  roundId: string
): Promise<ReviewerReport[]> {
  const dir = join(roundDir(rootDir, roundId), 'reviewers')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: ReviewerReport[] = []
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      out.push(ReviewerReportSchema.parse(JSON.parse(await readFile(join(dir, name), 'utf8'))))
    } catch {
      // A malformed reviewer file is skipped, not fatal — the other
      // reviewers' points are still work the author can get on with.
    }
  }
  return out.sort((a, b) => a.index - b.index)
}
