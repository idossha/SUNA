import { z } from 'zod';

/**
 * Publisher profile v2 — author-guideline model (ADR-002).
 *
 * A profile encodes what a journal's published author guidelines actually
 * state: citation/reference formatting, figure design rules, manuscript
 * limits. It does NOT describe typeset page design. `null` on any rule means
 * "the journal does not state this" — checkers skip null rules rather than
 * inventing thresholds. Each section carries the official source URLs it was
 * extracted from.
 *
 * Consumers: citations → @suna/bib; figures → canvas + suna_mpl + checker;
 * manuscript → manuscript editor + checker; all → export dialog.
 */

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
  sources: z.array(z.url()),
});
export type ManuscriptRules = z.infer<typeof ManuscriptRulesSchema>;

export const PublisherProfileSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  journalName: z.string().min(1),
  publisher: z.string().min(1),
  lastVerified: z.iso.date(),
  citations: CitationRulesSchema,
  figures: FigureRulesSchema,
  manuscript: ManuscriptRulesSchema,
  notes: z.array(z.string()),
});
export type PublisherProfile = z.infer<typeof PublisherProfileSchema>;
