import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { LitProviderIdSchema, type LitProviderId, type LitResult } from '@suna/core'
import { appendLitResultToBib, lookupByDoi, searchLiterature } from '@suna/bib'
import { describeExternalError, errorCode, quoteExternalPath } from '../library/config'
import { resolveInside, type ProjectContext } from './project'

/**
 * MCP-side literature verbs — thin wrappers over the shared provider module
 * in @suna/bib (packages/bib/src/providers.ts: the exact fetch/mapping logic
 * apps/desktop's main process uses for the lit:search/lit:by-doi IPC
 * channels, lifted there so both hosts run identical provider behavior).
 *
 * No API keys here: the MCP server runs standalone, without the Electron app
 * and without access to its encrypted key store (safeStorage), so every call
 * is keyless — Crossref (the default), bioRxiv/medRxiv and arXiv work as
 * normal, OpenAlex runs metered. `add_reference` reuses
 * `appendLitResultToBib` from @suna/bib,
 * the same append logic the desktop UI's "Add to references.bib" button
 * uses, so both paths produce byte-identical entries for the same DOI.
 */

const DEFAULT_PROVIDER: LitProviderId = 'crossref'

function formatResult(result: LitResult): string {
  const authors = result.authors.length > 0 ? result.authors.join(', ') : 'Unknown authors'
  const year = result.year !== null ? String(result.year) : 'n.d.'
  const doi = result.doi !== null ? ` doi:${result.doi}` : ''
  // The OA link is a provider's string, not a URL this code parsed: a newline
  // in it would write a second line into a result listing a model reads.
  // `new URL()` would have dropped one; nothing here calls it. Identical
  // construct, identical answer as `formatRow` in mcp/study.ts.
  const oa =
    result.openAccessUrl !== null ? ` [OA: ${quoteExternalPath(result.openAccessUrl)}]` : ''
  return `${result.source}:${result.id} — ${result.title} (${authors}, ${year})${doi}${oa}`
}

export const searchLiteratureInput = z.object({
  query: z.string().min(1),
  /** Defaults to Crossref — the only provider guaranteed to work with no key. */
  provider: LitProviderIdSchema.optional(),
  limit: z.number().int().positive().max(100).optional()
})

/**
 * ERROR HONESTY: a provider error rides along in the text even when some
 * results also came back — never a silently empty list standing in for a
 * real failure (e.g. OpenAlex's metered HTTP 429).
 */
export async function searchLiteratureTool(
  input: z.infer<typeof searchLiteratureInput>
): Promise<string> {
  const provider = input.provider ?? DEFAULT_PROVIDER
  const outcome = await searchLiterature(provider, input.query, { limit: input.limit ?? 10 })
  const count = outcome.results.length
  const header = `${provider}: ${count} result${count === 1 ? '' : 's'} for "${input.query}"`
  const body = outcome.results.map(formatResult).join('\n')
  if (outcome.error !== null) {
    return `${header}\nerror: ${outcome.error}${body !== '' ? `\n\n${body}` : ''}`
  }
  return body === '' ? `${header} (none)` : `${header}\n\n${body}`
}

export const lookupDoiInput = z.object({
  doi: z.string().min(1),
  provider: LitProviderIdSchema.optional()
})

export async function lookupDoiTool(input: z.infer<typeof lookupDoiInput>): Promise<string> {
  const provider = input.provider ?? DEFAULT_PROVIDER
  const outcome = await lookupByDoi(provider, input.doi)
  if (outcome.error !== null) return `${provider}: ${outcome.error}`
  if (outcome.result === null) return `${provider}: no record for DOI ${input.doi}`
  return formatResult(outcome.result)
}

export const addReferenceInput = z.object({
  doi: z.string().min(1),
  /** Provider to resolve the DOI against before writing; defaults to Crossref. */
  provider: LitProviderIdSchema.optional()
})

interface BibTextOutcome {
  /** The file's text, or '' when there is genuinely no bibliography yet. */
  text: string
  /** Null when `text` can be trusted; a sentence when the file could not be read. */
  error: string | null
}

/**
 * Read references.bib, in the same shape and for the same reason as
 * `readBibText` in mcp/study.ts (kept a sibling rather than an import because
 * that one is private to study.ts; both must answer the same way).
 *
 * A MISSING file is empty text and no error — the first `add_reference` in a
 * project creates it. Anything ELSE (EISDIR when a directory sits where the
 * file should be, EACCES on a write-only file, a mount that went away) is an
 * error, and the distinction is load-bearing here because the text read
 * becomes the BASE of a whole-file write: a bibliography that cannot be read
 * but can be written would be REPLACED by the single new entry, silently
 * deleting every reference the user had. Swallowing the failure into '' is
 * data loss, not a fresh start.
 */
async function readBibText(path: string): Promise<BibTextOutcome> {
  try {
    return { text: await readFile(path, 'utf8'), error: null }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { text: '', error: null }
    // `describeExternalError`, not the raw `describeError`: an errno message
    // quotes the path it failed on (`EACCES: permission denied, open
    // '<path>'`), and this sentence is returned straight to the model. A
    // project directory named with a newline would otherwise break the line
    // from inside the error text.
    return { text: '', error: `could not read references.bib (${describeExternalError(error)})` }
  }
}

/** Looks the DOI up, then appends it to references.bib via the shared @suna/bib writer. */
export async function addReference(
  ctx: ProjectContext,
  input: z.infer<typeof addReferenceInput>
): Promise<string> {
  const provider = input.provider ?? DEFAULT_PROVIDER
  const outcome = await lookupByDoi(provider, input.doi)
  if (outcome.error !== null) return `${provider}: ${outcome.error} — nothing added`
  if (outcome.result === null) return `${provider}: no record for DOI ${input.doi} — nothing added`

  const path = resolveInside(ctx.root, ctx.dirs.manuscript, 'references.bib')
  const bib = await readBibText(path)
  if (bib.error !== null) {
    return `${bib.error} — NOTHING WAS WRITTEN, so the existing bibliography is intact; fix the file's permissions first`
  }
  const appended = appendLitResultToBib(bib.text, outcome.result)
  await writeFile(path, appended.text, 'utf8')
  return `added ${appended.key} to references.bib: ${appended.entry.title}`
}
