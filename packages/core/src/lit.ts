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
  source: LitProviderIdSchema,
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
