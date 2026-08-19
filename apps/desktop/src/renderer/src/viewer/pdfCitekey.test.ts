import { describe, expect, it } from 'vitest'
import type { PdfResolution } from '@suna/bib'
import { citekeyForPdfPath, describeCitekeyMatch } from './pdfCitekey'

const ROOT = '/Users/x/project'
const res = (path: string, how: PdfResolution['how'] = 'citekey'): PdfResolution => ({ path, how })

describe('citekeyForPdfPath', () => {
  it('matches the conventional references/<citekey>.pdf name', () => {
    const map = new Map([['gunn1972', res(`${ROOT}/references/gunn1972.pdf`)]])
    expect(citekeyForPdfPath(map, `${ROOT}/references/gunn1972.pdf`)).toEqual({
      kind: 'one',
      citekey: 'gunn1972',
      how: 'filename'
    })
  })

  it('reverses the map for a file field pointing somewhere else', () => {
    const map = new Map([['moore1996', res(`${ROOT}/references/Moore_1996_Galaxy.pdf`, 'file-field')]])
    expect(citekeyForPdfPath(map, `${ROOT}/references/Moore_1996_Galaxy.pdf`)).toEqual({
      kind: 'one',
      citekey: 'moore1996',
      how: 'resolved'
    })
  })

  it('refuses to guess when two citekeys fuzzily claim one file', () => {
    // The real failure: resolvePdfPath's fuzzy tier matches any basename
    // starting fold(family)_fold(year), and the librarian skill names files
    // exactly that way, so smith2020a and smith2020b both claim this PDF.
    const map = new Map([
      ['smith2020a', res(`${ROOT}/references/Smith_2020_Foo.pdf`, 'fuzzy')],
      ['smith2020b', res(`${ROOT}/references/Smith_2020_Foo.pdf`, 'fuzzy')]
    ])
    expect(citekeyForPdfPath(map, `${ROOT}/references/Smith_2020_Foo.pdf`)).toEqual({
      kind: 'ambiguous',
      citekeys: ['smith2020a', 'smith2020b']
    })
  })

  it('lets the conventional filename break a tie the fuzzy tier created', () => {
    // gunn1972.pdf is the name ADR-007's ladder writes; a fuzzy claim from a
    // neighbouring key must not make the project's own convention ambiguous.
    const map = new Map([
      ['gunn1972', res(`${ROOT}/references/gunn1972.pdf`, 'citekey')],
      ['gunn1972b', res(`${ROOT}/references/gunn1972.pdf`, 'fuzzy')]
    ])
    expect(citekeyForPdfPath(map, `${ROOT}/references/gunn1972.pdf`)).toEqual({
      kind: 'one',
      citekey: 'gunn1972',
      how: 'filename'
    })
  })

  it('matches across the absolute/relative split the scan can produce', () => {
    const map = new Map([['gunn1972', res('references/gunn1972.pdf')]])
    expect(citekeyForPdfPath(map, `${ROOT}/references/gunn1972.pdf`)).toMatchObject({
      kind: 'one',
      citekey: 'gunn1972'
    })
  })

  it('is none for a PDF that is not a reference', () => {
    const map = new Map([['gunn1972', res(`${ROOT}/references/gunn1972.pdf`)]])
    expect(citekeyForPdfPath(map, `${ROOT}/output/export.pdf`)).toEqual({ kind: 'none' })
  })

  it('ignores citekeys whose PDF never resolved', () => {
    const map = new Map<string, PdfResolution | null>([
      ['gunn1972', null],
      ['moore1996', res(`${ROOT}/references/moore1996.pdf`)]
    ])
    expect(citekeyForPdfPath(map, `${ROOT}/references/moore1996.pdf`)).toMatchObject({
      citekey: 'moore1996'
    })
  })

  it('does not confuse a conventional name with a different file of the same name', () => {
    // A stale entry pointing elsewhere must not claim this path just because
    // the basename happens to match its key.
    const map = new Map([['gunn1972', res(`${ROOT}/references/old/gunn1972.pdf`)]])
    expect(citekeyForPdfPath(map, `${ROOT}/somewhere/gunn1972.pdf`)).toEqual({ kind: 'none' })
  })

  it('is none for an empty map', () => {
    expect(citekeyForPdfPath(new Map(), `${ROOT}/references/x.pdf`)).toEqual({ kind: 'none' })
  })
})

describe('describeCitekeyMatch', () => {
  it('says nothing when the match is unambiguous', () => {
    expect(describeCitekeyMatch({ kind: 'one', citekey: 'a', how: 'filename' })).toBeNull()
  })

  it('names every claimant and the way out', () => {
    const text = describeCitekeyMatch({ kind: 'ambiguous', citekeys: ['a2020a', 'a2020b'] })
    expect(text).toContain('a2020a, a2020b')
    expect(text).toContain('references/<citekey>.pdf')
  })

  it('explains a quote with no citation', () => {
    expect(describeCitekeyMatch({ kind: 'none' })).toContain('carries no citation')
  })
})
