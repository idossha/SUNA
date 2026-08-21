/**
 * "Find similar" (Library row menu → Search tab).
 *
 * The search that runs is a title search, not a DOI lookup: a DOI resolves to
 * exactly one work — the one you right-clicked — so looking it up answers a
 * question nobody asked and leaves the panel showing the seed paper as its
 * only "similar" result. The seed is instead used to recognise itself in the
 * hits and drop it, so what remains is other papers.
 */

/** The paper a "Find similar" search started from. */
export interface SeedWork {
  doi: string | null
  title: string
}

/** Bare DOI, lowercased: providers return `10.1/x`, `doi:10.1/x` and
 *  `https://doi.org/10.1/X` for the same work. */
export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:/, '')
}

/** Punctuation and spacing vary between providers for the same title
 *  (en-dashes, colons, trailing periods), so compare on words alone. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Is this hit the paper the search started from? Two DOIs decide it on their
 * own — different DOIs are different works, whatever the titles say. Only
 * when one side has no DOI does the title stand in.
 */
export function isSeedWork(
  result: { doi: string | null; title: string },
  seed: SeedWork | null
): boolean {
  if (seed === null) return false
  if (seed.doi !== null && result.doi !== null) {
    return normalizeDoi(seed.doi) === normalizeDoi(result.doi)
  }
  return normalizeTitle(result.title) === normalizeTitle(seed.title)
}
