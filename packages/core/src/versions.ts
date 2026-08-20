import { z } from 'zod';

/**
 * Manuscript versions — the archive of logged states.
 *
 * A round (see rounds.ts) is a ledger entry about a circulation; a version is
 * a COPY. "Log version" freezes the manuscript AND the work behind it — code,
 * analysis, figures — into `manuscript/archive/v<stage>.<minor>/<area>/` and
 * leaves it there, read-only, so a later reader can open exactly what was sent
 * and what produced it, without asking git anything.
 *
 * The number carries the meaning, and it is the one the field already uses in
 * conversation:
 *
 *   0.x  internal drafts, before anything leaves the group
 *   1.x  the first submission
 *   2.x  after the first round of reviewer corrections
 *   3.x  after another round, and so on
 *
 * The working copy under `manuscript/` is always the NEXT number — the one a
 * log would freeze. Logging v0.3 means the thing you keep typing in becomes
 * v0.4. Nothing under `archive/` is ever editable: it is a record.
 */

/** `v0.1`, `v12.3`. Stage and minor are both plain integers. */
export const VERSION_ID_RE = /^v(\d+)\.(\d+)$/;

export interface VersionNumber {
  /** 0 = internal, 1 = first submission, 2+ = after that many review rounds. */
  stage: number;
  /** 1-based within the stage. */
  minor: number;
}

export function formatVersionId(v: VersionNumber): string {
  return `v${v.stage}.${v.minor}`;
}

export function parseVersionId(id: string): VersionNumber | null {
  const m = VERSION_ID_RE.exec(id);
  if (m === null) return null;
  return { stage: Number(m[1]), minor: Number(m[2]) };
}

/** What a stage means, spelled out wherever a number is shown. */
export function stageLabel(stage: number): string {
  if (stage <= 0) return 'Internal';
  if (stage === 1) return 'First submission';
  if (stage === 2) return 'After reviewer corrections';
  return `After review round ${stage - 1}`;
}

/**
 * The project areas a log freezes: the prose plus the work that produced it.
 *
 * A version has to answer "what did this figure look like, and what made it"
 * — so the code and analysis that generated the results travel with the
 * manuscript. `data/`, `results/` and `output/` are deliberately left out:
 * they are inputs and derived artifacts, often large and often binary, and
 * copying them on every draft would make the archive unusable.
 */
export const VERSION_AREAS = ['manuscript', 'code', 'analysis', 'figures'] as const;
export type VersionArea = (typeof VERSION_AREAS)[number];

export const LoggedVersionSchema = z.object({
  /**
   * 1 — manuscript-only archives, files recorded manuscript-relative.
   * 2 — area archives, files recorded as `<area>/<path-within-area>`.
   */
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  /** `v1.2` — also the directory name under `manuscript/archive/`. */
  id: z.string().regex(VERSION_ID_RE),
  stage: z.number().int().nonnegative(),
  minor: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  /** The author's one line about why this state was worth keeping. */
  note: z.string().default(''),
  /** Which areas this log covers. Empty on a schemaVersion 1 record. */
  areas: z.array(z.enum(VERSION_AREAS)).default([]),
  /**
   * Archived files, version-relative. At schemaVersion 2 every path is
   * area-prefixed: 'manuscript/manuscript.json', 'code/reduce.py'.
   */
  files: z.array(z.string().min(1)).default([]),
  /** sha256 of each archived file, same order as `files`. */
  hashes: z.array(z.string().min(1)).default([]),
});
export type LoggedVersion = z.infer<typeof LoggedVersionSchema>;

/** `manuscript/archive/index.json` — the archive's table of contents. */
export const VersionArchiveSchema = z.object({
  schemaVersion: z.literal(1),
  versions: z.array(LoggedVersionSchema).default([]),
});
export type VersionArchive = z.infer<typeof VersionArchiveSchema>;

export function emptyVersionArchive(): VersionArchive {
  return { schemaVersion: 1, versions: [] };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

export function compareVersions(a: VersionNumber, b: VersionNumber): number {
  return a.stage === b.stage ? a.minor - b.minor : a.stage - b.stage;
}

/** The highest logged version, or null when nothing has been logged yet. */
export function latestVersion(versions: readonly LoggedVersion[]): LoggedVersion | null {
  let best: LoggedVersion | null = null;
  for (const v of versions) {
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

/**
 * The number the working copy currently carries — the one a log would freeze.
 *
 * With nothing logged the working copy is v0.1: an untouched project is
 * already an internal draft, it just has not been kept yet.
 */
export function workingVersion(
  versions: readonly LoggedVersion[],
  stage?: number,
): VersionNumber {
  const latest = latestVersion(versions);
  const target = stage ?? latest?.stage ?? 0;
  const inStage = versions.filter((v) => v.stage === target);
  const highest = inStage.reduce((n, v) => Math.max(n, v.minor), 0);
  return { stage: target, minor: highest + 1 };
}

/** Versions newest-first, which is the order the sidebar lists them in. */
export function versionsNewestFirst(versions: readonly LoggedVersion[]): LoggedVersion[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

/** Where a file inside a logged version lives, across both schema versions. */
export function versionFilePath(version: LoggedVersion, area: VersionArea, rel: string): string {
  return version.schemaVersion >= 2 ? `${area}/${rel}` : rel;
}

/** The files a version holds for one area, area-relative. */
export function versionAreaFiles(version: LoggedVersion, area: VersionArea): string[] {
  if (version.schemaVersion < 2) return area === 'manuscript' ? [...version.files] : [];
  const prefix = `${area}/`;
  return version.files.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
}
