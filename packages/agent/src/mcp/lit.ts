import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { LitProviderIdSchema, type LitProviderId, type LitResult } from '@suna/core'
import { appendLitResultToBib, lookupByDoi, searchLiterature } from '@suna/bib'
import { resolveInside, type ProjectContext } from './project'

/**
 * MCP-side literature verbs — thin wrappers over the shared provider module
 * in @suna/bib (packages/bib/src/providers.ts: the exact fetch/mapping logic
 * apps/desktop's main process uses for the lit:search/lit:by-doi IPC
 * channels, lifted there so both hosts run identical provider behavior).
 *
 * No API keys here: the MCP server runs standalone, without the Electron app
 * and without access to its encrypted key store (safeStorage), so every call
 * is keyless — Crossref (the default) and arXiv work as normal, OpenAlex
 * runs metered, and ADS reports the same "needs a free API key" message the
 * app shows. `add_reference` reuses `appendLitResultToBib` from @suna/bib,
 * the same append logic the desktop UI's "Add to references.bib" button
 * uses, so both paths produce byte-identical entries for the same DOI.
 */

const DEFAULT_PROVIDER: LitProviderId = 'crossref'

function formatResult(result: LitResult): string {
  const authors = result.authors.length > 0 ? result.authors.join(', ') : 'Unknown authors'
  const year = result.year !== null ? String(result.year) : 'n.d.'
  const doi = result.doi !== null ? ` doi:${result.doi}` : ''
  const oa = result.openAccessUrl !== null ? ` [OA: ${result.openAccessUrl}]` : ''
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
  let current: string
  try {
    current = await readFile(path, 'utf8')
  } catch {
    current = '' // no references.bib yet — this creates it
  }
  const appended = appendLitResultToBib(current, outcome.result)
  await writeFile(path, appended.text, 'utf8')
  return `added ${appended.key} to references.bib: ${appended.entry.title}`
}
