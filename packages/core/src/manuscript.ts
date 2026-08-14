import { z } from 'zod';
import {
  CaptionSchema,
  FigureNamespaceSchema,
  PanelSchema,
  WidthPresetSchema,
} from './figure';

/**
 * manuscript.json — the journal-agnostic source of truth.
 * RULE: numbering (figures, tables, equations, references, affiliations,
 * author markers) is NEVER stored; it is derived at format time from
 * array/tree order and the active publisher profile.
 */

export const ArticleTypeSchema = z.enum(['article', 'review', 'letter']);
export type ArticleType = z.infer<typeof ArticleTypeSchema>;

export const DoiSchema = z.string().regex(/^10\.\d{4,9}\/\S+$/);

export const OpenAccessSchema = z.object({
  license: z.string().min(1),
  copyrightHolder: z.string().min(1),
  year: z.number().int(),
});
export type OpenAccess = z.infer<typeof OpenAccessSchema>;

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

export const HistorySchema = z.object({
  received: z.iso.date().nullable(),
  accepted: z.iso.date().nullable(),
  publishedOnline: z.iso.date().nullable(),
});
export type History = z.infer<typeof HistorySchema>;

export const HeadingLevelSchema = z.enum(['A', 'B', 'C-runin']);
export type HeadingLevel = z.infer<typeof HeadingLevelSchema>;

/** Section prose lives in sections/*.md files, never inline. */
export const SectionContentPathSchema = z.string().regex(/^sections\/.+\.md$/);

/** `heading: null` = unheaded block (intro before Results); never synthesized. */
export const SectionNodeSchema = z.object({
  kind: z.literal('section'),
  heading: z.string().min(1).nullable(),
  level: HeadingLevelSchema,
  content: SectionContentPathSchema.nullable(),
  get children() {
    return z.array(SectionNodeSchema);
  },
});
export type SectionNode = z.infer<typeof SectionNodeSchema>;

export const BoxNodeSchema = z.object({
  kind: z.literal('box'),
  id: z.string().min(1),
  title: z.string().min(1),
  content: SectionContentPathSchema,
  figureRefs: z.array(z.string().min(1)),
});
export type BoxNode = z.infer<typeof BoxNodeSchema>;

export const BodyNodeSchema = z.discriminatedUnion('kind', [
  SectionNodeSchema,
  BoxNodeSchema,
]);
export type BodyNode = z.infer<typeof BodyNodeSchema>;

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
  authors: z.array(AuthorSchema).min(1),
  affiliations: z.array(AffiliationSchema),
  history: HistorySchema,
  abstract: z.object({ content: z.string().min(1) }),
  /** Title-page extras; present or not depending on the user's needs. */
  significance: z.string().min(1).nullable().optional(),
  highlights: z.array(z.string().min(1)).nullable().optional(),
  body: z.array(BodyNodeSchema).min(1),
  figures: z.array(ManuscriptFigureSchema),
  tables: z.array(ManuscriptTableSchema),
  availability: AvailabilitySchema,
  backMatter: BackMatterSchema,
  bibliography: z.string().regex(/\.bib$/),
});
export type Manuscript = z.infer<typeof ManuscriptSchema>;
