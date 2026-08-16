import { z } from 'zod';
import {
  CaptionSchema,
  FigureNamespaceSchema,
  PanelSchema,
  WidthPresetSchema,
} from './figure';

/**
 * manuscript.json — the journal-agnostic METADATA source of truth.
 * RULE: numbering (figures, tables, equations, references, affiliations,
 * author markers) is NEVER stored; it is derived at format time from
 * array/tree order and the active publisher profile.
 *
 * As of feature-plan-7 §1 the prose is NOT here either: `manuscript/` is flat
 * and holds exactly manuscript.md (all prose, sections are Markdown
 * headings), manuscript.json (this), authors.json and references.bib. The
 * old `body` array of `sections/NN-name.md` pointers is gone — sections are
 * DERIVED from the Markdown with `outlineFromMarkdown` (@suna/markdown) —
 * and authors/affiliations moved to AuthorsFileSchema (./authors).
 */

// Re-exported for compatibility: these used to be declared here, and the
// whole workspace imports them from '@suna/core'.
export {
  AffiliationSchema,
  AuthorSchema,
  OrcidSchema,
  type Affiliation,
  type Author,
} from './authors';

export const ArticleTypeSchema = z.enum(['article', 'review', 'letter']);
export type ArticleType = z.infer<typeof ArticleTypeSchema>;

export const DoiSchema = z.string().regex(/^10\.\d{4,9}\/\S+$/);

export const OpenAccessSchema = z.object({
  license: z.string().min(1),
  copyrightHolder: z.string().min(1),
  year: z.number().int(),
});
export type OpenAccess = z.infer<typeof OpenAccessSchema>;

export const HistorySchema = z.object({
  received: z.iso.date().nullable(),
  accepted: z.iso.date().nullable(),
  publishedOnline: z.iso.date().nullable(),
});
export type History = z.infer<typeof HistorySchema>;

/**
 * Typographic heading rank as publisher profiles talk about it. No longer
 * stored anywhere — Markdown heading depth is the storage — but still the
 * vocabulary export/formatting speak: outline depth 1 → 'A', 2 → 'B',
 * 3+ → 'C-runin'.
 */
export const HeadingLevelSchema = z.enum(['A', 'B', 'C-runin']);
export type HeadingLevel = z.infer<typeof HeadingLevelSchema>;

export const ManuscriptFigureSchema = z.object({
  id: z.string().min(1),
  namespace: FigureNamespaceSchema,
  canvasRef: z.string().regex(/\.svg$/),
  widthPreset: WidthPresetSchema,
  caption: CaptionSchema,
  panels: z.array(PanelSchema),
});
export type ManuscriptFigure = z.infer<typeof ManuscriptFigureSchema>;

export const TableNamespaceSchema = z.enum(['main', 'extended-data']);
export type TableNamespace = z.infer<typeof TableNamespaceSchema>;

/** `pretypeset` = author-supplied LaTeX block accepted verbatim under a journal caption. */
export const TableSourceSchema = z.enum(['native', 'pretypeset']);
export type TableSource = z.infer<typeof TableSourceSchema>;

export const ManuscriptTableSchema = z.object({
  id: z.string().min(1),
  namespace: TableNamespaceSchema,
  source: TableSourceSchema,
  caption: z.object({
    title: z.string().min(1),
    body: z.string().optional(),
  }),
  footnotes: z.array(
    z.object({
      mark: z.string().min(1),
      text: z.string().min(1),
    }),
  ),
});
export type ManuscriptTable = z.infer<typeof ManuscriptTableSchema>;

export const AvailabilitySchema = z.object({
  data: z.string(),
  code: z.string(),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

export const BackMatterSchema = z.object({
  acknowledgements: z.string().nullable(),
  authorContributions: z.string().nullable(),
  funding: z.array(
    z.object({
      funder: z.string().min(1),
      grant: z.string().min(1).nullable(),
    }),
  ),
  competingInterests: z.string().nullable(),
  peerReview: z
    .object({
      statement: z.string().min(1),
      reviewers: z.array(z.string().min(1)),
    })
    .nullable(),
  supplementaryInfo: z.object({ doi: z.string().min(1) }).nullable(),
});
export type BackMatter = z.infer<typeof BackMatterSchema>;

export const ManuscriptSchema = z.object({
  title: z.string().min(1),
  shortTitle: z.string().min(1),
  articleType: ArticleTypeSchema,
  doi: DoiSchema.nullable(),
  openAccess: OpenAccessSchema.nullable(),
  history: HistorySchema,
  abstract: z.object({ content: z.string().min(1) }),
  /** Title-page extras; present or not depending on the user's needs. */
  significance: z.string().min(1).nullable().optional(),
  highlights: z.array(z.string().min(1)).nullable().optional(),
  /**
   * The prose file, relative to the manuscript directory. Data, not a
   * constant scattered through the code, so a project can rename it.
   */
  manuscriptFile: z.string().min(1).default('manuscript.md'),
  figures: z.array(ManuscriptFigureSchema),
  tables: z.array(ManuscriptTableSchema),
  availability: AvailabilitySchema,
  backMatter: BackMatterSchema,
  bibliography: z.string().regex(/\.bib$/),
});
export type Manuscript = z.infer<typeof ManuscriptSchema>;
