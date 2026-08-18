import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import {
  DownloadPolicySchema,
  LIT_PROVIDER_IDS,
  LitProviderIdSchema,
  type DownloadPolicy,
  type LibraryConfig,
  type LitProviderId,
  type LitResult,
  type PdfAcquisition,
  type PdfMatch,
  type StudyResolution
} from '@suna/core'
import {
  appendLitResultToBib,
  detectArxivId,
  downloadPdf,
  findExistingKey,
  litResultToBibEntry,
  lookupByDoi,
  mergeCandidates,
  parseBibtex,
  describePdfFailure,
  parseMention,
  resolvePdfPath,
  resolveStudy,
  searchLiterature,
  type BibEntry,
  type LitLookupOutcome,
  type LitRequestOptions,
  type LitSearchOutcome,
  type MentionHints,
  type PdfDownloadOutcome,
  type PdfFetchOptions
} from '@suna/bib'
import {
  describeExternalError,
  errorCode,
  loadLibraryConfig,
  type LibraryConfigOutcome
} from '../library/config'
import {
  findLocalPdf,
  importPdfIntoProject,
  isAutoCopyable,
  quoteExternalPath,
  savePdfBytes,
  type FindLocalPdfOptions,
  type FindLocalPdfResult
} from '../library/scan'
import { resolveInside, type ProjectContext } from './project'

/**
 * Study acquisition — the four verbs that carry a free-text mention all the
 * way to a PDF-backed citation (feature-plan-10 §Layer 4): `find_study`,
 * `find_local_pdf`, `fetch_pdf`, `cite_study`.
 *
 * Same host constraints as lit.ts, and for the same reason: this server runs
 * standalone, outside Electron, with no access to the app's encrypted key
 * store (safeStorage). Every call here is therefore KEYLESS — Crossref,
 * bioRxiv/medRxiv and arXiv answer as normal, OpenAlex runs metered and will
 * answer HTTP 429 without budget. That is exactly why `find_study` asks all
 * four providers at once and reports each one's failure by name: a metered
 * 429 from OpenAlex must never reach the user as "no such paper". The one
 * piece of configuration that is read from the environment is
 * `$SUNA_CONTACT_EMAIL` — Crossref's polite pool likes it and Unpaywall's
 * keyless API requires it, so without it the Unpaywall rung of the download
 * ladder is skipped and says so.
 *
 * The library roots come from `~/SunaConfig/library.json` (Layer 3's
 * `loadLibraryConfig`), NOT from Electron userData, so the folders this
 * server searches are the same ones the app's Settings pane wrote.
 *
 * The security boundary the plan states plainly, restated where it is
 * enforced: reads may leave the project (only into the configured roots),
 * writes may not. Every write goes through `resolveInside` — the bibliography
 * at `<root>/<dirs.manuscript>/references.bib`, exactly as `addReference`
 * resolves it, and PDFs at `<root>/references/<key>.pdf`, exactly where
 * `resolvePdfPath`'s citekey rule looks for them.
 *
 * The doctrine that shapes every report below: **the agent must always say
 * which of the four outcomes happened** — `already-present`, `copied-local`,
 * `downloaded`, `metadata-only` — and it must never guess which paper was
 * meant. A `low`-confidence resolution writes NOTHING; it hands back the
 * candidates with their DOIs and asks to be re-run with one of them.
 */

/** All four keyless HTTP providers — `find_study` asks them simultaneously. */
const ALL_PROVIDERS: readonly LitProviderId[] = LIT_PROVIDER_IDS

/** Per-provider result cap for one sweep; four providers make this ~40 candidates. */
const DEFAULT_LIMIT = 10

/** The plan's "up to 4 alternatives"; the count of the rest is still reported. */
const MAX_ALTERNATIVES = 4

/**
 * Injection seam for the tests, in the shape `scan.ts` already uses for
 * `mdfind`: the defaults ARE the real implementations, so production paths
 * never see a stub, and the suite can exercise all four acquisition outcomes
 * without a network or a real disk scan.
 */
export interface StudyDeps {
  search?: (
    provider: LitProviderId,
    query: string,
    options: LitRequestOptions
  ) => Promise<LitSearchOutcome>
  lookup?: (
    provider: LitProviderId,
    doi: string,
    options: LitRequestOptions
  ) => Promise<LitLookupOutcome>
  findLocal?: (
    result: LitResult,
    config: LibraryConfig,
    opts?: FindLocalPdfOptions
  ) => Promise<FindLocalPdfResult>
  download?: (result: LitResult, options: PdfFetchOptions) => Promise<PdfDownloadOutcome>
  loadConfig?: (env?: NodeJS.ProcessEnv) => Promise<LibraryConfigOutcome>
  env?: NodeJS.ProcessEnv
}

function envOf(deps: StudyDeps): NodeJS.ProcessEnv {
  return deps.env ?? process.env
}

/**
 * Crossref's polite pool and Unpaywall's keyless API both want a contact
 * address. The desktop app has a Settings field for it; a standalone server
 * has the environment, alongside `SUNA_AGENT_NAME`/`SUNA_AGENT_MODEL`
 * (comments.ts). Explicitly null when unset, never `''` — `pdfUrlPlan` reads
 * null as "skip Unpaywall and say so".
 */
function contactEmail(env: NodeJS.ProcessEnv): string | null {
  const value = env['SUNA_CONTACT_EMAIL']?.trim()
  return value === undefined || value === '' ? null : value
}

/* ------------------------------------------------------------- formatting -- */

/**
 * One result row. Deliberately the same shape lit.ts prints for
 * `search_literature`/`lookup_doi` — an agent reading `find_study` output
 * after a `search_literature` should not have to learn a second format — with
 * one addition: a record with no DOI says so out loud. Alternatives exist to
 * be re-run as an explicit DOI, so "this one cannot be" is information, not
 * an omission.
 */
function formatRow(result: LitResult): string {
  const authors = result.authors.length > 0 ? result.authors.join(', ') : 'Unknown authors'
  const year = result.year !== null ? String(result.year) : 'n.d.'
  const doi = result.doi !== null ? ` doi:${result.doi}` : ' (no DOI)'
  // The OA link is a provider's string, not a URL this code parsed: a
  // newline in it would write a second line into a result listing a model
  // reads. `new URL()` would have dropped one; nothing here calls it.
  const oa =
    result.openAccessUrl !== null ? ` [OA: ${quoteExternalPath(result.openAccessUrl)}]` : ''
  return `${result.source}:${result.id} — ${result.title} (${authors}, ${year})${doi}${oa}`
}

