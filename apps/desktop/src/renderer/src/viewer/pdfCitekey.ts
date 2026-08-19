import type { PdfResolution } from '@suna/bib'

/**
 * Which reference is this open PDF (ADR-008)?
 *
 * `PdfTab` is handed only a path, but reading notes are keyed by citekey —
 * the one identifier that survives ADR-007 re-acquiring a paper, where the
 * bytes, the filename and the fingerprint can all change.
 *
 * The reverse lookup has to be careful because `resolvePdfPath`'s third tier
 * is fuzzy: it matches any basename starting `fold(family)_fold(year)`, so
 * `smith2020a` and `smith2020b` BOTH claim `Smith_2020_Foo.pdf` — and the
 * librarian skill names files in exactly that shape. Letting Map iteration
 * order pick a winner would attach one paper's reading notes to another's PDF,
 * invisibly. So an ambiguous path is reported as ambiguous.
 */

export type PdfCitekeyMatch =
  | { kind: 'one'; citekey: string; how: 'filename' | 'resolved' }
  | { kind: 'ambiguous'; citekeys: string[] }
  | { kind: 'none' }

/** Last path segment, for both POSIX and Windows separators. */
function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/** Compare two paths that may differ only by an absolute project-root prefix. */
function samePath(a: string, b: string): boolean {
  if (a === b) return true
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

/**
 * Resolve `pdfPath` to the citekey whose notes belong to it.
 *
 * Tier 1 is the conventional name `references/<citekey>.pdf`, which wins
 * outright — it is the path ADR-007's ladder writes and the one
 * `resolvePdfPath` looks for first, so a file named that way is never
 * ambiguous however many fuzzy claims exist beside it.
 *
 * Tier 2 reverses the resolution map and requires a unique claimant.
 */
export function citekeyForPdfPath(
  map: ReadonlyMap<string, PdfResolution | null>,
  pdfPath: string
): PdfCitekeyMatch {
  const name = basename(pdfPath)
  const conventional = /\.pdf$/i.test(name) ? name.slice(0, -4) : null

  if (conventional !== null && map.has(conventional)) {
    const resolution = map.get(conventional)
    if (resolution != null && samePath(resolution.path, pdfPath)) {
      return { kind: 'one', citekey: conventional, how: 'filename' }
    }
  }

  const claimants: string[] = []
  for (const [citekey, resolution] of map) {
    if (resolution != null && samePath(resolution.path, pdfPath)) claimants.push(citekey)
  }
  claimants.sort()

  if (claimants.length === 1) return { kind: 'one', citekey: claimants[0] as string, how: 'resolved' }
  if (claimants.length > 1) return { kind: 'ambiguous', citekeys: claimants }
  return { kind: 'none' }
}

/** One sentence explaining why a PDF has no citekey, for the popover. */
export function describeCitekeyMatch(match: PdfCitekeyMatch): string | null {
  switch (match.kind) {
    case 'one':
      return null
    case 'ambiguous':
      return `${match.citekeys.join(', ')} all resolve to this file — rename it to references/<citekey>.pdf to say which paper it is.`
    case 'none':
      return 'This PDF is not a reference in this project, so a quote from it carries no citation.'
  }
}
