import {
  pointStateFor,
  type ReviewPointRecord,
  type ReviewerReport,
  type Round
} from '@suna/core'
import type { PointReplyArgs } from '../ai/directedActions'
import type { SiblingReply } from '../ai/templates'

/**
 * What the AI is told about one reviewer point, assembled from what the app
 * already has (ARCHITECTURE §14.2).
 *
 * The prompt itself sends the agent to read the manuscript through the MCP
 * verbs — that part is the agent's job and it does it better than a
 * pre-baked excerpt would. What this module supplies is the material the
 * agent has no way to fetch and no way to guess:
 *
 * - **The reviewer's paragraph, not just the sentence.** The importer cuts a
 *   report into points, and a point read alone routinely loses its referent
 *   ("this analysis", "the same problem as above"). The retained `sourceText`
 *   is the only place that referent still exists, so a window of it travels
 *   with the point.
 * - **Every reply already written in this round.** A response letter is one
 *   document with one position. Answering point 11 without knowing what
 *   point 4 conceded is how a letter contradicts itself in front of the
 *   editor who has to reconcile them.
 * - **The author's own conventions**, from context/PEER-REVIEW.md, verbatim.
 *
 * Everything here is derived at call time from state already in the tab. It
 * is deliberately not stored: a cached context is a stale context the moment
 * a sibling reply changes.
 */

/** Live state the tab holds; one point's context is derived from it. */
export interface ReplyContextSource {
  rootDir: string
  round: Round
  reports: readonly ReviewerReport[]
  /** The report this point came from — where its surrounding text lives. */
  report: ReviewerReport | undefined
  /** context/PEER-REVIEW.md, or null when it is absent or empty. */
  guidelines: string | null
  /**
   * Called when the approval screen writes new guidelines. The tab holds the
   * one copy every card's prompt is built from, so approving on one card has
   * to reach the other eighty-three.
   */
  onGuidelinesApproved: (text: string) => void
}

/**
 * Characters of the reviewer's own report to send on each side of the point.
 * Wide enough to carry the paragraph a pronoun refers back to, narrow enough
 * that a long report does not crowd out the manuscript the agent still has
 * to read.
 */
export const REPORT_WINDOW_CHARS = 700

/** How many already-answered points travel with the prompt. Ordered by
 * proximity — the same reviewer's points constrain a reply far more than
 * another reviewer's do. */
export const MAX_SIBLINGS = 12

export function pointLabelFor(point: ReviewPointRecord): string {
  return `Reviewer ${point.reviewerIndex}, point ${point.pointIndex}`
}

/**
 * The reviewer's text around this point, with the point itself left in place
 * — the agent is told which slice is the point, so removing it would only
 * make the passage read as if a sentence went missing.
 */
export function reportWindow(report: ReviewerReport | undefined, point: ReviewPointRecord): string {
  if (report === undefined) return ''
  const start = Math.max(0, point.from - REPORT_WINDOW_CHARS)
  const end = Math.min(report.sourceText.length, point.to + REPORT_WINDOW_CHARS)
  const slice = report.sourceText.slice(start, end).trim()
  if (slice === '' || slice === point.verbatim.trim()) return ''
  return `${start > 0 ? '…' : ''}${slice}${end < report.sourceText.length ? '…' : ''}`
}

/**
 * Points in this round that already have a reply, nearest first: the same
 * reviewer before the others, and within a reviewer, the points closest to
 * this one. Nearest-first matters because the list is capped — when a round
 * has sixty answered points, the twelve that shape this reply are the ones
 * around it, not the first twelve by index.
 */
export function siblingReplies(
  round: Round,
  reports: readonly ReviewerReport[],
  point: ReviewPointRecord
): SiblingReply[] {
  const all: { sibling: SiblingReply; distance: number }[] = []
  for (const report of reports) {
    for (const p of report.points) {
      if (p.id === point.id) continue
      const state = pointStateFor(round, p.id)
      if (state.reply.trim() === '') continue
      const sameReviewer = p.reviewerIndex === point.reviewerIndex
      all.push({
        sibling: {
          label: pointLabelFor(p),
          verbatim: p.verbatim,
          reply: state.reply,
          status: state.status
        },
        distance: sameReviewer ? Math.abs(p.pointIndex - point.pointIndex) : 1000
      })
    }
  }
  all.sort((a, b) => a.distance - b.distance)
  return all.slice(0, MAX_SIBLINGS).map((entry) => entry.sibling)
}

/** Everything the assistant needs except the mode and the per-run overrides. */
export function pointReplyContext(
  source: ReplyContextSource,
  point: ReviewPointRecord
): Omit<PointReplyArgs, 'mode' | 'model' | 'effort'> {
  return {
    rootDir: source.rootDir,
    pointId: point.id,
    roundId: source.round.id,
    roundLabel: source.round.label,
    venue: source.round.venue,
    decision: source.round.decision,
    pointLabel: pointLabelFor(point),
    verbatim: point.verbatim,
    section: point.section,
    reportContext: reportWindow(source.report, point),
    siblings: siblingReplies(source.round, source.reports, point),
    // Filled in by the assistant from the live textarea, which may hold
    // keystrokes that have not been committed to round.json yet.
    currentReply: '',
    peerReviewGuidelines: source.guidelines
  }
}