/** Short identity for a header line, without the provider-native id. */
function describeWork(result: LitResult): string {
  const year = result.year !== null ? String(result.year) : 'n.d.'
  const doi = result.doi !== null ? ` doi:${result.doi}` : ' (no DOI)'
  const lead = result.authors[0]
  const authors =
    lead === undefined
      ? 'Unknown authors'
      : result.authors.length > 1
        ? `${lead} et al.`
        : lead
  return `${result.title} (${authors}, ${year})${doi}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/**
 * One local-match row.
 *
 * The path is quoted, because it is the only thing in this whole file that was
 * written by someone other than the user or a bibliographic provider: it is a
 * file name off a disk outside the project, and a file name may contain
 * newlines and colons — enough to forge this report's own line structure
 * inside the tool result an agent reads. What a scan finds is data, never
 * instructions, so it goes through `quoteExternalPath` on its way out.
 */
function formatMatch(match: PdfMatch, index: number): string {
  return `  ${index + 1}. ${match.confidence} — ${quoteExternalPath(match.path)} (${formatBytes(match.sizeBytes)}) evidence: ${match.evidence.join(', ')}`
}

/**
 * Which providers were asked and which of them failed, always on its own line
 * even when everything worked. "4 answered, 0 failed" is the sentence that
 * makes an empty result trustworthy; without it, silence is ambiguous.
 */
function providerLines(
  providers: readonly LitProviderId[],
  failed: readonly LitProviderId[],
  errors: readonly string[]
): string[] {
  const lines = [
    `providers: ${providers.join(', ')} — ${providers.length - failed.length} answered, ${failed.length} failed`
  ]
  if (errors.length > 0) {
    lines.push('provider errors:')
    for (const error of errors) lines.push(`  ${error}`)
  }
  return lines
}

function alternativeLines(candidates: readonly LitResult[]): string[] {
  if (candidates.length === 0) return []
  const shown = candidates.slice(0, MAX_ALTERNATIVES)
  const lines = [
    candidates.length > shown.length
      ? `alternatives (${shown.length} of ${candidates.length}):`
      : `alternatives (${shown.length}):`
  ]
  shown.forEach((candidate, index) => {
    lines.push(`  ${index + 1}. ${formatRow(candidate)}`)
  })
  return lines
}

/* ------------------------------------------------------ mention → one work -- */

interface MentionOutcome {
  resolution: StudyResolution
  /** What was actually sent to the providers — printed, so a bad parse is visible. */
  query: string
  providers: LitProviderId[]
  failed: LitProviderId[]
}

/**
 * What to ask the providers. The hints are used rather than the raw sentence
 * so that "find me the Gunn & Gott 1972 paper please" does not send `find`,
 * `me` and `paper` to a bibliographic search. A quoted title replaces the free
 * words entirely — the same rule `rankCandidates` applies when scoring, so the
 * query and the ranking agree about what the user was precise about.
 *
 * An identifier is the whole query when there is one: every provider resolves
 * a DOI or an arXiv id far more reliably than the prose around it.
 */
function providerQuery(hints: MentionHints, mention: string): string {
  if (hints.doi !== null) return hints.doi
  if (hints.arxivId !== null) return hints.arxivId
  const parts: string[] = []
  if (hints.quotedTitle !== null) parts.push(hints.quotedTitle)
  else if (hints.freeWords.length > 0) parts.push(hints.freeWords.join(' '))
  parts.push(...hints.surnames)
  if (hints.year !== null) parts.push(String(hints.year))
  const query = parts.join(' ').trim()
  // Nothing parsed (a mention of pure stopwords, say) — the raw text is still
  // a better question than an empty one.
  return query === '' ? mention.trim() : query
}

function uniqueProviders(providers: readonly LitProviderId[]): LitProviderId[] {
  const out: LitProviderId[] = []
  for (const provider of providers) {
    if (!out.includes(provider)) out.push(provider)
  }
  return out
}

/**
 * Ask every provider AT ONCE, fold the answers into one candidate list, and
 * rank it.
 *
 * `Promise.all` rather than a loop is the point: four sequential searches at
 * an 8 s provider budget each is half a minute of an agent's turn, and the
 * providers are independent. `searchLiterature` never throws (it reports
 * transport failures as `error`), so no single provider can reject the whole
 * batch — and each provider's error is carried into `StudyResolution.errors`
 * beside the results rather than replacing them.
 */
async function searchAllProviders(
  mention: string,
  providers: readonly LitProviderId[],
  limit: number,
  deps: StudyDeps
): Promise<MentionOutcome> {
  const hints = parseMention(mention)
  const query = providerQuery(hints, mention)
  const search = deps.search ?? searchLiterature
  const options: LitRequestOptions = { limit, mailto: contactEmail(envOf(deps)) }

  const outcomes = await Promise.all(
    providers.map((provider) => search(provider, query, options))
  )

  const byProvider: Record<string, LitResult[]> = {}
  const errors: string[] = []
  const failed: LitProviderId[] = []
  providers.forEach((provider, index) => {
    const outcome = outcomes[index]
    if (outcome === undefined) return
    byProvider[provider] = outcome.results
    if (outcome.error !== null) {
      errors.push(`${provider}: ${outcome.error}`)
      failed.push(provider)
    }
  })

  const resolution = resolveStudy(hints, mergeCandidates(byProvider), {
    providersTried: providers,
    errors
  })
  return { resolution, query, providers: [...providers], failed }
}

/** Every candidate worth showing, best first: the winner (if any) then the rest. */
function allCandidates(resolution: StudyResolution): LitResult[] {
  return resolution.chosen === null
    ? [...resolution.alternatives]
    : [resolution.chosen, ...resolution.alternatives]
}

/* ------------------------------------------------------------- find_study -- */

export const findStudyInput = z.object({
  /** Free text: a DOI, an arXiv id, "Gunn & Gott 1972", a quoted title, or prose around them. */
  mention: z.string().min(1),
  /** Defaults to all four keyless providers, asked in parallel. */
  providers: z.array(LitProviderIdSchema).min(1).optional(),
  /** Per-provider result cap; defaults to 10. */
  limit: z.number().int().positive().max(50).optional()
})

/**
 * Resolve a mention to one work and say how sure that is.
 *
 * Read-only in every sense: nothing is written, nothing is downloaded. It is
 * the verb to run first when a mention is vague, because its `low` verdict
 * (with the tied candidates and their DOIs) is what tells the caller to come
 * back with an explicit DOI instead of letting `cite_study` refuse.
 */
export async function findStudyTool(
  input: z.infer<typeof findStudyInput>,
  deps: StudyDeps = {}
): Promise<string> {
  const providers = uniqueProviders(input.providers ?? ALL_PROVIDERS)
  const found = await searchAllProviders(
    input.mention,
    providers,
    input.limit ?? DEFAULT_LIMIT,
    deps
  )
  const { resolution } = found

  const lines = [
    `find_study "${input.mention}"`,
    `query sent to providers: ${found.query}`,
    ...providerLines(found.providers, found.failed, resolution.errors),
    `confidence: ${resolution.confidence}`
  ]

  if (resolution.chosen !== null) {
    lines.push(`chosen: ${formatRow(resolution.chosen)}`)
    lines.push(...alternativeLines(resolution.alternatives))
    if (resolution.confidence === 'low') {
      lines.push(
        'low confidence: cite_study will refuse to write this — re-run it with an explicit DOI.'
      )
    }
    return lines.join('\n')
  }

  const candidates = resolution.alternatives
  if (candidates.length === 0) {
    lines.push(
      found.failed.length > 0
        ? 'chosen: none — no provider that answered returned a candidate; see the provider errors above before concluding the paper does not exist'
        : 'chosen: none — no provider returned a candidate for this mention'
    )
    return lines.join('\n')
  }
  lines.push(
    `chosen: none — ${candidates.length} candidates matched too closely to choose between them; re-run with an explicit DOI`
  )
  lines.push(...alternativeLines(candidates))
  return lines.join('\n')
}

/* ------------------------------------------------------- the bibliography -- */

/** `<root>/<dirs.manuscript>/references.bib`, resolved exactly as `addReference` does. */
function bibPath(ctx: ProjectContext): string {
  return resolveInside(ctx.root, ctx.dirs.manuscript, 'references.bib')
}

interface BibTextOutcome {
  /** The file's text, or '' when there is genuinely no bibliography yet. */
  text: string
  /** Null when `text` can be trusted; a sentence when the file could not be read. */
  error: string | null
}

/**
 * Read references.bib.
 *
 * A MISSING file is empty text and no error — the first `cite_study` in a
 * project creates it. Anything else (EACCES, EISDIR, a mount that went away)
 * is an error, and the distinction is load-bearing twice over: an unreadable
 * file reported as "0 entries parsed" is the silent empty list this project
 * forbids, and `citeStudy` builds the text it WRITES on top of what it read —
 * so a file that cannot be read but can be written would be replaced wholesale
 * by the one new entry, against feature-plan-10 §Layer 4's "Nothing here
 * overwrites or deletes". Every caller must stop when `error` is non-null.
 */
async function readBibText(ctx: ProjectContext): Promise<BibTextOutcome> {
  try {
    return { text: await readFile(bibPath(ctx), 'utf8'), error: null }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { text: '', error: null }
    return {
      text: '',
      error: `could not read references.bib (${describeExternalError(error)}) — nothing was read and nothing will be written; fix the file's permissions first`
    }
  }
}

