/** Pure display formatting for a LitResult card — no IO, no React. */

/** Join display names; "et al." after the third once there are more. */
export function formatAuthors(authors: readonly string[]): string {
  if (authors.length === 0) return 'Unknown authors'
  if (authors.length <= 3) return authors.join(', ')
  return `${authors.slice(0, 3).join(', ')} et al.`
}

/** "2019 · Nature Astronomy", tolerating either half being absent. */
export function formatYearVenue(year: number | null, venue: string | null): string {
  const parts = [year !== null ? String(year) : null, venue].filter(
    (part): part is string => part !== null && part.trim() !== ''
  )
  return parts.join(' · ')
}

/** "1,204 citations" / "1 citation" / "" when the provider gave no count. */
export function formatCitedBy(citedByCount: number | null): string {
  if (citedByCount === null) return ''
  return `${citedByCount.toLocaleString()} citation${citedByCount === 1 ? '' : 's'}`
}
