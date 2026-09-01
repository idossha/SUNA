import { z } from 'zod';

/**
 * manuscript/authors.json — the byline, split out of manuscript.json so the
 * prose file, the metadata file, and the people are three separate,
 * independently editable sources of truth (ARCHITECTURE §4.3).
 *
 * The Author/Affiliation shapes are unchanged from when they lived inside
 * ManuscriptSchema: nothing about ORCID, corresponding authorship or
 * equal-contribution moved. They live HERE (rather than in manuscript.ts)
 * because manuscript.json no longer references them at all — keeping the
 * declaration next to the file that owns it avoids an import cycle between
 * the two schemas.
 */

export const OrcidSchema = z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/);

export const AuthorSchema = z.object({
  id: z.string().min(1),
  given: z.string().min(1),
  family: z.string().min(1),
  nativeScript: z.string().min(1).nullable(),
  orcid: OrcidSchema.nullable(),
  affiliationRefs: z.array(z.string().min(1)),
  corresponding: z.boolean(),
  email: z.email().nullable(),
  equalContribution: z.boolean(),
  deceased: z.boolean(),
});
export type Author = z.infer<typeof AuthorSchema>;

export const AffiliationSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type Affiliation = z.infer<typeof AffiliationSchema>;

/**
 * The whole file. `authors` may legitimately be empty (a brand-new project
 * that has not named anyone yet); numbering of affiliation markers is still
 * NEVER stored — it is derived at format time from array order.
 */
export const AuthorsFileSchema = z.object({
  schemaVersion: z.literal(1),
  authors: z.array(AuthorSchema),
  affiliations: z.array(AffiliationSchema),
});
export type AuthorsFile = z.infer<typeof AuthorsFileSchema>;

/** The file written for a project that has no byline yet. */
export function emptyAuthorsFile(): AuthorsFile {
  return { schemaVersion: 1, authors: [], affiliations: [] };
}
