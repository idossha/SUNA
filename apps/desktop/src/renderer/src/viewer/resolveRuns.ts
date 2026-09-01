import { locate, type PageText, type PdfNoteRun } from '@suna/core'
import type { RenderedPage } from './pdfSelection'
import { occurrencesOf } from './pdfGeometry'

/**
 * Finding a stored run again on a PDF that may have changed underneath it
 * (ARCHITECTURE §14.4). Pure: takes page texts, returns a verdict — no DOM, no store.
 *
 * The cascade is Hypothesis's, adapted, and the page HINT is the load-bearing
 * part rather than an optimisation. `packages/core/src/anchor.ts` returns its
 * first tier the moment a quote appears exactly once in the text it is given,
 * and says so in its own header: *"if the quote appears exactly once, that's
 * it, regardless of whether the surrounding prefix/suffix has drifted."*
 *
 * Ask it page by page and that guarantee turns into a bug. A highlight on
 * "the star formation rate", in a paper where pages 3, 8, 12 and 19 each
 * contain that phrase once, is unique on all four — so it paints on all four,
 * on first use, with no drift and no PDF change. Trying the hinted page first
 * and only widening when it fails is what keeps one highlight one highlight.
 */

export type RunResolutionKind = 'anchored' | 'moved' | 'ambiguous' | 'detached'

export interface RunResolution {
  kind: RunResolutionKind
  /** Page the run was found on; unchanged from the hint for 'anchored'. */
  page: number
  /** Offsets into that page's text. Absent when detached. */
  offsets?: { from: number; to: number }
  /** How many equally-good matches existed, when the answer was ambiguous. */
  occurrences?: number
}

/** Pages to try, in order: the hint, then its neighbours, then everything else. */
export function searchOrder(hint: number, pages: readonly number[]): number[] {
  const available = new Set(pages)
  const out: number[] = []
  const push = (page: number): void => {
    if (available.has(page) && !out.includes(page)) out.push(page)
  }
  push(hint)
  for (let d = 1; d <= 2; d += 1) {
    push(hint - d)
    push(hint + d)
  }
  for (const page of [...pages].sort((a, b) => a - b)) push(page)
  return out
}

/**
 * Resolve one run against the page texts available.
 *
 * `ambiguous` is reported rather than resolved when a page holds several
 * copies of the quote and the stored context picks none of them — the same
 * refusal-to-guess ARCHITECTURE §3.1 D2 applies to citations, for the same reason: a wrong
 * answer here is invisible and permanent.
 */
export function resolveRun(
  run: PdfNoteRun,
  pageTexts: ReadonlyMap<number, PageText>
): RunResolution {
  const pages = [...pageTexts.keys()]
  if (pages.length === 0) return { kind: 'detached', page: run.page }

  for (const page of searchOrder(run.page, pages)) {
    const pageText = pageTexts.get(page)
    if (pageText === undefined) continue

    const hits = occurrencesOf(pageText, run.quote)
    if (hits.length === 0) continue

    if (hits.length === 1) {
      const kind = page === run.page ? 'anchored' : 'moved'
      return { kind, page, offsets: hits[0] }
    }

    // Several copies on this page: let the stored context choose. `locate`
    // scores prefix/suffix against each occurrence and falls back to a
    // whitespace-normalised fuzzy match.
    const located = locate(pageText.text, {
      quote: run.quote,
      prefix: run.prefix,
      suffix: run.suffix
    })
    if (located !== null) {
      const chosen = hits.find((hit) => hit.from === located.from)
      // `locate` landing on an occurrence the context actually distinguishes
      // is an answer; landing on the first one by default is not, and the
      // difference is whether any stored context existed at all.
      if (chosen !== undefined && (run.prefix !== '' || run.suffix !== '')) {
        const kind = page === run.page ? 'anchored' : 'moved'
        return { kind, page, offsets: chosen }
      }
    }
    return { kind: 'ambiguous', page, occurrences: hits.length, offsets: hits[0] }
  }

  return { kind: 'detached', page: run.page }
}

/** Page texts for every page whose text layer has rendered. */
export function pageTextsOf(rendered: readonly RenderedPage[]): Map<number, PageText> {
  const map = new Map<number, PageText>()
  for (const entry of rendered) map.set(entry.page, entry.pageText)
  return map
}
