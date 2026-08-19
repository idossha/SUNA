import { z } from 'zod';

/**
 * manuscript/revisions.json — the baseline behind the AI-diff review view
 * (feature-plan-11 §11e).
 *
 * The rule that shapes everything here: **the manuscript file itself never
 * carries diff markers.** An agent CLI edits files directly and cannot be
 * intercepted, so after a run the prose on disk is already the new text. What
 * this sidecar stores is the text from BEFORE the run — the pre-image — which
 * makes the review view exactly a git diff: baseline versus working tree.
 * Exports, compliance checks, word counts and git all keep seeing clean
 * Markdown at every instant, mid-review included.
 *
 * `base` is the WHOLE file, not a list of hunks, and that is deliberate.
 * Hunks are derived at render time by diffing base against the live buffer —
 * the same discipline numbering follows — so they stay correct as the author
 * keeps editing around them, with no hunk-migration logic anywhere. Storage is
 * a second copy of a prose file: nothing, next to the figures beside it.
 *
 * At most one open revision per path. A second run before the author has
 * reviewed the first keeps the OLDER base, because "everything the AI has
 * changed since I last looked" is the question a reviewer is actually asking.
 */

export const RevisionAuthorSchema = z.object({
  /** Only 'ai' for now; a human revision would be an ordinary edit. */
  kind: z.literal('ai'),
  /** One line naming the run, e.g. "Comment fix — §Methods". Shown in the review bar. */
  label: z.string().min(1),
});
export type RevisionAuthor = z.infer<typeof RevisionAuthorSchema>;

export const RevisionSchema = z.object({
  id: z.string().min(1),
  /** Manuscript-relative, i.e. "manuscript.md" — the comments.json convention. */
  path: z.string().min(1),
  author: RevisionAuthorSchema,
  /** ISO timestamp of the most recent run folded into this baseline. */
  at: z.string().min(1),
  /** The file's full text before the AI touched it. */
  base: z.string(),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const RevisionsFileSchema = z.object({
  schemaVersion: z.literal(1),
  revisions: z.array(RevisionSchema),
});
export type RevisionsFile = z.infer<typeof RevisionsFileSchema>;

/** The file written when a project has no unreviewed AI changes. */
export function emptyRevisionsFile(): RevisionsFile {
  return { schemaVersion: 1, revisions: [] };
}

/** The open revision for a manuscript-relative path, or null. */
export function revisionFor(file: RevisionsFile, path: string): Revision | null {
  return file.revisions.find((r) => r.path === path) ?? null;
}
