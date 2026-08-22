import { z } from 'zod';

/**
 * SUNA trash — the recycle bin for the small plain-text sources a project is
 * made of (Markdown, JSON, BibTeX, LaTeX, SVG…).
 *
 * Deleting from the SUNA UI is not one behaviour but two, chosen by size:
 *   - a FILE at or under the size limit is moved into the project's own trash
 *     (`<project>/.suna/trash/`), where it stays recoverable for the window;
 *   - anything else — a directory, or a file over the limit (a PDF, a raster
 *     export) — goes straight to the OS trash, which is already the right
 *     place for bulk and already has a recycle affordance.
 * Nothing is ever hard-unlinked. Emptying SUNA's trash, and expiry, both hand
 * the file to the OS trash rather than destroying it: the user gets a second
 * chance in the place they expect to look for one.
 *
 * Pure by construction — no fs, no electron. The main process owns the
 * directory and the index; this module decides what the policy means.
 */

/**
 * The per-project directory SUNA keeps its own machine-local state in, beside
 * the project's plain-text sources rather than inside them. Git-ignored: what
 * lives here (today, the trash) is recoverable state, not project history.
 */
export const SUNA_DIR = '.suna';

/**
 * Shipped policy: 2 MB, 30 days. Both are settings — `trash.maxFileMb` and
 * `trash.retentionDays` in the user's config.yml — and these are the values
 * the registry in settings-resolve.ts defaults them to.
 */
export const TRASH_DEFAULTS = {
  maxFileMb: 2,
  retentionDays: 30,
} as const;

/** Bounds for the two Settings inputs; a value outside them falls back. */
export const TRASH_LIMITS = {
  maxFileMb: { min: 0, max: 100 },
  retentionDays: { min: 1, max: 365 },
} as const;

/** Global-settings keys, spelled once so main and renderer cannot drift. */
export const TRASH_KEYS = {
  maxFileMb: 'trash.maxFileMb',
  retentionDays: 'trash.retentionDays',
} as const;

export const BYTES_PER_MB = 1024 * 1024;

/** One recoverable file. `storedName` is its basename inside the trash dir. */
export const TrashEntrySchema = z.object({
  id: z.string().min(1),
  /** The basename it had, and the name it is restored under. */
  name: z.string().min(1),
  /** Absolute path it was deleted from — where "Restore" puts it back. */
  originalPath: z.string().min(1),
  /** File name inside the trash directory (id-prefixed, collision-free). */
  storedName: z.string().min(1),
  bytes: z.number().int().min(0),
  deletedAt: z.string().min(1),
  /** ISO instant the entry is eligible for automatic purge. */
  expiresAt: z.string().min(1),
});
export type TrashEntry = z.infer<typeof TrashEntrySchema>;

/** Unreadable or partly-invalid indexes degrade to the rows that DO parse. */
export const TrashIndexSchema = z.object({
  entries: z.array(TrashEntrySchema),
});

export interface TrashPolicy {
  /** Files at or under this go to SUNA trash; above it, straight to the OS. */
  maxFileBytes: number;
  retentionDays: number;
}

function bounded(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < limits.min || value > limits.max) return fallback;
  return value;
}

/**
 * Read the policy out of a flat settings bag, keyed by TRASH_KEYS. Forgiving
 * on purpose: a nonsense number must not stop the user deleting a file, it
 * just falls back to the shipped policy.
 *
 * The app resolves these two through the config file instead (see
 * services/trash.ts); this stays as the bounds-checking helper and the one
 * place the shipped policy is spelled out.
 */
export function trashPolicy(global: Record<string, unknown>): TrashPolicy {
  const mb = bounded(
    global[TRASH_KEYS.maxFileMb],
    TRASH_LIMITS.maxFileMb,
    TRASH_DEFAULTS.maxFileMb,
  );
  return {
    maxFileBytes: Math.round(mb * BYTES_PER_MB),
    retentionDays: bounded(
      global[TRASH_KEYS.retentionDays],
      TRASH_LIMITS.retentionDays,
      TRASH_DEFAULTS.retentionDays,
    ),
  };
}

/** Where a delete of this entry lands, given its stat and the policy. */
export function trashDestination(
  info: { isDirectory: boolean; bytes: number },
  policy: TrashPolicy,
): 'suna' | 'system' {
  if (info.isDirectory) return 'system';
  return info.bytes <= policy.maxFileBytes ? 'suna' : 'system';
}

export function expiryOf(deletedAt: string, retentionDays: number): string {
  const at = new Date(deletedAt).getTime();
  return new Date(at + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Expired entries are decided by `expiresAt` stamped at delete time, not by
 * re-deriving from today's retention setting: shortening the window must not
 * retroactively purge what the user deleted under the old one. Lengthening it
 * does not resurrect either — the stamp is the promise that was made.
 */
export function isExpired(entry: TrashEntry, now: Date): boolean {
  return new Date(entry.expiresAt).getTime() <= now.getTime();
}

export function partitionExpired(
  entries: readonly TrashEntry[],
  now: Date,
): { live: TrashEntry[]; expired: TrashEntry[] } {
  const live: TrashEntry[] = [];
  const expired: TrashEntry[] = [];
  for (const entry of entries) (isExpired(entry, now) ? expired : live).push(entry);
  return { live, expired };
}

/** Newest deletion first — the order the Trash view lists them in. */
export function sortByDeletedAt(entries: readonly TrashEntry[]): TrashEntry[] {
  return [...entries].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Whole days left before automatic purge; 0 once it is due. */
export function daysLeft(entry: TrashEntry, now: Date): number {
  const ms = new Date(entry.expiresAt).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}
