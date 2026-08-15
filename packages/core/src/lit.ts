import { z } from 'zod';

/**
 * Literature search — one normalized result shape across providers.
 * Ground truth probed 2026-08-14: Crossref works keyless with a polite
 * mailto; OpenAlex meters requests (HTTP 429 "Insufficient budget…") and is
 * only dependable with a key; NASA ADS needs a free key; arXiv is
 * best-effort. Errors are surfaced honestly, never as an empty result list.
 */

export const LIT_PROVIDER_IDS = ['crossref', 'openalex', 'ads', 'arxiv'] as const;

export const LitProviderIdSchema = z.enum(LIT_PROVIDER_IDS);
export type LitProviderId = z.infer<typeof LitProviderIdSchema>;

/**
 * Agent CLIs the 'ai-cli' provider can spawn (feature-plan-3 §2). Detection
 * and process management live in the main process
 * (apps/desktop/src/main/services/lit.ts); this is just the shared id type.
 */
export const LIT_CLI_IDS = ['claude', 'codex'] as const;
export const LitCliIdSchema = z.enum(LIT_CLI_IDS);
export type LitCliId = z.infer<typeof LitCliIdSchema>;

/** Settings key 'lit.cli': which CLI to prefer when more than one is installed. */
export const LIT_CLI_PREFERENCE_IDS = ['auto', ...LIT_CLI_IDS] as const;
export const LitCliPreferenceSchema = z.enum(LIT_CLI_PREFERENCE_IDS);
export type LitCliPreference = z.infer<typeof LitCliPreferenceSchema>;

/**
 * Every value a LitResult.source can carry: the four dispatchable HTTP
 * providers above (LitProviderId — what searchLiterature/lookupByDoi and the
 * MCP search_literature/lookup_doi tools switch on) plus 'ai-cli'. 'ai-cli'
 * is deliberately NOT a member of LitProviderId: it has no HTTP fetch path
 * (it spawns a child process from the main process instead), and the MCP
 * tools never dispatch to it — an agent already has its own web search, so
 * search_literature keeps only the API providers.
 */
export const LIT_RESULT_SOURCE_IDS = [...LIT_PROVIDER_IDS, 'ai-cli'] as const;
export const LitResultSourceSchema = z.enum(LIT_RESULT_SOURCE_IDS);
export type LitResultSource = z.infer<typeof LitResultSourceSchema>;

/**
 * Provider ids shown in the UI's provider picker: 'ai-cli' first (it becomes
 * the picker's default once a CLI is detected — apps/desktop main process),
 * then the four keyless/keyed HTTP APIs.
 */
export const UI_LIT_PROVIDER_IDS = ['ai-cli', ...LIT_PROVIDER_IDS] as const;
export const UiLitProviderIdSchema = z.enum(UI_LIT_PROVIDER_IDS);
export type UiLitProviderId = z.infer<typeof UiLitProviderIdSchema>;

export const AI_CLI_LABEL = 'AI search';

export interface LitProviderMeta {
  readonly label: string;
  /** Callable without a stored key. OpenAlex is keyless but metered. */
  readonly keyless: boolean;
  /** Shown next to the provider in the picker; plain, honest wording. */
  readonly note: string;
}

export const LIT_PROVIDER_META = {
  crossref: {
    label: 'Crossref',
    keyless: true,
    note: 'Keyless. Add an email in Settings for the polite pool.',
  },
  openalex: {
    label: 'OpenAlex',
    keyless: true,
    note: 'Metered — without budget or a key it answers HTTP 429.',
  },
  ads: {
    label: 'NASA ADS',
    keyless: false,
    note: 'Needs a free API key. Best source for astronomy.',
  },
  arxiv: {
    label: 'arXiv',
    keyless: true,
    note: 'Keyless, best-effort: the Atom feed can come back empty.',
  },
} as const satisfies Record<LitProviderId, LitProviderMeta>;

/** Normalized search hit. Every nullable field is null when unknown. */
export const LitResultSchema = z.object({
  source: LitResultSourceSchema,
  /** Provider-native id: DOI (crossref), work id (openalex), bibcode (ads), arXiv id. */
  id: z.string().min(1),
  doi: z.string().nullable(),
  title: z.string().min(1),
  /** Display names, already joined as "Given Family". */
  authors: z.array(z.string().min(1)),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  citedByCount: z.number().int().nullable(),
  openAccessUrl: z.string().nullable(),
  abstract: z.string().nullable(),
});
export type LitResult = z.infer<typeof LitResultSchema>;

/** Provider answer: results OR a human-readable error, never a silent empty list. */
export const LitSearchResponseSchema = z.object({
  results: z.array(LitResultSchema),
  error: z.string().nullable(),
});
export type LitSearchResponse = z.infer<typeof LitSearchResponseSchema>;

export const LitLookupResponseSchema = z.object({
  result: LitResultSchema.nullable(),
  error: z.string().nullable(),
});
export type LitLookupResponse = z.infer<typeof LitLookupResponseSchema>;
