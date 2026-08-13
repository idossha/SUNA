import { z } from 'zod';
import { FigureNamespaceSchema } from './figure';
import { HeadingLevelSchema } from './manuscript';

const MmSchema = z.number().positive();
const PtSchema = z.number().positive();

export const FolioModeSchema = z.enum(['continuing', 'none', 'outer-margin-bold']);
export type FolioMode = z.infer<typeof FolioModeSchema>;

export const PageGeometrySchema = z.object({
  trimMm: z.object({ w: MmSchema, h: MmSchema }),
  marginsMm: z.object({
    top: MmSchema,
    bottom: MmSchema,
    inner: MmSchema,
    outer: MmSchema,
  }),
  columns: z.number().int().positive(),
  columnWidthMm: MmSchema,
  gutterMm: MmSchema,
  textBlockWidthMm: MmSchema,
  folio: z.object({
    mode: FolioModeSchema,
    start: z.number().int().positive().nullable(),
  }),
});
export type PageGeometry = z.infer<typeof PageGeometrySchema>;

export const FontFamilyRoleSchema = z.enum(['serif', 'sans', 'mono']);
export type FontFamilyRole = z.infer<typeof FontFamilyRoleSchema>;

export const FontWeightSchema = z.enum(['regular', 'medium', 'bold']);
export type FontWeight = z.infer<typeof FontWeightSchema>;

export const TypeStyleSchema = z.object({
  family: FontFamilyRoleSchema,
  sizePt: PtSchema,
  weight: FontWeightSchema,
});
export type TypeStyle = z.infer<typeof TypeStyleSchema>;

export const TypographySchema = z.object({
  body: TypeStyleSchema.extend({
    justified: z.boolean(),
    hyphenation: z.boolean(),
  }),
  headings: TypeStyleSchema,
  title: TypeStyleSchema,
  abstract: TypeStyleSchema,
  caption: TypeStyleSchema,
  references: TypeStyleSchema,
  affiliations: TypeStyleSchema,
  dropCap: z.object({
    enabled: z.boolean(),
    lines: z.number().int().positive(),
    scope: z.literal('first-paragraph-only'),
  }),
});
export type Typography = z.infer<typeof TypographySchema>;

export const HeadingLevelStyleSchema = z.object({
  sizePt: PtSchema,
  weight: FontWeightSchema,
  runIn: z.boolean(),
  terminator: z.string().nullable(),
});
export type HeadingLevelStyle = z.infer<typeof HeadingLevelStyleSchema>;

export const HeadingLevelsSchema = z.record(HeadingLevelSchema, HeadingLevelStyleSchema);
export type HeadingLevels = z.infer<typeof HeadingLevelsSchema>;

export const MastheadStyleSchema = z.enum(['rule-bands', 'banner']);
export type MastheadStyle = z.infer<typeof MastheadStyleSchema>;

export const AbstractStyleSchema = z.enum(['rule-delimited-block', 'standfirst']);
export type AbstractStyle = z.infer<typeof AbstractStyleSchema>;

export const AffiliationsPlacementSchema = z.enum(['footnote-page1', 'deferred-end']);
export type AffiliationsPlacement = z.infer<typeof AffiliationsPlacementSchema>;

export const FrontMatterConfigSchema = z.object({
  masthead: z.object({
    style: MastheadStyleSchema,
    showOpenAccessBadge: z.boolean(),
    showArticleType: z.boolean(),
    showDoiStrip: z.boolean(),
  }),
  historyRail: z.object({
    enabled: z.boolean(),
    widthPercent: z.number().min(0).max(100),
    showCheckForUpdatesBadge: z.boolean(),
  }),
  abstractStyle: AbstractStyleSchema,
  affiliationsPlacement: AffiliationsPlacementSchema,
});
export type FrontMatterConfig = z.infer<typeof FrontMatterConfigSchema>;

export const HeaderModeSchema = z.enum(['uniform', 'mirrored', 'none']);
export type HeaderMode = z.infer<typeof HeaderModeSchema>;