function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase()
}

function authorName(entry: BibEntry, index: number): string | null {
  const author = entry.authors[index]
  if (author === undefined) return null
  if (author.kind === 'literal') return author.literal
  return author.given === undefined ? author.family : `${author.given} ${author.family}`
}

/**
 * A `LitResult` standing in for an entry that is already in references.bib —
 * what `find_local_pdf {citekey}` and `fetch_pdf {citekey}` match files
 * against without asking a provider anything.
 *
 * It is a SYNTHESIZED record, never a provider answer and never written back:
 * `source` is set to the provider whose id shape the entry carries, because
 * both `arxivIdOf` helpers downstream (pdf-match.ts scoring the filename,
 * pdf-fetch.ts building the arXiv rung of the download ladder) read
 * `source`/`id` to recover an arXiv id. Getting that pair wrong would quietly
 * cost a preprint its `https://arxiv.org/pdf/<id>` candidate.
 */
function litResultFromEntry(entry: BibEntry): LitResult {
  const doi = entry.doi === undefined || entry.doi.trim() === '' ? null : entry.doi.trim()
  const arxivId =
    entry.arxivId ??
    detectArxivId({
      eprint: entry.raw['eprint'],
      archivePrefix: entry.raw['archiveprefix'],
      url: entry.url,
      doi: doi ?? undefined
    })
  const authors: string[] = []
  for (let index = 0; index < entry.authors.length; index += 1) {
    const name = authorName(entry, index)
    if (name !== null && name.trim() !== '') authors.push(name.trim())
  }
  const year = entry.year === undefined ? Number.NaN : Number.parseInt(entry.year, 10)
  return {
    source: arxivId !== undefined ? 'arxiv' : 'crossref',
    id: arxivId ?? doi ?? entry.key,
    doi,
    title: entry.title,
    authors,
    year: Number.isFinite(year) ? year : null,
    venue: entry.journal ?? entry.booktitle ?? null,
    citedByCount: null,
    openAccessUrl: entry.url ?? null,
    abstract: null
  }
}

/* ----------------------------------------------------------- what to fetch -- */

/**
 * The work a PDF verb is about, plus the cite key it is filed under. `key` is
 * explicitly null when the work is not in references.bib yet: `find_local_pdf`
 * is happy either way, `fetch_pdf` refuses, since without a key there is no
 * `references/<key>.pdf` to write and inventing one would scatter PDFs the
 * bibliography never points at.
 */
interface StudyTarget {
  result: LitResult
  key: string | null
  /** The parsed entry when the work came out of references.bib, else null. */
  entry: BibEntry | null
  /** How the work was identified, for the report's first line. */
  label: string
  /** Anything the caller must be told about the identification itself. */
  notes: string[]
}

type TargetOutcome = { target: StudyTarget; error: null } | { target: null; error: string }

