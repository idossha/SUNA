import { z } from 'zod';
import { LitResultSchema } from './lit';

/**
 * Study acquisition — the shared vocabulary for turning a mention into a
 * PDF-backed citation (feature-plan-10 §Layer 1). Three parties speak it: the
 * pure matchers in @suna/bib, the disk scanner and MCP verbs in @suna/agent,
 * and the desktop Settings / References surfaces. It lives here, in the one
 * package both hosts already depend on, so none of them can drift.
 *
 * Two rules run through everything below. Reads may leave the project (that
 * is the point — the PDF is somewhere on this machine) but only inside roots
 * the user configured; writes never do. And every answer is honest: a
 * provider that failed is an `error` string, never an empty list; a match
 * carries the evidence that produced it; an ambiguous resolution says so
 * instead of picking the first hit.
 */

/**
 * Machine-level library settings live in `sunaConfigDir()/library.json`
 * (`~/SunaConfig`, `$SUNA_CONFIG_DIR` overrides) — deliberately NOT in the
 * desktop app's userData/settings.json, because the standalone MCP server has
 * no userData and must read the same roots the Settings pane writes.
 */
export const LIBRARY_CONFIG_FILENAME = 'library.json';

/**
 * Portable, `~`-prefixed; the host expands them at use time. Never store
 * absolutes here: the file is hand-editable and follows a user between
 * machines whose `$HOME` differ. All four defaults sit under `$HOME`, which
 * is what keeps the default scan inside the user's own files.
 */
export const DEFAULT_LIBRARY_ROOTS = [
  '~/Downloads',
  '~/Documents',
  '~/Zotero/storage',
  '~/Papers',
] as const;

/**
 * How far a download may go, in ascending order of reach:
 * - `off` — never fetch bytes; `metadata-only` is the best possible outcome.
 * - `open-access` — arXiv/bioRxiv PDF URLs, a `.pdf` `openAccessUrl`, and
 *   Unpaywall's `best_oa_location`.
 * - `publisher` — additionally follow `https://doi.org/<doi>` and read the
 *   landing page's `citation_pdf_url` meta tag (the Google-Scholar tag).
 *
 * `publisher` is the user's pick (decision table, 2026-08-18). No policy ever
 * attempts paywall circumvention — no Sci-Hub, no institutional proxy, no
 * credential replay; a 403 is reported as a 403.
 */
export const DOWNLOAD_POLICIES = ['off', 'open-access', 'publisher'] as const;
export const DownloadPolicySchema = z.enum(DOWNLOAD_POLICIES);
export type DownloadPolicy = z.infer<typeof DownloadPolicySchema>;

export const LibraryConfigSchema = z.object({
  schemaVersion: z.literal(1),
  /** `~`-prefixed or absolute; a root that does not exist is dropped and reported, never an error. */
  roots: z.array(z.string().min(1)),
  /** macOS only (`mdfind`). Ignored elsewhere rather than rejected, so one file stays portable. */
  useSpotlight: z.boolean(),
  download: DownloadPolicySchema,
  /** Bounds on the bounded walk. The ceiling guards a misconfigured root like `~` itself. */
  maxDepth: z.number().int().min(1).max(12),
  maxFilesScanned: z.number().int().min(100).max(200_000),
});
export type LibraryConfig = z.infer<typeof LibraryConfigSchema>;

/**
 * What a machine with no `library.json` behaves like — also the fallback the
 * loader returns for an unreadable or unparseable file (Layer 3 `config.ts`
 * never throws). Spread, not aliased: callers patch fields freely.
 */
export const DEFAULT_LIBRARY_CONFIG: LibraryConfig = {
  schemaVersion: 1,
  roots: [...DEFAULT_LIBRARY_ROOTS],
  useSpotlight: true,
  download: 'publisher',
  maxDepth: 6,
  maxFilesScanned: 20_000,
};