/** Templates use tokens: {journal} {volume} {month} {year} {firstPage} {lastPage} {doi} {articleType}. */
export const RunningPageSchema = z.object({
  header: z.object({
    mode: HeaderModeSchema,
    template: z.string().nullable(),
  }),
  footer: z.object({
    template: z.string().nullable(),
  }),
});
export type RunningPage = z.infer<typeof RunningPageSchema>;

export const SectionOrderKindSchema = z.enum([
  'body',
  'back-matter',
  'references',
  'affiliations',
  'extended-data',
]);
export type SectionOrderKind = z.infer<typeof SectionOrderKindSchema>;

export const SectionOrderEntrySchema = z.object({
  id: z.string().min(1),
  kind: SectionOrderKindSchema,
  required: z.boolean(),
});
export type SectionOrderEntry = z.infer<typeof SectionOrderEntrySchema>;

export const PanelLetterStyleSchema = z.enum(['bold-lowercase', 'parenthesized']);
export type PanelLetterStyle = z.infer<typeof PanelLetterStyleSchema>;

export const CaptionStyleSchema = z.object({
  figureLabel: z.string().min(1),
  separator: z.string().min(1),
  panelLetterStyle: PanelLetterStyleSchema,
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const TableStyleSchema = z.object({
  label: z.string().min(1),
  separator: z.string().min(1),
  headerBand: z.boolean(),
  zebraStriping: z.boolean(),
  rules: z.enum(['horizontal-only', 'full-grid']),
  footnoteSizePt: PtSchema,
});
export type TableStyle = z.infer<typeof TableStyleSchema>;

export const EquationNumberingSchema = z.enum(['continuous', 'per-section']);
export type EquationNumbering = z.infer<typeof EquationNumberingSchema>;

export const CitationModeSchema = z.enum([
  'numeric-superscript',
  'author-year',
  'parenthetical-numeric',
]);
export type CitationMode = z.infer<typeof CitationModeSchema>;

export const CitationConfigSchema = z.object({
  mode: CitationModeSchema,
  collapseRanges: z.boolean(),
  textualTokens: z.object({
    ref: z.string().min(1),
    refs: z.string().min(1),
  }),
});
export type CitationConfig = z.infer<typeof CitationConfigSchema>;

export const InitialsStyleSchema = z.enum(['period-space', 'period', 'none']);
export type InitialsStyle = z.infer<typeof InitialsStyleSchema>;

export const BibliographyFormatSchema = z.object({
  authorTruncation: z.number().int().positive(),
  initialsStyle: InitialsStyleSchema,
  abbreviateJournals: z.boolean(),
});
export type BibliographyFormat = z.infer<typeof BibliographyFormatSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const BrandColorsSchema = z.object({
  accent: HexColorSchema,
  link: HexColorSchema,
  banner: HexColorSchema.nullable(),
});
export type BrandColors = z.infer<typeof BrandColorsSchema>;

export const NamespacePlacementSchema = z.enum([
  'in-flow',
  'one-per-page-back-matter',
  'external-link-out',
  'in-box',
]);
export type NamespacePlacement = z.infer<typeof NamespacePlacementSchema>;

export const NamespaceConfigSchema = z.object({
  figureLabel: z.string().min(1),
  tableLabel: z.string().min(1).nullable(),
  placement: NamespacePlacementSchema,
});
export type NamespaceConfig = z.infer<typeof NamespaceConfigSchema>;

export const NamespacesConfigSchema = z.record(FigureNamespaceSchema, NamespaceConfigSchema);
export type NamespacesConfig = z.infer<typeof NamespacesConfigSchema>;

export const PublisherProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  page: PageGeometrySchema,
  typography: TypographySchema,
  headingLevels: HeadingLevelsSchema,
  frontMatter: FrontMatterConfigSchema,
  runningPage: RunningPageSchema,
  sectionOrder: z.array(SectionOrderEntrySchema),
  captionStyle: CaptionStyleSchema,
  tableStyle: TableStyleSchema,
  equationNumbering: EquationNumberingSchema,
  citation: CitationConfigSchema,
  bibliographyFormat: BibliographyFormatSchema,
  figureWidthPresetsMm: z.object({ single: MmSchema, double: MmSchema }),
  colors: BrandColorsSchema,
  namespaces: NamespacesConfigSchema,
});
export type PublisherProfile = z.infer<typeof PublisherProfileSchema>;
