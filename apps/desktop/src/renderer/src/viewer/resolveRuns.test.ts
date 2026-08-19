import { describe, expect, it } from 'vitest'
import { buildPageText, makeAnchor, type PageText, type PdfNoteRun } from '@suna/core'
import { resolveRun, searchOrder } from './resolveRuns'

/**
 * The re-anchoring cascade (ADR-008 M2/M4). Pure — page texts in, verdict out.
 */

const page = (text: string): PageText => buildPageText([{ str: text, hasEOL: false }])

/** A run built the way the viewer builds one, so context is realistic. */
function runFor(pageNumber: number, pageText: PageText, quote: string): PdfNoteRun {
  const from = pageText.text.indexOf(quote)
  if (from === -1) throw new Error(`fixture does not contain ${JSON.stringify(quote)}`)
  const anchor = makeAnchor(pageText.text, from, from + quote.length)
  return { page: pageNumber, ...anchor, detached: false }
}

describe('searchOrder', () => {
  it('tries the hinted page first, then its neighbours, then the rest', () => {
    expect(searchOrder(5, [1, 2, 3, 4, 5, 6, 7, 8])).toEqual([5, 4, 6, 3, 7, 1, 2, 8])
  })

  it('skips pages that are not rendered', () => {
    expect(searchOrder(5, [1, 5, 9])).toEqual([5, 1, 9])
  })

  it('still searches when the hint itself is not available', () => {
    expect(searchOrder(5, [1, 2])).toEqual([1, 2])
  })

  it('is empty when nothing is rendered', () => {
    expect(searchOrder(5, [])).toEqual([])
  })
})

describe('resolveRun', () => {
  const p3 = page('Ram pressure strips the gas and the star formation rate then falls sharply.')
  const p8 = page('Elsewhere the star formation rate is measured directly.')
  const p12 = page('We compare the star formation rate against the model.')

  it('anchors on the hinted page', () => {
    const run = runFor(3, p3, 'strips the gas')
    const result = resolveRun(run, new Map([[3, p3]]))
    expect(result.kind).toBe('anchored')
    expect(result.page).toBe(3)
    expect(p3.text.slice(result.offsets!.from, result.offsets!.to)).toBe('strips the gas')
  })

  it('reports a move when the quote turns up on a different page', () => {
    // The PDF was replaced (preprint -> published) and everything shifted.
    const run = runFor(3, p3, 'strips the gas')
    const result = resolveRun({ ...run, page: 5 }, new Map([[3, p3]]))
    expect(result.kind).toBe('moved')
    expect(result.page).toBe(3)
  })

  it('does NOT paint on every page that happens to contain the phrase', () => {
    // The failure this whole cascade exists to prevent: `locate` returns its
    // first tier whenever a quote is unique in the text it is handed, so
    // asking page by page makes one highlight into four.
    const run = runFor(3, p3, 'the star formation rate')
    const pages = new Map([
      [3, p3],
      [8, p8],
      [12, p12]
    ])
    const result = resolveRun(run, pages)
    expect(result.kind).toBe('anchored')
    expect(result.page).toBe(3)
  })

  it('falls back to a neighbour before a distant page', () => {
    const run = runFor(9, p8, 'measured directly')
    const result = resolveRun(run, new Map([[8, p8], [12, p12]]))
    expect(result.page).toBe(8)
    expect(result.kind).toBe('moved')
  })

  it('detaches rather than guessing when the quote is gone', () => {
    const run = runFor(3, p3, 'strips the gas')
    const result = resolveRun(run, new Map([[8, p8]]))
    expect(result.kind).toBe('detached')
    expect(result.page).toBe(3)
    expect(result.offsets).toBeUndefined()
  })

  it('detaches when nothing is rendered yet', () => {
    const run = runFor(3, p3, 'strips the gas')
    expect(resolveRun(run, new Map()).kind).toBe('detached')
  })

  describe('several copies on one page', () => {
    const repeated = page('the model. We fit the model. Later we revisit the model again.')

    it('uses stored context to choose between them', () => {
      const run = runFor(1, repeated, 'the model')
      // makeAnchor captured "We fit " as the prefix of the SECOND occurrence
      // only if that is where we sliced; take the third to be unambiguous.
      const from = repeated.text.lastIndexOf('the model')
      const anchored: PdfNoteRun = {
        page: 1,
        ...makeAnchor(repeated.text, from, from + 'the model'.length),
        detached: false
      }
      const result = resolveRun(anchored, new Map([[1, repeated]]))
      expect(result.kind).toBe('anchored')
      expect(result.offsets!.from).toBe(from)
      expect(run.quote).toBe('the model')
    })

    it('refuses to guess when there is no context at all', () => {
      const bare: PdfNoteRun = { page: 1, quote: 'the model', prefix: '', suffix: '', detached: false }
      const result = resolveRun(bare, new Map([[1, repeated]]))
      expect(result.kind).toBe('ambiguous')
      expect(result.occurrences).toBe(3)
      // Still reports somewhere to paint, so the note is visible and flagged
      // rather than silently missing.
      expect(result.offsets).toBeDefined()
    })
  })
})
