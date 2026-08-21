/**
 * Which shipped example a user's example-project copy came from.
 *
 * The copy under userData is made once and then reused forever so the user's
 * edits and commits survive — but "forever" outlived the shipped example
 * itself: a copy taken when the bundled demo was `examples/demo-paper`
 * carried on opening as that paper long after the app started shipping
 * `examples/hello-suna`, and every door to the example (welcome screen,
 * Project menu, the guided tour) landed on the wrong manuscript.
 *
 * So the copy carries a stamp naming its source. A copy whose stamp does not
 * match the shipped example is not deleted — it may hold real work — it is
 * moved aside under a name derived from its own manifest, and a fresh copy
 * takes its place.
 */

/** Written at the root of the copy. Dot-prefixed so it stays out of the way. */
export const EXAMPLE_STAMP_FILE = '.suna-example.json'

export function serializeExampleStamp(sourceId: string): string {
  return `${JSON.stringify({ source: sourceId }, null, 2)}\n`
}

/**
 * The source id a stamp names, or null for anything unreadable — including
 * the copies made before stamps existed, which is exactly the case that has
 * to re-copy.
 */
export function parseExampleStamp(text: string): string | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const source = (json as Record<string, unknown>)['source']
  return typeof source === 'string' && source !== '' ? source : null
}

/**
 * A directory-safe slug of a project name: lowercase, ASCII-ish, hyphenated,
 * and never empty. Used only to name an archived copy, so a lossy transform
 * is fine as long as it is stable and legible.
 */
export function slugifyProjectName(name: string): string {
  const slug = name
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex -- strips accents and controls
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug === '' ? 'previous' : slug
}

/**
 * Where to move a copy that came from a different example. Never returns a
 * name already in `taken`, so an archive can never overwrite an earlier one.
 */
export function archiveDirName(base: string, label: string, taken: readonly string[]): string {
  const first = `${base}-${label}`
  if (!taken.includes(first)) return first
  for (let n = 2; n < 1000; n++) {
    const candidate = `${first}-${n}`
    if (!taken.includes(candidate)) return candidate
  }
  // Unreachable in practice; a name that collides is still better than a throw
  // that stops the example from opening at all.
  return `${first}-${taken.length + 1}`
}
