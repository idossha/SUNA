import { describe, expect, it } from 'vitest';
import { RoundSchema, baselineVersionFor, type Round } from './rounds';
import { LoggedVersionSchema, type LoggedVersion } from './versions';

function round(over: Partial<Round> = {}): Round {
  return RoundSchema.parse({
    schemaVersion: 1,
    id: 'round-1',
    kind: 'external',
    label: 'Round 1',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...over,
  });
}

function version(id: string, createdAt: string): LoggedVersion {
  const [stage, minor] = id.slice(1).split('.').map(Number);
  return LoggedVersionSchema.parse({
    schemaVersion: 2,
    id,
    stage,
    minor,
    createdAt,
    note: '',
    areas: ['manuscript'],
    files: [],
    hashes: [],
  });
}

describe('baselineVersionFor', () => {
  const versions = [
    version('v0.1', '2026-01-01T00:00:00.000Z'),
    version('v1.1', '2026-02-01T00:00:00.000Z'),
    version('v1.2', '2026-02-15T00:00:00.000Z'),
    version('v2.1', '2026-05-01T00:00:00.000Z'),
  ];

  it('uses the pointer the round carries', () => {
    expect(baselineVersionFor(round({ baselineVersionId: 'v1.1' }), versions)?.id).toBe('v1.1');
  });

  it('infers the newest version logged before the round when there is no pointer', () => {
    expect(baselineVersionFor(round(), versions)?.id).toBe('v1.2');
  });

  it('never infers a version logged after the round was created', () => {
    const inferred = baselineVersionFor(round(), versions);
    expect(inferred?.id).not.toBe('v2.1');
  });

  it('is null when nothing had been logged yet', () => {
    expect(baselineVersionFor(round({ createdAt: '2025-01-01T00:00:00.000Z' }), versions)).toBeNull();
  });

  it('is null when the pointer names a version that is gone, rather than guessing', () => {
    expect(baselineVersionFor(round({ baselineVersionId: 'v9.9' }), versions)).toBeNull();
  });

  it('defaults the field to null on a round file that predates it', () => {
    expect(round().baselineVersionId).toBeNull();
  });

  it('refuses a pointer that is not a version id', () => {
    expect(() => round({ baselineVersionId: 'archive/latest' as string })).toThrow();
  });
});
