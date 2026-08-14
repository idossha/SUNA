import type { Affiliation, ArticleType, Author } from '@suna/core'
import { OrcidSchema } from '@suna/core'

/**
 * Pure logic for the editable title page: manuscript.json patch builders
 * (one per field, always the SMALLEST top-level-key set that expresses the
 * change — `manuscript:update`'s deep-merge replaces arrays/scalars/null
 * wholesale, so an array field's "smallest patch" is still the whole array),
 * plain array/list operations, and client-side validation that mirrors the
 * server's ManuscriptSchema closely enough to reject obviously-bad input
 * before a round trip. The server's zod validation remains the real gate —
 * these helpers exist to give immediate, testable, framework-free feedback.
 */

export type ManuscriptPatch = Record<string, unknown>

// ---- scalar field patches --------------------------------------------------

export function titlePatch(value: string): ManuscriptPatch {
  return { title: value }
}

export function shortTitlePatch(value: string): ManuscriptPatch {
  return { shortTitle: value }
}

export function articleTypePatch(value: ArticleType): ManuscriptPatch {
  return { articleType: value }
}

export function abstractPatch(value: string): ManuscriptPatch {
  return { abstract: { content: value } }
}

/** Empty (after trim) clears the nullable field — ManuscriptSchema forbids `''`. */
export function significancePatch(value: string): ManuscriptPatch {
  return { significance: value.trim() === '' ? null : value }
}

// ---- array field patches ---------------------------------------------------

export function highlightsPatch(list: readonly string[]): ManuscriptPatch {
  return { highlights: list.length === 0 ? null : [...list] }
}

export function authorsPatch(list: readonly Author[]): ManuscriptPatch {
  return { authors: [...list] }
}

export function affiliationsPatch(list: readonly Affiliation[]): ManuscriptPatch {
  return { affiliations: [...list] }
}

// ---- validation --------------------------------------------------------

export function isValidOrcid(value: string): boolean {
  return OrcidSchema.safeParse(value).success
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value)
}

/** First problem found, or null if the whole author list is commit-worthy. */
export function validateAuthors(list: readonly Author[]): string | null {
  if (list.length === 0) return 'At least one author is required.'
  for (const author of list) {
    const who = `${author.given.trim()} ${author.family.trim()}`.trim() || 'An author'
    if (author.given.trim() === '') return `${who}: given name is required.`
    if (author.family.trim() === '') return `${who}: family name is required.`
    if (author.orcid !== null && !isValidOrcid(author.orcid)) {
      return `${who}: ORCID must look like 0000-0002-1825-0097.`
    }
    if (author.email !== null && !isValidEmail(author.email)) {
      return `${who}: email address looks invalid.`
    }
  }
  return null
}

export function validateAffiliations(list: readonly Affiliation[]): string | null {
  for (const affiliation of list) {
    if (affiliation.text.trim() === '') return 'Affiliation text cannot be empty.'
  }
  return null
}

// ---- generic list ops ---------------------------------------------------

/** Swap index with its neighbor in `direction`; a no-op copy at either edge. */
export function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return [...list]
  }
  const next = [...list]
  const a = next[index]
  const b = next[target]
  if (a === undefined || b === undefined) return [...list]
  next[index] = b
  next[target] = a
  return next
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

/** `prefix + N` where N is one past the highest existing `prefix<digits>` id. */
export function nextId(prefix: string, existing: readonly { id: string }[]): string {
  const re = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const item of existing) {
    const m = re.exec(item.id)
    if (m === null) continue
    const raw = m[1]
    if (raw === undefined) continue
    const n = Number(raw)
    if (n > max) max = n
  }
  return `${prefix}${max + 1}`
}

// ---- highlight list ops ---------------------------------------------------

export function addHighlight(list: readonly string[], text: string): string[] {
  return [...list, text]
}

export function removeHighlight(list: readonly string[], index: number): string[] {
  return removeAt(list, index)
}

export function reorderHighlight(list: readonly string[], index: number, direction: -1 | 1): string[] {
  return moveItem(list, index, direction)
}

export function updateHighlight(list: readonly string[], index: number, text: string): string[] {
  return list.map((h, i) => (i === index ? text : h))
}

// ---- author list ops --------------------------------------------------

export function blankAuthor(existing: readonly Author[]): Author {
  return {
    id: nextId('a', existing),
    given: 'First',
    family: 'Last',
    nativeScript: null,
    orcid: null,
    affiliationRefs: [],
    corresponding: false,
    email: null,
    equalContribution: false,
    deceased: false
  }
}

export function updateAuthor(list: readonly Author[], id: string, patch: Partial<Author>): Author[] {
  return list.map((a) => (a.id === id ? { ...a, ...patch } : a))
}

export function removeAuthorById(list: readonly Author[], id: string): Author[] {
  return list.filter((a) => a.id !== id)
}

export function moveAuthorById(list: readonly Author[], id: string, direction: -1 | 1): Author[] {
  const idx = list.findIndex((a) => a.id === id)
  if (idx < 0) return [...list]
  return moveItem(list, idx, direction)
}

export function toggleAffiliationRef(refs: readonly string[], affiliationId: string): string[] {
  return refs.includes(affiliationId) ? refs.filter((r) => r !== affiliationId) : [...refs, affiliationId]
}

// ---- affiliation list ops --------------------------------------------

export function blankAffiliation(existing: readonly Affiliation[]): Affiliation {
  return { id: nextId('af', existing), text: 'New affiliation' }
}

export function updateAffiliation(
  list: readonly Affiliation[],
  id: string,
  patch: Partial<Affiliation>
): Affiliation[] {
  return list.map((a) => (a.id === id ? { ...a, ...patch } : a))
}

export function removeAffiliationById(list: readonly Affiliation[], id: string): Affiliation[] {
  return list.filter((a) => a.id !== id)
}

export function moveAffiliationById(list: readonly Affiliation[], id: string, direction: -1 | 1): Affiliation[] {
  const idx = list.findIndex((a) => a.id === id)
  if (idx < 0) return [...list]
  return moveItem(list, idx, direction)
}
