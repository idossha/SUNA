import { z } from 'zod';

/**
 * Publisher profile v3 — author-guideline model (ADR-002).
 *
 * A profile encodes what a journal's published author guidelines actually
 * state: citation/reference formatting, figure design rules, manuscript
 * limits. It does NOT describe typeset page design. `null` on any rule means
 * "the journal does not state this" — checkers skip null rules rather than
 * inventing thresholds. Each section carries the official source URLs it was
 * extracted from.
 *
 * v3 additions:
 * - per-section `provenance`: how each encoded value is known — stated in
 *   the guidelines ('documented'), measured from published output
 *   ('counted-empirically'), or filled in from convention ('inferred').
 * - top-level `extends`: id of a base profile, resolved at load time by the
 *   formatter loader (deep merge; child overrides, arrays replace).
 * - manuscript `stageSeverity`: per-submission-stage severity override for
 *   limit checks (journals that ignore formatting at initial submission).
 *
 * Consumers: citations → @suna/bib; figures → canvas + suna_mpl + checker;
 * manuscript → manuscript editor + checker; all → export dialog.
 */

const PROFILE_ID_RE = /^[a-z][a-z0-9-]*$/;
export const ProfileIdSchema = z.string().regex(PROFILE_ID_RE);

/**
 * How a profile value is known. 'documented' = stated verbatim in the
 * journal's author guidelines; 'counted-empirically' = measured from the
 * journal's published output (which can diverge from its own guidelines);
 * 'inferred' = not stated anywhere, filled in from family convention.
 */
export const ProvenanceBasisSchema = z.enum([
  'documented',
  'counted-empirically',
  'inferred',
]);
export type ProvenanceBasis = z.infer<typeof ProvenanceBasisSchema>;

/** `source: null` = no citable URL (typical for 'inferred' claims). */
export const ProvenanceEntrySchema = z.object({
  claim: z.string().min(1),
  basis: ProvenanceBasisSchema,
  source: z.url().nullable(),
});
export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;

export const SubmissionStageSchema = z.enum([
  'initial-submission',
  'revision',
  'accepted',
]);
export type SubmissionStage = z.infer<typeof SubmissionStageSchema>;

export const LimitSeveritySchema = z.enum(['error', 'warning']);
export type LimitSeverity = z.infer<typeof LimitSeveritySchema>;

/**
 * Per-stage severity override applied by the manuscript checker to LIMIT
 * diagnostics (word/character/item/reference counts). A missing stage keeps
 * each limit's intrinsic severity; structural checks (missing sections,
 * availability statements) are never remapped.
 */
export const StageSeveritySchema = z.partialRecord(
  SubmissionStageSchema,
  LimitSeveritySchema,
);
export type StageSeverity = z.infer<typeof StageSeveritySchema>;

export const CitationModeSchema = z.enum([
  'numeric-superscript',
  'author-year',
  'parenthetical-numeric',
]);
export type CitationMode = z.infer<typeof CitationModeSchema>;

export const AuthorYearRulesSchema = z.object({
  includeInitials: z.boolean().nullable(),
  twoAuthorJoiner: z.string().min(1).nullable(),
  etAlFromNAuthors: z.number().int().positive().nullable(),
  sameYearSuffixes: z.boolean().nullable(),
});
export type AuthorYearRules = z.infer<typeof AuthorYearRulesSchema>;

/** Entry templates use slot syntax: "{authors} {year}, {journalAbbrev}, {volume}, {firstPage}". */
export const ReferenceListRulesSchema = z.object({
  entryTemplates: z.object({
    article: z.string().min(1).nullable(),
    book: z.string().min(1).nullable(),
    preprint: z.string().min(1).nullable(),
    software: z.string().min(1).nullable(),
  }),
  authorTruncation: z.object({
    etAlAllowed: z.boolean().nullable(),
    truncateWhenMoreThan: z.number().int().positive().nullable(),
    keepFirstN: z.number().int().positive().nullable(),
  }),
  journalAbbreviation: z.enum(['iso4', 'ads', 'full']).nullable(),
  doiPolicy: z.string().min(1).nullable(),
  sortOrder: z.enum(['appearance', 'alphabetical']),
});
export type ReferenceListRules = z.infer<typeof ReferenceListRulesSchema>;

export const CitationRulesSchema = z.object({
  mode: CitationModeSchema,
  collapseRanges: z.boolean(),
  textualTokens: z.object({ ref: z.string().min(1), refs: z.string().min(1) }),
  authorYear: AuthorYearRulesSchema.nullable(),
  referenceList: ReferenceListRulesSchema,
  maxReferences: z.number().int().positive().nullable(),
  sources: z.array(z.url()),
  provenance: z.array(ProvenanceEntrySchema).optional(),
});
export type CitationRules = z.infer<typeof CitationRulesSchema>;

export const PaletteRulesSchema = z.object({
  requirement: z.enum([
    'colorblind-safe-required',
    'colorblind-safe-recommended',
    'none-stated',
  ]),
  suggestedRamps: z.array(z.string().min(1)),
  suggestedHex: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).nullable(),
  colorAsSoleDelimiter: z.enum(['allowed', 'discouraged', 'forbidden']).nullable(),
  redGreenDiscouraged: z.boolean().nullable(),
});
export type PaletteRules = z.infer<typeof PaletteRulesSchema>;