/**
 * Identify the work from `{citekey}`, `{doi}` or `{mention}`, most specific
 * first: a cite key names one entry outright, a DOI names one work, and a
 * mention has to be resolved and can come back ambiguous.
 *
 * Errors are returned as sentences (project doctrine), never thrown and never
 * an empty match list standing in for "we could not tell which paper".
 */
async function resolveTarget(
  ctx: ProjectContext,
  input: { citekey?: string | undefined; doi?: string | undefined; mention?: string | undefined },
  deps: StudyDeps
): Promise<TargetOutcome> {
  const bib = await readBibText(ctx)
  // An unreadable bibliography is not an empty one: every branch below asks it
  // whether a work is already filed, and answering "no" from a read failure
  // would both mis-report and, in cite_study, duplicate an entry that is there.
  if (bib.error !== null) return { target: null, error: bib.error }
  const bibText = bib.text

  if (input.citekey !== undefined) {
    const parsed = parseBibtex(bibText)
    const entry = parsed.entries.find((candidate) => candidate.key === input.citekey)
    if (entry === undefined) {
      return {
        target: null,
        error: `no entry "${input.citekey}" in references.bib (${parsed.entries.length} entries parsed${parsed.errors.length > 0 ? `, ${parsed.errors.length} unreadable` : ''}) — run read_bib to see the keys`
      }
    }
    return {
      target: {
        result: litResultFromEntry(entry),
        key: entry.key,
        entry,
        label: `references.bib entry ${entry.key}`,
        notes: []
      },
      error: null
    }
  }

  if (input.doi !== undefined) {
    const wanted = normalizeDoi(input.doi)
    const parsed = parseBibtex(bibText)
    const entry = parsed.entries.find(
      (candidate) => candidate.doi !== undefined && normalizeDoi(candidate.doi) === wanted
    )
    if (entry !== undefined) {
      return {
        target: {
          result: litResultFromEntry(entry),
          key: entry.key,
          entry,
          label: `references.bib entry ${entry.key} (doi:${wanted})`,
          notes: []
        },
        error: null
      }
    }
    // Not in the bibliography — ask a provider for the metadata, because a
    // bare DOI cannot match a filename or drive the download ladder on its own.
    const lookup = deps.lookup ?? lookupByDoi
    const outcome = await lookup('crossref', input.doi, { mailto: contactEmail(envOf(deps)) })
    if (outcome.error !== null) {
      return { target: null, error: `crossref: ${outcome.error} — nothing was searched` }
    }
    if (outcome.result === null) {
      return { target: null, error: `crossref: no record for DOI ${input.doi} — nothing was searched` }
    }
    return {
      target: {
        result: outcome.result,
        key: null,
        entry: null,
        label: describeWork(outcome.result),
        notes: [`doi:${wanted} is not in references.bib yet`]
      },
      error: null
    }
  }

  if (input.mention !== undefined) {
    const found = await searchAllProviders(input.mention, ALL_PROVIDERS, DEFAULT_LIMIT, deps)
    const { resolution } = found
    if (resolution.chosen === null || resolution.confidence === 'low') {
      return {
        target: null,
        error: [
          `the mention "${input.mention}" did not resolve to one work (confidence: ${resolution.confidence}) — nothing was searched`,
          ...providerLines(found.providers, found.failed, resolution.errors),
          ...alternativeLines(allCandidates(resolution)),
          'Re-run with an explicit doi (or citekey) rather than letting this guess.'
        ].join('\n')
      }
    }
    const existing = findExistingKey(bibText, resolution.chosen)
    return {
      target: {
        result: resolution.chosen,
        key: existing,
        entry: null,
        label: describeWork(resolution.chosen),
        notes: [
          `resolved from the mention with ${resolution.confidence} confidence`,
          ...providerLines(found.providers, found.failed, resolution.errors)
        ]
      },
      error: null
    }
  }

  return { target: null, error: 'nothing to identify: pass a citekey, a doi or a mention' }
}

/* --------------------------------------------------------- the PDF ladder -- */

interface AcquireOutcome {
  acquisition: PdfAcquisition
  /** Project-relative POSIX path of the PDF, or null for `metadata-only`. */
  relativePath: string | null
  /** Where it came from: an absolute path on this machine, a URL, or null. */
  source: string | null
  /** Everything that happened on the way, including the rungs that failed. */
  detail: string[]
}

interface AcquireOptions {
  config: LibraryConfig
  policy: DownloadPolicy
  /** False runs no ladder at all: the caller asked for metadata only. */
  wantPdf: boolean
  /** The bibliography entry, when there is one — its `file` field is checked first. */
  entry: BibEntry | null
  /**
   * A local file the caller has decided IS the paper, copied in even though its
   * evidence was too thin to copy unasked. Null when nobody accepted anything.
   */
  acceptPath: string | null
  deps: StudyDeps
}

interface PresentPdf {
  relative: string
  absolute: string
  how: string
}

/**
 * Outcome 1, `already-present`: does the project ALREADY hold this PDF?
 *
 * Asked through `resolvePdfPath` — the same resolver the References view and
 * the exporter use — so a PDF the user attached by hand under its Zotero name
 * counts, and a second copy is never downloaded next to it. The listing is
 * just `references/`, which is where the rule that matters (`references/<key>.pdf`)
 * looks; a `file` field pointing outside the project is reported and NOT
 * treated as present, because the plan's outcome 1 is "the project already has
 * this PDF", not "some machine somewhere does".
 *
 * Only rules that identify the WORK count here. The resolver's `Author_Year*`
 * fuzzy rule identifies an author in a year, so it is honoured only for an
 * entry that came out of references.bib (where the name is the user's own
 * choice about their own reference) and reported as a mere candidate otherwise.
 */
