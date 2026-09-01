import { describe, expect, it } from 'vitest'
import { buildPageText, type PageText } from '@suna/core'
import {
  anchorsFromRuns,
  quoteWithCitation,
  citedPageLabel,
  quoteFromRuns,
  runsForPage
} from './pdfSelection'

/**
 * The pure half of PDF selection (ARCHITECTURE §14.4). The DOM walk in
 * `readPdfSelection` needs a live pdf.js text layer and is measured by
 * `scripts/e2e/probes/pdf-quote.mjs` instead — the same split
 * `CommentsRail.test.ts` makes.
 */

const t = (str: string, hasEOL = false): { str: string; hasEOL: boolean } => ({ str, hasEOL })

/** A two-column page whose content order puts a caption between two body lines. */
const PAGE_5: PageText = buildPageText([
  t('Galaxies falling into dense cluster environ-', true), // 0
  t('ments can lose their star-forming gas within', true), // 1
  t('FIG. 2. Velocity map of the cluster core.', true), //     2  <- interloper
  t('a few hundred million years.', true), //                  3
  t('') //                                                     4  <- empty, never in the DOM
])

const PAGES = new Map<number, PageText>([[5, PAGE_5]])

describe('runsForPage', () => {
  it('covers whole items when no endpoint offsets are given', () => {
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [0, 1] })
    expect(runs).toHaveLength(1)
    expect(PAGE_5.text.slice(runs[0]!.from, runs[0]!.to)).toBe(
      'Galaxies falling into dense cluster environments can lose their star-forming gas within'
    )
  })

  it('splits into two runs when an unselected item sits between two selected ones', () => {
    // The whole reason `runs[]` exists: items 0,1 and 3 are visually adjacent
    // body lines; item 2 is a caption elsewhere on the page.
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [0, 1, 3] })
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ itemStart: 0, itemEnd: 1 })
    expect(runs[1]).toMatchObject({ itemStart: 3, itemEnd: 3 })
  })

  it('never quotes the item the reader did not select', () => {
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [0, 1, 3] })
    const quote = quoteFromRuns(runs, PAGES)
    expect(quote).toBe(
      'Galaxies falling into dense cluster environments can lose their star-forming gas within ' +
        'a few hundred million years.'
    )
    expect(quote).not.toContain('Velocity map')
  })

  it('trims the first and last items to where the drag started and stopped', () => {
    const runs = runsForPage({
      page: 5,
      pageText: PAGE_5,
      itemIndices: [0, 1],
      startWithin: 9, // after "Galaxies "
      endWithin: 8 // "ments ca"
    })
    expect(runs).toHaveLength(1)
    expect(PAGE_5.text.slice(runs[0]!.from, runs[0]!.to)).toBe(
      'falling into dense cluster environments ca'
    )
  })

  it('applies endpoint offsets only to the first and last selected items', () => {
    const runs = runsForPage({
      page: 5,
      pageText: PAGE_5,
      itemIndices: [0, 1, 3],
      startWithin: 9,
      endWithin: 5
    })
    expect(runs).toHaveLength(2)
    // run 0 is trimmed at its start but runs to the end of item 1
    expect(PAGE_5.text.slice(runs[0]!.from, runs[0]!.to)).toBe(
      'falling into dense cluster environments can lose their star-forming gas within'
    )
    // run 1 is trimmed at its end
    expect(PAGE_5.text.slice(runs[1]!.from, runs[1]!.to)).toBe('a few')
  })

  it('skips empty items, which can never be selected and would bridge a real gap', () => {
    // Item 4 is empty. Including it must not merge anything or emit a run.
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [3, 4] })
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ itemStart: 3, itemEnd: 3 })
  })

  it('honours explicit start/end items rather than inferring from min/max', () => {
    // The DOM caller knows which span the Range actually began in; inferring
    // it from the lowest touched index silently mis-trims when the starting
    // span is empty and gets filtered out.
    const runs = runsForPage({
      page: 5,
      pageText: PAGE_5,
      itemIndices: [0, 1],
      startItem: 1,
      startWithin: 6,
      endItem: 1,
      endWithin: 14
    })
    expect(runs).toHaveLength(1)
    expect(PAGE_5.text.slice(runs[0]!.from, runs[0]!.to)).toBe('can lose')
  })

  it('covers a whole item when the caller gives no offsets for it', () => {
    // The regression this guards: a Range whose container is the SPAN, not a
    // text node — selectNodeContents, double-click, triple-click, Select All
    // — has offsets that index CHILD NODES. Reading endOffset=1 as one
    // character turned a whole selected line into the quote "D". The DOM layer
    // now converts, and the pure layer must treat an absent offset as "whole".
    const whole = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [1] })
    expect(PAGE_5.text.slice(whole[0]!.from, whole[0]!.to)).toBe(
      'ments can lose their star-forming gas within'
    )
    const clamped = runsForPage({
      page: 5,
      pageText: PAGE_5,
      itemIndices: [1],
      startItem: 1,
      startWithin: 0,
      endItem: 1,
      endWithin: 44
    })
    expect(clamped[0]!.to).toBe(whole[0]!.to)
  })

  it('returns nothing for an empty or out-of-range selection', () => {
    expect(runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [] })).toEqual([])
    expect(runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [99] })).toEqual([])
  })

  it('drops a run that collapses to zero width after trimming', () => {
    const runs = runsForPage({
      page: 5,
      pageText: PAGE_5,
      itemIndices: [0],
      startWithin: 4,
      endWithin: 4
    })
    expect(runs).toEqual([])
  })
})

