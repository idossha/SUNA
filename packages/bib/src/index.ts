export type { Author, BibEntry, LiteralAuthor, PersonAuthor, Run, RunLink } from './model.js';
export { detectArxivId } from './model.js';
export type { ParseIssue, ParseResult } from './parse.js';
export { parseBibtex } from './parse.js';
export { serializeBibtex, serializeEntry } from './serialize.js';
export type { CitationCluster, CitationMode, CitationStyleConfig, CiteRendering } from './cite.js';
export { assignNumbers, renderCluster } from './cite.js';
export type { BibFormatConfig } from './format.js';
export { formatReference } from './format.js';
export { generateCiteKey, litResultToBibEntry } from './lit-entry.js';
export type { LitLookupOutcome, LitRequestOptions, LitSearchOutcome } from './providers.js';
export { lookupByDoi, searchLiterature } from './providers.js';
export type { AiCliOutcome } from './providers.js';
export {
  codexProgressFromLine,
  parseAiCliText,
  parseClaudeCliOutput,
  parseCodexCliOutput
} from './providers.js';
export type { AppendLitResultOptions, AppendLitResultOutcome, RemoveEntryOutcome } from './bib-write.js';
export { appendLitResultToBib, findExistingKey, removeEntryFromBib } from './bib-write.js';
export type { PdfResolution, PdfResolutionHow, ResolvePdfOptions } from './pdf.js';
export { pdfPathFromFileField, resolvePdfPath } from './pdf.js';
export type { MentionHints, RankedCandidate, StudyResolutionContext } from './study-match.js';
export { mergeCandidates, parseMention, rankCandidates, resolveStudy } from './study-match.js';
export type {
  PdfCandidate,
  PdfCandidateScore,
  RankedPdfCandidate,
  SpotlightContentHit
} from './pdf-match.js';
export {
  BYTES_TITLE_TOKEN_RATIO,
  FILENAME_TITLE_TOKEN_RATIO,
  rankPdfCandidates,
  scorePdfCandidate
} from './pdf-match.js';
export {
  HTML_SNIFF_WINDOW_BYTES,
  PDF_MAGIC_WINDOW_BYTES,
  PDF_SAMPLE_BYTES,
  asciiSample,
  isPdfBytes,
  looksLikeHtml
} from './pdf-bytes.js';
export type {
  PdfDownloadOutcome,
  PdfFetchOptions,
  PdfUrlCandidate,
  PdfUrlKind,
  PdfUrlPlan,
  PdfFailureKind,
  PdfUrlVia
} from './pdf-fetch.js';
export {
  PDF_FAILURE_KINDS,
  PDF_MAX_BYTES,
  PDF_URL_VIAS,
  citationPdfUrlFromHtml,
  describePdfFailure,
  openAlexMirrorUrls,
  downloadPdf,
  pdfUrlCandidates,
  pdfUrlPlan
} from './pdf-fetch.js';