async function existingProjectPdf(
  ctx: ProjectContext,
  result: LitResult,
  key: string,
  entry: BibEntry | null,
  detail: string[]
): Promise<PresentPdf | null> {
  let names: string[] = []
  try {
    names = await readdir(resolveInside(ctx.root, 'references'))
  } catch {
    // No references/ directory yet — nothing can be present.
  }
  const listing = names
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .map((name) => `references/${name}`)

  // A copy, never the caller's entry: this is a question, not an edit.
  const subject: BibEntry = { ...(entry ?? litResultToBibEntry(result)), key }
  const resolution = resolvePdfPath(subject, listing)
  if (resolution === null) return null

  // `resolvePdfPath`'s third rule is an `Author_Year*` prefix match over
  // references/, which identifies an AUTHOR IN A YEAR, not a work — bib-write's
  // `findExistingKey` refuses exactly that identity rule for exactly this
  // reason ("two papers by the same group in the same year are ordinary"). For
  // a work that is already in references.bib the hit is still evidence, because
  // the entry and the file name are both the user's own; for a work that is
  // not, it would short-circuit the whole ladder and — in cite_study — write
  // another paper's PDF into the new entry's `file` field. So it is reported
  // as a candidate and the ladder carries on.
  //
  // Every `resolution.path` below is quoted on its way into `detail`, which is
  // read by a model. The path is disk-derived, not authored here: for
  // `citekey`/`fuzzy` it is a readdir entry name out of the project's own
  // references/, and a file name may contain a newline, so `A_2020\n<directive>.pdf`
  // would otherwise reproduce this report's own line structure. (The
  // `file-field` route reads references.bib, where parseBibtex collapses
  // newlines inside a braced value — but the quoting is at the point of
  // interpolation rather than by reasoning about which route got here.)
  if (resolution.how === 'fuzzy' && entry === null) {
    detail.push(
      `${quoteExternalPath(resolution.path)} matches this work's author and year, but no entry in references.bib names it — an author and a year are not a paper, so it was NOT treated as already-present (run find_local_pdf, or attach it by hand, if it is the right file)`
    )
    return null
  }

  if (isAbsolute(resolution.path)) {
    detail.push(
      `the entry's file field points outside the project (${quoteExternalPath(resolution.path)}); it was left alone`
    )
    return null
  }
  let absolute: string
  try {
    absolute = resolveInside(ctx.root, resolution.path)
  } catch {
    detail.push(
      `the entry's file field escapes the project root (${quoteExternalPath(resolution.path)}); it was ignored`
    )
    return null
  }
  try {
    await stat(absolute)
  } catch {
    // A `file` field is trusted as written, so it can name a file that is no
    // longer there. That is not "present" — carry on down the ladder.
    detail.push(`${quoteExternalPath(resolution.path)} is named by the entry but is not on disk`)
    return null
  }
  return { relative: resolution.path, absolute, how: resolution.how }
}

/**
 * One line saying how wide the machine search actually was.
 *
 * The roots are absolute paths from outside the project, so they are quoted
 * individually before being joined — the same treatment `scan.ts` gives them
 * at its own sites. They come from the user's own library.json rather than
 * from a third party, but they still cross into a model-visible report, and
 * quoting keeps each one on one line and shows where it begins and ends.
 */
function scanSummary(found: FindLocalPdfResult): string {
  const roots =
    found.rootsSearched.length === 0
      ? 'no searchable roots'
      : `${found.rootsSearched.length} root${found.rootsSearched.length === 1 ? '' : 's'} (${found.rootsSearched.map((root) => quoteExternalPath(root)).join(', ')})`
  const truncated = found.truncated ? ', walk truncated by maxFilesScanned' : ''
  return `local scan: ${found.matches.length} match${found.matches.length === 1 ? '' : 'es'} across ${roots}, ${found.scanned} file${found.scanned === 1 ? '' : 's'} examined${truncated}`
}

/**
 * The ladder, in the plan's strict preference order:
 * `already-present` → `copied-local` → `downloaded` → `metadata-only`.
 *
 * Every rung that does not produce a PDF leaves a line in `detail` saying why,
 * so `metadata-only` always arrives with its reasons — "3 roots searched,
 * nothing matched; the publisher answered 403" is a fact the user can act on,
 * an unexplained "no PDF" is not.
 *
 * A local match that does not clear `isAutoCopyable` is deliberately NOT
 * copied — that is every `low` match and a `medium` resting on one piece of
 * evidence. A wrong PDF in `references/` is discovered at submission; the
 * candidate is named in the report instead, with its evidence, and the ladder
 * carries on to the download rung as if nothing had matched.
 */
