import { describe, expect, it } from 'vitest'
import {
  formatVersionId,
  latestVersion,
  parseVersionId,
  stageLabel,
  versionsNewestFirst,
  workingVersion,
  type LoggedVersion,
} from './versions';

function v(id: string): LoggedVersion {
  const n = parseVersionId(id)!;
  return {
    schemaVersion: 2,
    id,
    stage: n.stage,
    minor: n.minor,
    createdAt: '2026-01-01T00:00:00.000Z',
    note: '',
    areas: [],
    files: [],
    hashes: [],
  };
}

describe('version numbers', () => {
  it('round-trips an id', () => {
    expect(parseVersionId('v12.3')).toEqual({ stage: 12, minor: 3 });
    expect(formatVersionId({ stage: 12, minor: 3 })).toBe('v12.3');
    expect(parseVersionId('1.2')).toBeNull();
  });

  it('names what each stage means', () => {
    expect(stageLabel(0)).toBe('Internal');
    expect(stageLabel(1)).toBe('First submission');
    expect(stageLabel(2)).toBe('After reviewer corrections');
    expect(stageLabel(4)).toBe('After review round 3');
  });

  it('starts the working copy at v0.1 and advances within the stage', () => {
    expect(formatVersionId(workingVersion([]))).toBe('v0.1');
    expect(formatVersionId(workingVersion([v('v0.1'), v('v0.2')]))).toBe('v0.3');
    // Asking for a stage that has nothing in it starts that stage at .1.
    expect(formatVersionId(workingVersion([v('v0.1')], 1))).toBe('v1.1');
    // The stage follows the highest logged version, not the last written.
    expect(formatVersionId(workingVersion([v('v1.1'), v('v0.9')]))).toBe('v1.2');
  });

  it('orders by stage then minor', () => {
    const all = [v('v0.2'), v('v2.1'), v('v0.10'), v('v1.1')];
    expect(latestVersion(all)?.id).toBe('v2.1');
    expect(versionsNewestFirst(all).map((x) => x.id)).toEqual([
      'v2.1',
      'v1.1',
      'v0.10',
      'v0.2',
    ]);
    expect(latestVersion([])).toBeNull();
  });
});
