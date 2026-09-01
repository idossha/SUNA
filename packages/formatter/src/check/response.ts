import type {
  ReviewPointRecord,
  ReviewerReport,
  Round,
} from '@suna/core';
import { pointStateFor, unaddressedPoints } from '@suna/core';
import type { Diagnostic } from './types';

/**
 * Response-document compliance (ARCHITECTURE §12.1).
 *
 * The completeness check is the whole point of this module, and it exists
 * because of a specific, real failure: a response letter in the evidence set
 * numbered its replies by hand up to RE83 and was missing RE58 entirely.
 * Nobody noticed, because a hand-maintained counter has no way to notice.
 *
 * So: every unaddressed point is reported BY NAME. Not a count — "3 problems"
 * tells an author nothing about which reviewer is going to be annoyed.
 */

export interface ResponseCheckInput {
  round: Round;
  reports: readonly ReviewerReport[];
  /** The response document's prose, for the reply-presence check. */
  responseText: string;
  /**
   * True when this check is gating an export. Unaddressed points are an error
   * at export and a warning while drafting — a half-written response is a
   * normal state to be in, right up until you send it.
   */
  forExport?: boolean;
}

/** `@point:r2.3` — how a response's prose names the point it answers. */
const POINT_REF_RE = /@point:([a-z0-9.]+)/gi;

function referencedPointIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(POINT_REF_RE)) {
    if (m[1] !== undefined) ids.add(m[1].toLowerCase());
  }
  return ids;
}

function label(point: ReviewPointRecord): string {
  const head = point.verbatim.replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Reviewer ${point.reviewerIndex}, point ${point.pointIndex} (“${head}…”)`;
}

export function checkResponse(input: ResponseCheckInput): Diagnostic[] {
  const { round, reports, responseText } = input;
  const out: Diagnostic[] = [];
  const severity = input.forExport === true ? 'error' : 'warning';

  // 1 — every point the author has not marked done or rebutted, by name.
  for (const point of unaddressedPoints(round, reports)) {
    out.push({
      id: 'response.point-unaddressed',
      severity,
      surface: 'response',
      message: `${label(point)} is unaddressed`,
      target: { documentId: round.responseDocumentId ?? undefined, pointId: point.id },
    });
  }

  // 2 — a point marked answered whose reply never appears in the document.
  // Marking a point done in the sidecar and forgetting to write the reply is
  // the exact mistake the sidecar makes easy, so it gets its own check.
  const referenced = referencedPointIds(responseText);
  for (const report of reports) {
    for (const point of report.points) {
      const state = pointStateFor(round, point.id);
      if (state.status !== 'done' && state.status !== 'rebutted') continue;
      if (referenced.has(point.id.toLowerCase())) continue;
      out.push({
        id: 'response.reply-missing',
        severity: 'warning',
        surface: 'response',
        message: `${label(point)} is marked ${state.status}, but no reply in the response document names it — add @point:${point.id}`,
        target: { documentId: round.responseDocumentId ?? undefined, pointId: point.id },
      });
    }
  }

  // 3 — a reply naming a point that does not exist. Almost always a typo in
  // a hand-written id, and it means a reviewer is being answered into space.
  const known = new Set<string>();
  for (const report of reports) for (const p of report.points) known.add(p.id.toLowerCase());
  for (const id of referenced) {
    if (!known.has(id)) {
      out.push({
        id: 'response.reply-orphaned',
        severity: 'warning',
        surface: 'response',
        message: `the response answers @point:${id}, which is not a point in this round`,
        target: { documentId: round.responseDocumentId ?? undefined, pointId: id },
      });
    }
  }

  // 4 — the round has reviewer reports whose verbatim no longer matches the
  // retained source. That means someone edited a reviewer's words, which is
  // the one thing the model is built to make hard.
  for (const report of reports) {
    for (const point of report.points) {
      if (report.sourceText.slice(point.from, point.to) === point.verbatim) continue;
      out.push({
        id: 'response.verbatim-altered',
        severity: 'error',
        surface: 'response',
        message: `Reviewer ${report.index}, point ${point.pointIndex} no longer matches the text as received — a reviewer's words must not be edited`,
        target: { pointId: point.id },
      });
    }
  }

  return out;
}

/**
 * Points with no assignee, for the "unassigned work" view. Not a diagnostic:
 * a project with one author has no use for assignment, and nagging them about
 * it would be noise.
 */
export function unassignedPoints(
  round: Round,
  reports: readonly ReviewerReport[],
): ReviewPointRecord[] {
  const out: ReviewPointRecord[] = [];
  for (const report of reports) {
    for (const point of report.points) {
      if (pointStateFor(round, point.id).assignee === null) out.push(point);
    }
  }
  return out;
}