async function acquirePdf(
  ctx: ProjectContext,
  result: LitResult,
  key: string,
  options: AcquireOptions
): Promise<AcquireOutcome> {
  const detail: string[] = []
  if (!options.wantPdf) {
    detail.push('the PDF ladder was skipped (pdf: false)')
    return { acquisition: 'metadata-only', relativePath: null, source: null, detail }
  }

  const present = await existingProjectPdf(ctx, result, key, options.entry, detail)
  if (present !== null) {
    return {
      acquisition: 'already-present',
      relativePath: present.relative,
      source: present.absolute,
      detail
    }
  }

  const findLocal = options.deps.findLocal ?? findLocalPdf
  const found = await findLocal(result, options.config, { env: envOf(options.deps) })
  detail.push(scanSummary(found))
  for (const note of found.notes) detail.push(`scan: ${note}`)

  // An accepted path is only ever one the scan itself reported. Trusting an
  // arbitrary string here would turn "copy the candidate I looked at" into
  // "copy any file on this machine", widening the read boundary the scan just
  // enforced.
  const accepted =
    options.acceptPath === null
      ? undefined
      : found.matches.find((match) => match.path === options.acceptPath)
  if (options.acceptPath !== null && accepted === undefined) {
    detail.push(
      `accept: ${quoteExternalPath(options.acceptPath)} is not one of the ${found.matches.length} path${found.matches.length === 1 ? '' : 's'} this scan found, so nothing was copied — only a file the scan itself reported can be accepted; run find_local_pdf and copy a path from it`
    )
  }

  const best = accepted ?? found.matches.find(isAutoCopyable)
  if (best !== undefined) {
    const saved = await importPdfIntoProject(best.path, ctx.root, key)
    if (saved.error !== null) {
      detail.push(`local copy failed: ${saved.error}`)
    } else if (saved.acquisition !== null && saved.relativePath !== null) {
      detail.push(
        accepted === undefined
          ? `evidence: ${best.evidence.join(', ')} (${best.confidence})`
          : `accepted by name: ${quoteExternalPath(best.path)} — evidence: ${best.evidence.join(', ')} (${best.confidence}), copied because it was asked for, not because the evidence was enough`
      )
      return {
        acquisition: saved.acquisition,
        relativePath: saved.relativePath,
        source: best.path,
        detail
      }
    }
  } else if (found.matches.length > 0) {
    // Named, with its evidence, so the caller can accept it deliberately —
    // this is a candidate the ladder REFUSED to guess at, not a file it failed
    // to notice.
    const candidate = found.matches[0]
    detail.push(
      `${found.matches.length} local match${found.matches.length === 1 ? '' : 'es'} were too weak to copy without guessing${candidate === undefined ? '' : ` (best: ${candidate.confidence} — ${quoteExternalPath(candidate.path)}, evidence: ${candidate.evidence.join(', ')})`}; run find_local_pdf to see them, or accept one deliberately with fetch_pdf {"citekey": "${key}", "accept": "<path>"}`
    )
  }

  if (options.policy === 'off') {
    detail.push("download: the library download policy is 'off', so nothing was fetched")
  } else {
    const download = options.deps.download ?? downloadPdf
    const outcome = await download(result, {
      policy: options.policy,
      mailto: contactEmail(envOf(options.deps))
    })
    if (outcome.bytes === null) {
      detail.push(`download: ${describePdfFailure(outcome)}`)
      if (outcome.error !== null) detail.push(`download detail: ${outcome.error}`)
    } else {
      const saved = await savePdfBytes(outcome.bytes, ctx.root, key)
      if (saved.error !== null) {
        detail.push(
          `download: fetched ${outcome.bytes.length} bytes from ${outcome.sourceUrl === null ? 'an unnamed URL' : quoteExternalPath(outcome.sourceUrl)} but could not save them — ${saved.error}`
        )
      } else if (saved.acquisition !== null && saved.relativePath !== null) {
        if (saved.acquisition === 'already-present') {
          // The bytes were fetched over the network and then thrown away
          // because the destination appeared while the ladder was on it. Rung 1
          // has already told the caller the project did NOT have this PDF, so a
          // bare `already-present` here contradicts the report's own earlier
          // line and hides a download that really happened.
          detail.push(
            `download: fetched ${outcome.bytes.length} bytes from ${outcome.sourceUrl === null ? 'an unnamed URL' : quoteExternalPath(outcome.sourceUrl)}, but ${saved.relativePath} already existed by the time they arrived and is never overwritten — the downloaded bytes were discarded`
          )
        }
        return {
          acquisition: saved.acquisition,
          relativePath: saved.relativePath,
          source: outcome.sourceUrl,
          detail
        }
      }
    }
  }

  return { acquisition: 'metadata-only', relativePath: null, source: null, detail }
}

/**
 * The one line that names which of the four outcomes happened.
 *
 * `copied-local`'s source is a path from outside the project, so it is quoted
 * for the same reason `formatMatch` quotes one: a file name is data, and a
 * name carrying a newline would otherwise write a second line into this report.
 *
 * `already-present`'s `relativePath` is the same kind of value even though it
 * names something inside the project: `resolvePdfPath` found it by listing
 * references/, so it is a readdir entry — a name whoever put the PDF there
 * chose — and its Author_Year rule is a PREFIX match, so
 * `Smith_2020\n<directive>.pdf` matches and survives. (This file's note above
 * `existingProjectPdf` says every `resolution.path` is quoted; that was true
 * of `detail` and not of this line, which is the kind of exception a comment
 * cannot hold on its own — `external-paths.test.ts` now holds it.) The two
 * remaining raw ones are `references/<key>.pdf` composed here from the cite
 * key, and they are on that test's allow-list by name.
 *
 * `downloaded`'s source is a URL, and a URL is the same trust class as a file
 * name: Unpaywall's `best_oa_location.url_for_pdf` is kept as the raw JSON
 * string it arrived as (pdf-fetch.ts hands `httpGet` that string and reports
 * it back as `sourceUrl`), and `new URL()` — which would have dropped the
 * newline — is only ever applied to a copy of it.
 */
function acquisitionLine(outcome: AcquireOutcome): string {
  switch (outcome.acquisition) {
    case 'already-present':
      return `pdf: already-present — ${outcome.relativePath === null ? 'a PDF' : quoteExternalPath(outcome.relativePath)} was already in the project`
    case 'copied-local':
      return `pdf: copied-local — copied ${outcome.source === null ? 'a local file' : quoteExternalPath(outcome.source)} → ${outcome.relativePath}`
    case 'downloaded':
      return `pdf: downloaded — ${outcome.source === null ? 'an unnamed URL' : quoteExternalPath(outcome.source)} → ${outcome.relativePath}`
    case 'metadata-only':
      return 'pdf: metadata-only — no PDF in the project, on this machine or online; the reference stands on its metadata alone'
  }
}

/** The library config, plus a line whenever library.json itself was unusable. */
async function libraryConfig(deps: StudyDeps): Promise<{ config: LibraryConfig; notes: string[] }> {
  const load = deps.loadConfig ?? loadLibraryConfig
  const outcome = await load(envOf(deps))
  return {
    config: outcome.config,
    notes: outcome.error === null ? [] : [`library.json: ${outcome.error} — the defaults were used`]
  }
}

/* --------------------------------------------------------- find_local_pdf -- */

export const findLocalPdfInput = z.object({
  /** Any one of the three; a citekey is answered without touching the network. */
  doi: z.string().min(1).optional(),
  mention: z.string().min(1).optional(),
  citekey: z.string().min(1).optional()
})

/**
 * Search THIS MACHINE for a PDF of the work — Spotlight plus a bounded walk of
 * the configured roots, both read-only. Nothing is copied, moved or opened for
 * writing; `fetch_pdf` is the verb that acquires.
 *
 * An empty answer is a real answer, so it always names the roots that were
 * searched: "no match across 3 roots" and "no roots exist" are different facts
 * and only one of them means the paper is not on this machine.
 */