describe('quoteFromRuns', () => {
  it('joins runs with a single space, never gluing them tight', () => {
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [1, 3] })
    expect(quoteFromRuns(runs, PAGES)).toBe(
      'ments can lose their star-forming gas within a few hundred million years.'
    )
  })

  it('gives back only the half of a broken word that was actually selected', () => {
    // "environ-\nments" was rejoined into one word spanning items 0 and 1, so
    // item 0 alone holds "environ". Selecting one line of a hyphenated word
    // therefore quotes a fragment — which is the truth about what was
    // selected, and the reason a drag normally covers both lines.
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [0] })
    expect(quoteFromRuns(runs, PAGES)).toBe('Galaxies falling into dense cluster environ')
  })

  it('ignores a run whose page is not registered', () => {
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [0] })
    expect(quoteFromRuns(runs, new Map())).toBe('')
  })
})

describe('anchorsFromRuns', () => {
  it('emits one anchor per run, carrying the page hint', () => {
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [0, 1, 3] })
    const anchors = anchorsFromRuns(runs, PAGES)
    expect(anchors).toHaveLength(2)
    expect(anchors.every((a) => a.page === 5)).toBe(true)
  })

  it('captures surrounding context, so a repeated quote can be disambiguated', () => {
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [3] })
    const [anchor] = anchorsFromRuns(runs, PAGES)
    expect(anchor!.quote).toBe('a few hundred million years.')
    expect(anchor!.prefix).not.toBe('')
    expect(anchor!.prefix.endsWith(' ')).toBe(true)
  })

  it('round-trips: every anchor quote is found in its page text', () => {
    const runs = runsForPage({ page: 5, pageText: PAGE_5, itemIndices: [0, 1, 3] })
    for (const anchor of anchorsFromRuns(runs, PAGES)) {
      expect(PAGE_5.text).toContain(anchor.quote)
    }
  })
})

describe('citedPageLabel', () => {
  it('prefers the label the PDF declares', () => {
    expect(citedPageLabel(3, ['i', 'ii', 'S1'])).toBe('S1')
  })

  it('falls back to the index when the PDF declares none — the arXiv case', () => {
    // getPageLabels() returns null for arXiv and CVPR, the preprints most read.
    expect(citedPageLabel(3, null)).toBe('3')
  })

  it('applies the per-document correction the user sets once', () => {
    expect(citedPageLabel(3, null, 108)).toBe('111')
  })

  it('ignores a declared label that is blank', () => {
    expect(citedPageLabel(2, ['1', '   '])).toBe('2')
  })
})

describe('quoteWithCitation', () => {
  it('reads as prose someone typed, with the citation inline', () => {
    expect(quoteWithCitation('Ram pressure strips the gas.', 'gunn1972', '3')).toBe(
      'Ram pressure strips the gas [@gunn1972, p. 3].'
    )
  })

  it('moves sentence-final punctuation after the bracket, where a writer puts it', () => {
    expect(quoteWithCitation('the gas is stripped,', 'gunn1972', '3')).toBe(
      'the gas is stripped [@gunn1972, p. 3],'
    )
    expect(quoteWithCitation('is it stripped?', 'k', '1')).toBe('is it stripped [@k, p. 1]?')
  })

  it('appends the citation when the passage ends mid-clause', () => {
    expect(quoteWithCitation('ram pressure stripping', 'gunn1972', '3')).toBe(
      'ram pressure stripping [@gunn1972, p. 3]'
    )
  })

  it('omits the locator when the page is unknown', () => {
    expect(quoteWithCitation('Some text.', 'gunn1972', null)).toBe('Some text [@gunn1972].')
  })

  it('returns the bare passage when the PDF is not a known reference', () => {
    expect(quoteWithCitation('Some text.', null, '3')).toBe('Some text.')
  })

  it('flattens the line breaks a PDF page put in the middle of a sentence', () => {
    // Newlines in a PDF quote are an artifact of the column, not the prose.
    expect(quoteWithCitation('the star formation\nrate falls.', 'k', '2')).toBe(
      'the star formation rate falls [@k, p. 2].'
    )
  })
})
