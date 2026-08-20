import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_MB,
  TRASH_DEFAULTS,
  TRASH_KEYS,
  daysLeft,
  expiryOf,
  isExpired,
  partitionExpired,
  sortByDeletedAt,
  trashDestination,
  trashPolicy,
  type TrashEntry,
} from './trash';

function entry(over: Partial<TrashEntry> = {}): TrashEntry {
  return {
    id: 'a1',
    name: 'notes.md',
    originalPath: '/work/paper/notes.md',
    storedName: 'a1-notes.md',
    bytes: 120,
    deletedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-31T00:00:00.000Z',
    ...over,
  };
}

describe('trashPolicy', () => {
  it('falls back to the shipped policy when nothing is set', () => {
    expect(trashPolicy({})).toEqual({
      maxFileBytes: TRASH_DEFAULTS.maxFileMb * BYTES_PER_MB,
      retentionDays: TRASH_DEFAULTS.retentionDays,
    });
  });

  it('reads the two global keys', () => {
    expect(
      trashPolicy({ [TRASH_KEYS.maxFileMb]: 5, [TRASH_KEYS.retentionDays]: 7 }),
    ).toEqual({ maxFileBytes: 5 * BYTES_PER_MB, retentionDays: 7 });
  });

  it('ignores out-of-range and non-numeric values rather than failing a delete', () => {
    const policy = trashPolicy({
      [TRASH_KEYS.maxFileMb]: -3,
      [TRASH_KEYS.retentionDays]: 'thirty',
    });
    expect(policy.maxFileBytes).toBe(TRASH_DEFAULTS.maxFileMb * BYTES_PER_MB);
    expect(policy.retentionDays).toBe(TRASH_DEFAULTS.retentionDays);
  });

  it('allows 0 MB — every delete then goes to the system trash', () => {
    const policy = trashPolicy({ [TRASH_KEYS.maxFileMb]: 0 });
    expect(trashDestination({ isDirectory: false, bytes: 1 }, policy)).toBe('system');
  });
});

describe('trashDestination', () => {
  const policy = { maxFileBytes: 2 * BYTES_PER_MB, retentionDays: 30 };

  it('keeps a light file in SUNA trash, boundary included', () => {
    expect(trashDestination({ isDirectory: false, bytes: 4_000 }, policy)).toBe('suna');
    expect(trashDestination({ isDirectory: false, bytes: 2 * BYTES_PER_MB }, policy)).toBe(
      'suna',
    );
  });

  it('sends heavy files and every directory to the system trash', () => {
    expect(trashDestination({ isDirectory: false, bytes: 2 * BYTES_PER_MB + 1 }, policy)).toBe(
      'system',
    );
    expect(trashDestination({ isDirectory: true, bytes: 0 }, policy)).toBe('system');
  });
});

describe('expiry', () => {
  it('stamps the retention window onto the deletion instant', () => {
    expect(expiryOf('2026-08-01T00:00:00.000Z', 30)).toBe('2026-08-31T00:00:00.000Z');
  });

  it('expires on the stamp, not on today’s retention setting', () => {
    const e = entry();
    expect(isExpired(e, new Date('2026-08-30T23:59:00.000Z'))).toBe(false);
    expect(isExpired(e, new Date('2026-08-31T00:00:00.000Z'))).toBe(true);
  });

  it('partitions and counts the days a row has left', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const gone = entry({ id: 'b2', expiresAt: '2026-08-02T00:00:00.000Z' });
    const { live, expired } = partitionExpired([entry(), gone], now);
    expect(live.map((r) => r.id)).toEqual(['a1']);
    expect(expired.map((r) => r.id)).toEqual(['b2']);
    expect(daysLeft(entry(), now)).toBe(2);
    expect(daysLeft(gone, now)).toBe(0);
  });
});

describe('sortByDeletedAt', () => {
  it('lists the newest deletion first', () => {
    const older = entry({ id: 'old', deletedAt: '2026-07-01T00:00:00.000Z' });
    expect(sortByDeletedAt([older, entry()]).map((r) => r.id)).toEqual(['a1', 'old']);
  });
});