export async function findLocalPdfTool(
  ctx: ProjectContext,
  input: z.infer<typeof findLocalPdfInput>,
  deps: StudyDeps = {}
): Promise<string> {
  if (input.citekey === undefined && input.doi === undefined && input.mention === undefined) {
    return 'find_local_pdf needs a citekey, a doi or a mention — nothing was searched'
  }
  const outcome = await resolveTarget(ctx, input, deps)
  if (outcome.target === null) return `find_local_pdf: ${outcome.error}`
  const target = outcome.target

  const { config, notes: configNotes } = await libraryConfig(deps)
  const findLocal = deps.findLocal ?? findLocalPdf
  const found = await findLocal(target.result, config, { env: envOf(deps) })

  const lines = [`find_local_pdf: ${target.label}`, ...target.notes, ...configNotes]
  // Configured roots are absolute paths outside the project reaching a
  // model-visible result, so each is quoted before the join — as in
  // `scanSummary` and in `scan.ts`.
  lines.push(
    found.rootsSearched.length === 0
      ? 'roots searched: none'
      : `roots searched (${found.rootsSearched.length}): ${found.rootsSearched.map((root) => quoteExternalPath(root)).join(', ')}`
  )
  if (found.rootsMissing.length > 0) {
    lines.push(`roots missing: ${found.rootsMissing.map((root) => quoteExternalPath(root)).join(', ')}`)
  }
  lines.push(
    `${found.scanned} file${found.scanned === 1 ? '' : 's'} examined by the walk${found.truncated ? ' (truncated by maxFilesScanned — the answer is partial)' : ''}`
  )

  if (found.matches.length === 0) {
    lines.push(
      found.rootsSearched.length === 0
        ? 'no match: there was nothing to search'
        : `no match across ${found.rootsSearched.length} root${found.rootsSearched.length === 1 ? '' : 's'} (${found.rootsSearched.map((root) => quoteExternalPath(root)).join(', ')})`
    )
  } else {
    lines.push(`${found.matches.length} match${found.matches.length === 1 ? '' : 'es'}, best first:`)
    found.matches.forEach((match, index) => lines.push(formatMatch(match, index)))
    lines.push('read-only: nothing was copied — run fetch_pdf to bring one into the project')
  }
  if (found.notes.length > 0) {
    lines.push('notes:')
    for (const note of found.notes) lines.push(`  ${note}`)
  }
  return lines.join('\n')
}

/* --------------------------------------------------------------- fetch_pdf -- */

export const fetchPdfInput = z.object({
  /** The reference to acquire, by cite key or by DOI — it must already be in references.bib. */
  citekey: z.string().min(1).optional(),
  doi: z.string().min(1).optional(),
  /** Overrides library.json's download policy for this call only. */
  policy: DownloadPolicySchema.optional(),
  /**
   * Copy in this exact local file, even though its evidence was too thin for
   * the ladder to copy it unasked — the deliberate acceptance of a candidate
   * the previous run named. It must be one of the paths the scan itself
   * reports (run `find_local_pdf`, or read the "too weak to copy" line of an
   * earlier `fetch_pdf`); any other path is refused and reported, so accepting
   * a candidate can never reach a file outside the configured library roots.
   */
  accept: z.string().min(1).optional()
})

/**
 * Acquire a PDF for a reference that is already in the bibliography, into
 * `references/<key>.pdf`, and say which rung of the ladder produced it.
 *
 * This verb never touches references.bib: the cite key must already exist, so
 * that a PDF can never land under a name the bibliography does not point at.
 * `cite_study` is the verb that creates the entry and the PDF together.
 *
 * `accept` is the deliberate half of the local rung. The ladder copies a local
 * file only on `high` evidence, or on `medium` with two independent pieces of
 * it; anything weaker is reported as a candidate and skipped, because a lone
 * "Smith 2020" filename match names every Smith 2020 paper. Re-running with
 * `accept` set to that candidate's path — and only to a path the scan itself
 * reported — is how a human says "yes, that one", which is a decision the verb
 * will not make for them.
 */
export async function fetchPdfTool(
  ctx: ProjectContext,
  input: z.infer<typeof fetchPdfInput>,
  deps: StudyDeps = {}
): Promise<string> {
  if (input.citekey === undefined && input.doi === undefined) {
    return 'fetch_pdf needs a citekey or a doi — nothing was fetched'
  }
  const outcome = await resolveTarget(ctx, input, deps)
  if (outcome.target === null) return `fetch_pdf: ${outcome.error}`
  const target = outcome.target
  if (target.key === null) {
    return [
      `fetch_pdf: ${target.label}`,
      'this work is not in references.bib, so there is no cite key to file its PDF under — nothing was fetched.',
      'Run cite_study (it appends the entry and acquires the PDF in one go), or add_reference followed by fetch_pdf {"citekey": "<key>"}.'
    ].join('\n')
  }

  const { config, notes: configNotes } = await libraryConfig(deps)
  const acquired = await acquirePdf(ctx, target.result, target.key, {
    config,
    policy: input.policy ?? config.download,
    wantPdf: true,
    entry: target.entry,
    acceptPath: input.accept ?? null,
    deps
  })

  return [
    `fetch_pdf ${target.key}: ${target.label}`,
    ...target.notes,
    ...configNotes,
    acquisitionLine(acquired),
    ...acquired.detail.map((line) => `  ${line}`),
    `cite it in the manuscript as [@${target.key}]`
  ].join('\n')
}

/* -------------------------------------------------------------- cite_study -- */

export const citeStudyInput = z.object({
  /** The free-text mention to resolve, cite and (unless `pdf` is false) acquire. */
  mention: z.string().min(1),
  /** Download policy for this call; defaults to library.json's. 'off' stops after the local search. */
  download: DownloadPolicySchema.optional(),
  /** False cites from metadata alone: no machine search, no download. Defaults to true. */
  pdf: z.boolean().optional()
})

/** The refusal. It writes nothing, and says so first. */
function ambiguityReport(mention: string, found: MentionOutcome): string {
  const { resolution } = found
  const candidates = allCandidates(resolution)
  const lines = [
    `cite_study: ${resolution.confidence} confidence — NOTHING WAS WRITTEN.`,
    `The mention "${mention}" did not identify one work with enough confidence to cite it.`,
    ...providerLines(found.providers, found.failed, resolution.errors)
  ]
  if (candidates.length === 0) {
    lines.push(
      found.failed.length > 0
        ? 'No candidates at all came back — check the provider errors above before concluding the paper does not exist.'
        : 'No provider returned a candidate for this mention. Try a quoted title, an author and year, or the DOI.'
    )
    return lines.join('\n')
  }
  lines.push(...alternativeLines(candidates))
  const lead = candidates[0]
  const example = lead !== undefined && lead.doi !== null ? lead.doi : '10.xxxx/yyyy'
  lines.push(
    `Re-run with an explicit DOI — cite_study {"mention": "${example}"} — rather than letting this guess which paper you meant.`
  )
  return lines.join('\n')
}

