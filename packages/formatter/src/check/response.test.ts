import { describe, expect, it } from 'vitest';
import {
  RoundSchema,
  ReviewerReportSchema,
  type ReviewerReport,
  type Round,
} from '@suna/core';
import { checkResponse, unassignedPoints } from './response';

/**
 * feature-plan-12 §6d. The headline case is the one from the evidence set:
 * a hand-numbered response that reached RE83 with RE58 missing.
 */

const SOURCE = [
  '1. The validation section needs a quantitative comparison against ground truth.',
  '2. Figure 4 is difficult to read at print size.',
  '3. The methods do not state how many animals contributed.',
].join('\n\n');

function reportFor(): ReviewerReport {
  const points = [
    { id: 'r1.1', pointIndex: 1, needle: 'validation section' },
    { id: 'r1.2', pointIndex: 2, needle: 'Figure 4' },
    { id: 'r1.3', pointIndex: 3, needle: 'how many animals' },
  ].map((p) => {
    const from = SOURCE.indexOf(p.needle) - 3;
    const to = SOURCE.indexOf('\n\n', from) === -1 ? SOURCE.length : SOURCE.indexOf('\n\n', from);
    return {
      id: p.id,
      reviewerIndex: 1,
      pointIndex: p.pointIndex,
      section: null,
      verbatim: SOURCE.slice(from, to),
      from,
      to,
      reason: 'numbered point',
    };
  });
  return ReviewerReportSchema.parse({
    schemaVersion: 1,
    index: 1,
    label: 'Reviewer #1',
    sourceText: SOURCE,
    points,
  });
}

function roundWith(states: Round['pointStates'] = []): Round {
  return RoundSchema.parse({
    schemaVersion: 1,
    id: 'round-2',
    kind: 'external',
    label: 'Round 2 — Nature Neuroscience',
    venue: 'Nature Neuroscience',
    createdAt: '2026-08-19T00:00:00.000Z',
    responseDocumentId: 'response-round-2',
    pointStates: states,
  });
}

describe('response.point-unaddressed', () => {
  it('names every unaddressed point rather than counting them', () => {
    const diags = checkResponse({
      round: roundWith(),
      reports: [reportFor()],
      responseText: '',
    });
    const unaddressed = diags.filter((d) => d.id === 'response.point-unaddressed');
    expect(unaddressed).toHaveLength(3);
    expect(unaddressed[0]?.message).toContain('Reviewer 1, point 1');
    // The message quotes the point so the author knows which one it is.
    expect(unaddressed[0]?.message).toContain('validation section');
  });

  it('is a warning while drafting and an error at export', () => {
    const args = { round: roundWith(), reports: [reportFor()], responseText: '' };
    expect(checkResponse(args)[0]?.severity).toBe('warning');
    expect(checkResponse({ ...args, forExport: true })[0]?.severity).toBe('error');
  });

  it('counts a rebuttal as addressed — disagreeing in writing is answering', () => {
    const diags = checkResponse({
      round: roundWith([
        { pointId: 'r1.1', status: 'rebutted', assignee: null, links: [] },
        { pointId: 'r1.2', status: 'done', assignee: null, links: [] },
        { pointId: 'r1.3', status: 'done', assignee: null, links: [] },
      ]),
      reports: [reportFor()],
      responseText: '@point:r1.1 @point:r1.2 @point:r1.3',
    });
    expect(diags.filter((d) => d.id === 'response.point-unaddressed')).toEqual([]);
  });

  it('does not count a draft as addressed', () => {
    const diags = checkResponse({
      round: roundWith([{ pointId: 'r1.1', status: 'drafted', assignee: null, links: [] }]),
      reports: [reportFor()],
      responseText: '',
    });
    expect(diags.filter((d) => d.id === 'response.point-unaddressed')).toHaveLength(3);
  });

  it('catches the RE58 case — a gap in the middle of an otherwise complete set', () => {
    const diags = checkResponse({
      round: roundWith([
        { pointId: 'r1.1', status: 'done', assignee: null, links: [] },
        // r1.2 skipped, exactly as RE58 was
        { pointId: 'r1.3', status: 'done', assignee: null, links: [] },
      ]),
      reports: [reportFor()],
      responseText: '@point:r1.1 @point:r1.3',
      forExport: true,
    });
    const missing = diags.filter((d) => d.id === 'response.point-unaddressed');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('point 2');
    expect(missing[0]?.severity).toBe('error');
  });
});

describe('response.reply-missing and -orphaned', () => {
  it('warns when a point is marked done but no reply names it', () => {
    const diags = checkResponse({
      round: roundWith([{ pointId: 'r1.1', status: 'done', assignee: null, links: [] }]),
      reports: [reportFor()],
      responseText: 'We have revised the manuscript throughout.',
    });
    const hit = diags.find((d) => d.id === 'response.reply-missing');
    expect(hit?.message).toContain('@point:r1.1');
  });

  it('warns when a reply names a point that does not exist', () => {
    const diags = checkResponse({
      round: roundWith(),
      reports: [reportFor()],
      responseText: 'As requested: @point:r9.9',
    });
    expect(diags.map((d) => d.id)).toContain('response.reply-orphaned');
  });

  it('is case-insensitive about point ids', () => {
    const diags = checkResponse({
      round: roundWith([{ pointId: 'r1.1', status: 'done', assignee: null, links: [] }]),
      reports: [reportFor()],
      responseText: '@point:R1.1',
    });
    expect(diags.map((d) => d.id)).not.toContain('response.reply-missing');
  });
});

describe('response.verbatim-altered', () => {
  it('is an error when a reviewer’s words no longer match what was received', () => {
    const report = reportFor();
    const tampered: ReviewerReport = {
      ...report,
      points: report.points.map((p, i) =>
        i === 0 ? { ...p, verbatim: 'The validation section is fine, actually.' } : p,
      ),
    };
    const diags = checkResponse({
      round: roundWith(),
      reports: [tampered],
      responseText: '',
    });
    const hit = diags.find((d) => d.id === 'response.verbatim-altered');
    expect(hit?.severity).toBe('error');
    expect(hit?.message).toContain('must not be edited');
  });

  it('stays quiet on an untouched report', () => {
    const diags = checkResponse({
      round: roundWith(),
      reports: [reportFor()],
      responseText: '',
    });
    expect(diags.map((d) => d.id)).not.toContain('response.verbatim-altered');
  });
});

describe('assignment is information, not a diagnostic', () => {
  it('lists unassigned points without emitting anything', () => {
    const round = roundWith([{ pointId: 'r1.1', status: 'done', assignee: 'AT', links: [] }]);
    const reports = [reportFor()];
    expect(unassignedPoints(round, reports).map((p) => p.id)).toEqual(['r1.2', 'r1.3']);
    const diags = checkResponse({ round, reports, responseText: '@point:r1.1' });
    expect(diags.map((d) => d.id)).not.toContain('response.point-unassigned');
  });
});
