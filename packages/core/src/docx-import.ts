import { z } from 'zod';

/**
 * DOCX import (feature-plan-6 §2) — the analyze/commit split.
 *
 * `docx:analyze` turns a .docx into this structured, EDITABLE draft without
 * writing anything to disk. Every front-matter field carries a `reason`
 * string explaining how the heuristic decided, shown verbatim in the review
 * screen so a wrong guess is visible before it can corrupt a manuscript.
 * `docx:commit` takes a (possibly user-edited) DocxAnalysis and writes the
 * project; nothing is written before that call.
 */

export const DocxWarningSchema = z.object({
  /** Short machine-stable tag, e.g. 'omml-equations', 'citation-ambiguous'. */
  code: z.string().min(1),
  message: z.string().min(1),
  /** A snippet of the source text the warning is about, when there is one. */
  context: z.string().nullable(),
});
export type DocxWarning = z.infer<typeof DocxWarningSchema>;

export const DocxAuthorDraftSchema = z.object({
  /** Full name as it appeared on the author line. */
  name: z.string().min(1),
  given: z.string().min(1),
  family: z.string().min(1),
  /** Raw superscript/marker tokens following the name (e.g. ["1","2"], ["*"]). */
  markers: z.array(z.string()),
  /** Affiliation ids (DocxAffiliationDraft.marker values) this author maps to. */
  affiliationRefs: z.array(z.string()),
});
export type DocxAuthorDraft = z.infer<typeof DocxAuthorDraftSchema>;

export const DocxAffiliationDraftSchema = z.object({
  /** The leading marker the affiliation paragraph started with ("1", "*", …). */
  marker: z.string().min(1),
  text: z.string().min(1),
});
export type DocxAffiliationDraft = z.infer<typeof DocxAffiliationDraftSchema>;

export const DocxSectionDraftSchema = z.object({
  heading: z.string().min(1).nullable(),
  /** The Word heading depth (1 or 2) that started this section; informational only. */
  level: z.union([z.literal(1), z.literal(2)]),
  markdown: z.string(),
});
export type DocxSectionDraft = z.infer<typeof DocxSectionDraftSchema>;

export const DocxReferenceStyleSchema = z.enum(['numbered', 'vancouver', 'author-year', 'unknown']);
export type DocxReferenceStyle = z.infer<typeof DocxReferenceStyleSchema>;

export const DocxReferenceDraftSchema = z.object({
  raw: z.string().min(1),
  style: DocxReferenceStyleSchema,
  /** Explicit or list-position number, for numbered/vancouver styles. */
  number: z.number().int().positive().nullable(),
  authors: z.array(z.string()),
  year: z.string().nullable(),
  title: z.string().nullable(),
  journal: z.string().nullable(),
  /** Parsed out of the entry text when it carries one; never fetched. */
  doi: z.string().min(1).nullable().default(null),
  citeKey: z.string().min(1),
});
export type DocxReferenceDraft = z.infer<typeof DocxReferenceDraftSchema>;

export const DocxFigureDraftSchema = z.object({
  /** Stable id used both as the figures/<id> directory name and as the
   *  `docx-image:<id>` placeholder token embedded in section markdown. */
  id: z.string().min(1),
  /** Absolute path to the extracted temp file (see DocxAnalysis.tempDir). */
  tempPath: z.string().min(1),
  ext: z.string().min(1),
  alt: z.string(),
});
export type DocxFigureDraft = z.infer<typeof DocxFigureDraftSchema>;

export const DocxCitationReportSchema = z.object({
  mappedCount: z.number().int().nonnegative(),
  literalCount: z.number().int().nonnegative(),
});
export type DocxCitationReport = z.infer<typeof DocxCitationReportSchema>;

export const DocxAnalysisSchema = z.object({
  sourcePath: z.string().min(1),
  /** Temp dir holding extracted images; null when the source had none.
   *  commit() copies out of it and best-effort removes it afterward. */
  tempDir: z.string().min(1).nullable(),
  title: z.object({ value: z.string().min(1).nullable(), reason: z.string() }),
  authors: z.array(DocxAuthorDraftSchema),
  authorsReason: z.string(),
  affiliations: z.array(DocxAffiliationDraftSchema),
  affiliationsReason: z.string(),
  abstract: z.object({ value: z.string().nullable(), reason: z.string() }),
  /** Title-page fields the manuscript stores separately from the prose. */
  significance: z
    .object({ value: z.string().nullable(), reason: z.string() })
    .default({ value: null, reason: 'not detected' }),
  highlights: z
    .object({ value: z.array(z.string().min(1)), reason: z.string() })
    .default({ value: [], reason: 'not detected' }),
  keywords: z
    .object({ value: z.array(z.string().min(1)), reason: z.string() })
    .default({ value: [], reason: 'not detected' }),
  sections: z.array(DocxSectionDraftSchema),
  references: z.array(DocxReferenceDraftSchema),
  citationReport: DocxCitationReportSchema,
  figures: z.array(DocxFigureDraftSchema),
  warnings: z.array(DocxWarningSchema),
});
export type DocxAnalysis = z.infer<typeof DocxAnalysisSchema>;