/**
 * The composite verb: resolve → dedupe against the bibliography → append →
 * PDF ladder → one honest report naming the outcome and the `[@key]` to paste.
 *
 * Three rules hold it together, and all three are the point of the feature:
 *
 *   - **`low` confidence writes NOTHING.** Not the entry, not the PDF. The
 *     alternatives come back with their DOIs and the caller is asked to re-run
 *     with one. Guessing on the user's behalf is the one thing this must not do.
 *   - **`findExistingKey` first.** A work already in references.bib keeps its
 *     key and its entry — nothing is appended, nothing is rewritten — and the
 *     PDF ladder still runs, so `cite_study` twice in a row is idempotent
 *     rather than duplicating the reference.
 *   - **The bibliography is re-read immediately before it is written.** The
 *     ladder can spend twenty seconds on the network, and appending a stale
 *     in-memory copy would silently drop whatever the app wrote meanwhile.
 *     The key the PDF was filed under is decided BEFORE the ladder (from the
 *     same text, by the same `appendLitResultToBib`), so the file the entry
 *     names is always the file that was written.
 */
export async function citeStudy(
  ctx: ProjectContext,
  input: z.infer<typeof citeStudyInput>,
  deps: StudyDeps = {}
): Promise<string> {
  const found = await searchAllProviders(input.mention, ALL_PROVIDERS, DEFAULT_LIMIT, deps)
  const { resolution } = found
  const chosen = resolution.chosen
  if (chosen === null || resolution.confidence === 'low') {
    return ambiguityReport(input.mention, found)
  }

  const bib = await readBibText(ctx)
  if (bib.error !== null) {
    return [
      `cite_study: ${resolution.confidence} confidence — ${describeWork(chosen)}`,
      ...providerLines(found.providers, found.failed, resolution.errors),
      `reference: ${bib.error}`,
      'NOTHING WAS WRITTEN and no PDF was fetched.'
    ].join('\n')
  }
  const before = bib.text
  const existingKey = findExistingKey(before, chosen)
  // A dry run purely to learn the key an append WOULD assign: it is derived
  // from `before` exactly as the real append below derives it, so the PDF and
  // the entry cannot disagree about the name.
  const planned = existingKey ?? appendLitResultToBib(before, chosen).key
  // The already-there entry may already point at a PDF through its `file`
  // field — under a name of the user's own choosing — so the ladder is handed
  // the entry itself rather than a synthesized one, or outcome 1 would be
  // missed and a second copy downloaded next to the first.
  const existingEntry =
    existingKey === null
      ? null
      : (parseBibtex(before).entries.find((entry) => entry.key === existingKey) ?? null)

  const { config, notes: configNotes } = await libraryConfig(deps)
  const acquired = await acquirePdf(ctx, chosen, planned, {
    config,
    policy: input.download ?? config.download,
    wantPdf: input.pdf ?? true,
    entry: existingEntry,
    // cite_study resolves a mention it was handed; there is no earlier scan
    // whose candidates the caller could have looked at, so there is nothing to
    // accept. `fetch_pdf {"accept": …}` is the second step for that.
    acceptPath: null,
    deps
  })

  const referenceLines: string[] = []
  let key = planned
  if (existingKey !== null) {
    referenceLines.push(
      `reference: already in references.bib as ${existingKey} — nothing was appended and the existing entry was left untouched`
    )
  } else {
    // Re-read fresh: doctrine for every appendLitResultToBib caller, and the
    // ladder above may have taken a long time.
    const reread = await readBibText(ctx)
    if (reread.error !== null) {
      return [
        `cite_study: ${resolution.confidence} confidence — ${describeWork(chosen)}`,
        ...providerLines(found.providers, found.failed, resolution.errors),
        `reference: ${reread.error}`,
        'The entry was NOT appended — writing would have replaced a file SUNA could not read.',
        acquisitionLine(acquired),
        ...acquired.detail.map((line) => `  ${line}`)
      ].join('\n')
    }
    const fresh = reread.text
    const raced = findExistingKey(fresh, chosen)
    if (raced !== null) {
      key = raced
      referenceLines.push(
        `reference: appeared in references.bib as ${raced} while the PDF was being acquired — nothing was appended`
      )
    } else {
      const appended = appendLitResultToBib(
        fresh,
        chosen,
        acquired.relativePath !== null ? { filePath: acquired.relativePath } : undefined
      )
      try {
        await writeFile(bibPath(ctx), appended.text, 'utf8')
      } catch (error) {
        return [
          `cite_study: ${resolution.confidence} confidence — ${describeWork(chosen)}`,
          ...providerLines(found.providers, found.failed, resolution.errors),
          `reference: could not write references.bib — ${describeExternalError(error)}`,
          acquisitionLine(acquired),
          ...acquired.detail.map((line) => `  ${line}`)
        ].join('\n')
      }
      key = appended.key
      // `fileField` is the value bib-write put in the entry, and its escaping
      // (`fileFieldValue`) is BibTeX's — a `;` becomes `\;` and that is all.
      // Nothing there keeps a newline out of this report, so the report quotes
      // it; the braces are dropped with it, since what is shown is now the
      // escaped value rather than the field as it reads on disk.
      referenceLines.push(
        `reference: appended as ${appended.key}${appended.fileField === null ? '' : ` with file = ${quoteExternalPath(appended.fileField)}`}`
      )
      if (appended.key !== planned) {
        referenceLines.push(
          `  note: another entry claimed ${planned} while the PDF was being acquired, so the entry is ${appended.key}; its file field still names the PDF that was written`
        )
      }
      for (const parseError of appended.parseErrors) {
        referenceLines.push(`  note: an existing entry could not be parsed (left untouched): ${parseError}`)
      }
    }
  }

  return [
    `cite_study: ${resolution.confidence} confidence — ${describeWork(chosen)}`,
    ...providerLines(found.providers, found.failed, resolution.errors),
    ...configNotes,
    ...referenceLines,
    acquisitionLine(acquired),
    ...acquired.detail.map((line) => `  ${line}`),
    `cite it in the manuscript as [@${key}]`
  ].join('\n')
}