/**
 * Why a file on disk is believed to be a given paper. Two tiers, and the tier
 * is what the confidence rules key on:
 *
 * - byte-level (`*-in-bytes`, `spotlight-content-hit`) — read from the file's
 *   own first bytes. Publisher PDFs carry their XMP metadata as UNCOMPRESSED
 *   XML, so a raw-byte search for the DOI is genuinely effective and needs no
 *   PDF parser; Spotlight's `kMDItemTextContent` is the indexer having done
 *   the same read.
 * - filename-level (`filename-*`) — cheap, and wrong often enough that it can
 *   never reach `high` on its own.
 */
export const PDF_EVIDENCE_IDS = [
  'doi-in-bytes',
  'arxiv-id-in-bytes',
  'title-in-bytes',
  'filename-doi',
  'filename-arxiv-id',
  'filename-author-year',
  'filename-title-words',
  'spotlight-content-hit',
] as const;
export const PdfEvidenceIdSchema = z.enum(PDF_EVIDENCE_IDS);
export type PdfEvidenceId = z.infer<typeof PdfEvidenceIdSchema>;

/**
 * One confidence ladder for both halves of the feature, because both are the
 * same question — "is this the thing the user meant?" — and the caller acts
 * the same way on `low`: report the ambiguity, do not write.
 *
 * For a PDF: `high` requires at least one byte-level or DOI-level hit; a
 * filename-only match never exceeds `medium`; title-words-only is `low`.
 * For a resolution: `low` when the top two scores are within 10 %, or the
 * best title similarity is under 0.5.
 */
export const MATCH_CONFIDENCE = ['high', 'medium', 'low'] as const;
export const MatchConfidenceSchema = z.enum(MATCH_CONFIDENCE);
export type MatchConfidence = z.infer<typeof MatchConfidenceSchema>;

export const PdfMatchSchema = z.object({
  /** Absolute path on this machine. Always inside a configured root — the read boundary. */
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  confidence: MatchConfidenceSchema,
  /** At least one: a match with no evidence is a guess, and guesses are not returned. */
  evidence: z.array(PdfEvidenceIdSchema).min(1),
});
export type PdfMatch = z.infer<typeof PdfMatchSchema>;

/**
 * The four acquisition outcomes, in the strict preference order the ladder
 * tries them, and the agent must always name which one happened.
 *
 * `unresolved` is absent on purpose: it is a failure to identify the WORK,
 * not a way of acquiring a PDF, and it is carried by
 * `StudyResolution.chosen === null` instead.
 */
export const PDF_ACQUISITIONS = [
  'already-present',
  'copied-local',
  'downloaded',
  'metadata-only',
] as const;
export const PdfAcquisitionSchema = z.enum(PDF_ACQUISITIONS);
export type PdfAcquisition = z.infer<typeof PdfAcquisitionSchema>;

/**
 * One mention resolved against every provider that answered.
 *
 * `chosen` is null when nothing matched — and `errors` is what keeps that
 * honest: a 429 from OpenAlex is a provider failure, never evidence that no
 * such paper exists. `alternatives` is always populated when the ranking was
 * close, so a `low` result can be reported as the ambiguity it is; on `low`
 * the composite `cite_study` verb returns those alternatives and writes
 * nothing, because guessing on the user's behalf is the one thing this
 * feature must not do.
 */
export const StudyResolutionSchema = z.object({
  chosen: LitResultSchema.nullable(),
  /** 'low' whenever `chosen` is null, so callers can branch on confidence alone. */
  confidence: MatchConfidenceSchema,
  /** Runners-up, best first, excluding `chosen`. Empty when the win was outright. */
  alternatives: z.array(LitResultSchema),
  /**
   * Every provider the search dispatched to, whether or not it answered.
   * Plain strings rather than LitResultSource ids: a host-specific search path
   * (an AI CLI, a future provider) must be able to name itself here.
   */
  providersTried: z.array(z.string().min(1)),
  /** Per-provider failures, human-readable. Empty means every provider answered. */
  errors: z.array(z.string().min(1)),
});
export type StudyResolution = z.infer<typeof StudyResolutionSchema>;