export const FigureRulesSchema = z.object({
  widthPresetsMm: z.object({
    single: z.number().positive().nullable(),
    onehalf: z.number().positive().nullable(),
    double: z.number().positive().nullable(),
  }),
  maxHeightMm: z.number().positive().nullable(),
  minFontPt: z.number().positive().nullable(),
  maxFontPt: z.number().positive().nullable(),
  lineWeightPt: z.object({
    min: z.number().positive().nullable(),
    max: z.number().positive().nullable(),
  }),
  preferredFontFamilies: z.array(z.string().min(1)).nullable(),
  palette: PaletteRulesSchema,
  formats: z.object({
    vectorPreferred: z.array(z.string().min(1)),
    rasterAccepted: z.array(z.string().min(1)),
    minDpi: z.number().int().positive().nullable(),
  }),
  panelLabel: z.object({
    letterCase: z.enum(['lower', 'upper']).nullable(),
    weight: z.enum(['bold', 'regular']).nullable(),
    wrapper: z.enum(['parens', 'none']).nullable(),
  }),
  sources: z.array(z.url()),
  provenance: z.array(ProvenanceEntrySchema).optional(),
});
export type FigureRules = z.infer<typeof FigureRulesSchema>;

export const WordLimitSchema = z.object({
  max: z.number().int().positive(),
  scope: z.string().min(1),
  hard: z.boolean(),
});
export type WordLimit = z.infer<typeof WordLimitSchema>;

export const ArticleTypeRulesSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  wordLimit: WordLimitSchema.nullable(),
  abstractWordLimit: z.number().int().positive().nullable(),
  titleLimitChars: z.number().int().positive().nullable(),
  maxDisplayItems: z.number().int().positive().nullable(),
  maxReferences: z.number().int().positive().nullable(),
});
export type ArticleTypeRules = z.infer<typeof ArticleTypeRulesSchema>;

export const RequiredSectionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
});
export type RequiredSection = z.infer<typeof RequiredSectionSchema>;

export const ManuscriptRulesSchema = z.object({
  articleTypes: z.array(ArticleTypeRulesSchema).min(1),
  runningHeadLimitChars: z.number().int().positive().nullable(),
  requiredSections: z.array(RequiredSectionSchema),
  availabilityStatements: z.object({
    data: z.boolean().nullable(),
    code: z.boolean().nullable(),
  }),
  submissionFormat: z.object({
    doubleSpacing: z.boolean().nullable(),
    lineNumbers: z.boolean().nullable(),
    acceptedFileTypes: z.array(z.string().min(1)),
  }),
  stageSeverity: StageSeveritySchema.optional(),
  sources: z.array(z.url()),
  provenance: z.array(ProvenanceEntrySchema).optional(),
});
export type ManuscriptRules = z.infer<typeof ManuscriptRulesSchema>;

/**
 * Document TYPOGRAPHY — how the exported manuscript is set on the page, as
 * opposed to the rules a journal states (which is what every other block in
 * this schema carries).
 *
 * Deliberately optional and deliberately separate. Journal profiles leave it
 * absent, because the published author guidelines this project is built from
 * (ADR-002) do not state page geometry or point sizes for the *submitted
 * manuscript* — inventing them per journal would be exactly the kind of guess
 * this codebase refuses to make. It exists so a HOUSE style can state them:
 * `suna.json` sets every field, which is what makes "SUNA style" a real,
 * reproducible layout rather than a set of magic numbers buried in the DOCX
 * writer.
 *
 * Sizes are in POINTS and lengths in MILLIMETRES — the units the writers
 * already think in — and are converted at the edge (half-points/twips for
 * OOXML, CSS units for HTML) so the two renderers cannot drift apart.
 */
export const DocumentStyleSchema = z.object({
  /** Human-readable name shown in the export dialog, e.g. "SUNA style". */
  name: z.string().min(1),
  page: z.object({
    widthMm: z.number().positive(),
    heightMm: z.number().positive(),
    marginMm: z.number().nonnegative(),
  }),
  fonts: z.object({
    body: z.string().min(1),
    mono: z.string().min(1),
  }),
  /** Point sizes for each role. */
  sizesPt: z.object({
    body: z.number().positive(),
    title: z.number().positive(),
    author: z.number().positive(),
    affiliation: z.number().positive(),
    heading1: z.number().positive(),
    heading2: z.number().positive(),
    caption: z.number().positive(),
    reference: z.number().positive(),
    tableCell: z.number().positive(),
    footer: z.number().positive(),
  }),
  /** Multiple of single spacing applied to every paragraph, e.g. 1.15. */
  lineSpacing: z.number().positive(),
  /** Space after a body paragraph, in points. */
  bodySpaceAfterPt: z.number().nonnegative(),
  /** Reference-list hanging indent, in millimetres. */
  referenceHangingMm: z.number().nonnegative(),
  /** Default figure width when the profile states no preset width, in millimetres. */
  figureWidthMm: z.number().positive(),
  /** Where a figure caption sits relative to its image. */
  figureCaptionPosition: z.enum(['above', 'below']),
  /** Where a table caption sits relative to its table. */
  tableCaptionPosition: z.enum(['above', 'below']),
  /** Start the body on a fresh page after the front matter. */
  pageBreakAfterFrontMatter: z.boolean(),
});
export type DocumentStyle = z.infer<typeof DocumentStyleSchema>;

export const PublisherProfileSchema = z.object({
  schemaVersion: z.literal(3),
  id: ProfileIdSchema,
  /** Base profile id; the formatter loader deep-merges it in (child overrides, arrays replace). */
  extends: ProfileIdSchema.optional(),
  journalName: z.string().min(1),
  publisher: z.string().min(1),
  lastVerified: z.iso.date(),
  citations: CitationRulesSchema,
  figures: FigureRulesSchema,
  manuscript: ManuscriptRulesSchema,
  /** Present only on house styles; see DocumentStyleSchema. */
  documentStyle: DocumentStyleSchema.optional(),
  notes: z.array(z.string()),
});
export type PublisherProfile = z.infer<typeof PublisherProfileSchema>;
