import type { Affiliation, Author } from '@suna/core'

/**
 * Pure derivations for the rendered title page. Numbering is derived here at
 * render time (never stored): affiliations are numbered by first appearance
 * in author order via affiliationRefs; unreferenced affiliations follow in
 * their manuscript.json array order.
 */

export type TexSegment = { kind: 'text'; value: string } | { kind: 'math'; value: string }

/** Split "…$math$…" into text/math segments. Unclosed `$` stays literal text. */
export function splitTexSpans(source: string): TexSegment[] {
  const segments: TexSegment[] = []
  let rest = source
  for (;;) {
    const open = rest.indexOf('$')
    if (open < 0) break
    const close = rest.indexOf('$', open + 1)
    if (close < 0) break
    if (open > 0) segments.push({ kind: 'text', value: rest.slice(0, open) })
    segments.push({ kind: 'math', value: rest.slice(open + 1, close) })
    rest = rest.slice(close + 1)
  }
  if (rest !== '') segments.push({ kind: 'text', value: rest })
  return segments
}

export interface AffiliationNumbering {
  /** Affiliations in display order (numbered 1..n by list position). */
  ordered: Affiliation[]
  /** Affiliation id → display number. */
  numberOf: Map<string, number>
}

export function numberAffiliations(
  authors: readonly Author[],
  affiliations: readonly Affiliation[]
): AffiliationNumbering {
  const byId = new Map(affiliations.map((a) => [a.id, a]))
  const ordered: Affiliation[] = []
  const numberOf = new Map<string, number>()
  const push = (id: string): void => {
    const affiliation = byId.get(id)
    if (affiliation === undefined || numberOf.has(id)) return
    ordered.push(affiliation)
    numberOf.set(id, ordered.length)
  }
  for (const author of authors) for (const id of author.affiliationRefs) push(id)
  for (const affiliation of affiliations) push(affiliation.id)
  return { ordered, numberOf }
}

/** Superscript markers for one author, e.g. ["1", "2", "*"]. */
export function authorMarkers(
  author: Author,
  numberOf: ReadonlyMap<string, number>
): string[] {
  const markers: string[] = []
  for (const id of author.affiliationRefs) {
    const n = numberOf.get(id)
    if (n !== undefined) markers.push(String(n))
  }
  if (author.corresponding) markers.push('*')
  return markers
}
