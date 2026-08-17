import { describe, expect, it } from 'vitest'
import { getBundledProfile } from '@suna/formatter'
import type { PublisherProfile } from '@suna/core'
import {
  halfPoints,
  lineSpacingTwips,
  mmToTwips,
  ptToTwips,
  resolveDocumentStyle,
  SUNA_DEFAULT_STYLE
} from './export-style'

/**
 * resolveDocumentStyle is the always-on-house-style mechanism: every profile
 * resolves to the FULL SUNA default with only its stated partial delta laid
 * over it. These tests pin the merge semantics — a delta field wins, every
 * unstated field (top-level and nested) inherits — because the DOCX, HTML and
 * PDF writers all consume the result and must agree.
 */

function profileFor(id: string): PublisherProfile {
  const profile = getBundledProfile(id)
  if (profile === null) throw new Error(`no bundled profile "${id}"`)
  return profile
}

describe('resolveDocumentStyle', () => {
  it('resolves a profile with no documentStyle to exactly the SUNA default', () => {
    const resolved = resolveDocumentStyle(profileFor('nature'))
    expect(resolved).toEqual(SUNA_DEFAULT_STYLE)
  })

  it('the SUNA default carries the ground-truth docx-tools values', () => {
    expect(SUNA_DEFAULT_STYLE.page).toEqual({ widthMm: 215.9, heightMm: 279.4, marginMm: 12.7 })
    expect(SUNA_DEFAULT_STYLE.fonts.body).toBe('Times New Roman')
    expect(SUNA_DEFAULT_STYLE.sizesPt).toEqual({
      body: 11,
      title: 14,
      author: 8,
      affiliation: 9,
      heading1: 13,
      heading2: 11,
      caption: 10,
      reference: 10,
      tableCell: 10,
      footer: 9
    })
    expect(SUNA_DEFAULT_STYLE.lineSpacing).toBeCloseTo(1.15, 2)
    expect(SUNA_DEFAULT_STYLE.figureCaptionPosition).toBe('below')
    expect(SUNA_DEFAULT_STYLE.tableCaptionPosition).toBe('above')
    expect(SUNA_DEFAULT_STYLE.pageBreakAfterFrontMatter).toBe(true)
    expect(SUNA_DEFAULT_STYLE.figureLabel).toBe('Figure')
    expect(SUNA_DEFAULT_STYLE.figurePlacement).toBe('inline')
    expect(SUNA_DEFAULT_STYLE.tablePlacement).toBe('inline')
    expect(SUNA_DEFAULT_STYLE.referencesStartNewPage).toBe(true)
  })

  it('suna.json itself resolves to the same values it states', () => {
    const resolved = resolveDocumentStyle(profileFor('suna'))
    expect(resolved).toEqual(SUNA_DEFAULT_STYLE)
  })

  it('a convention delta wins while every typography field inherits', () => {
    const resolved = resolveDocumentStyle(profileFor('sleep'))
    // SLEEP's stated conventions...
    expect(resolved.figureLabel).toBe('Figure')
    expect(resolved.figurePlacement).toBe('captions-list')
    expect(resolved.tablePlacement).toBe('end')
    expect(resolved.referencesStartNewPage).toBe(true)
    // ...on top of untouched SUNA typography.
    expect(resolved.page).toEqual(SUNA_DEFAULT_STYLE.page)
    expect(resolved.fonts).toEqual(SUNA_DEFAULT_STYLE.fonts)
    expect(resolved.sizesPt).toEqual(SUNA_DEFAULT_STYLE.sizesPt)
    expect(resolved.lineSpacing).toBe(SUNA_DEFAULT_STYLE.lineSpacing)
  })

  it('nature-astronomy shifts only the figure label', () => {
    const resolved = resolveDocumentStyle(profileFor('nature-astronomy'))
    expect(resolved.figureLabel).toBe('Fig.')
    expect({ ...resolved, figureLabel: 'Figure' }).toEqual(SUNA_DEFAULT_STYLE)
  })

  it('deep-merges nested partials: one stated size leaves its nine siblings intact', () => {
    const base = profileFor('nature')
    const patched: PublisherProfile = {
      ...base,
      documentStyle: {
        sizesPt: { body: 12 },
        page: { marginMm: 25.4 },
        figureLabel: 'Fig.'
      }
    }
    const resolved = resolveDocumentStyle(patched)
    expect(resolved.sizesPt.body).toBe(12)
    expect(resolved.sizesPt.title).toBe(14)
    expect(resolved.sizesPt.footer).toBe(9)
    expect(resolved.page.marginMm).toBeCloseTo(25.4, 1)
    expect(resolved.page.widthMm).toBeCloseTo(215.9, 1)
    expect(resolved.fonts).toEqual(SUNA_DEFAULT_STYLE.fonts)
    expect(resolved.figureLabel).toBe('Fig.')
    expect(resolved.figurePlacement).toBe('inline')
  })

  it('ignores explicitly-undefined delta fields rather than clobbering the default', () => {
    const base = profileFor('nature')
    const patched: PublisherProfile = {
      ...base,
      documentStyle: { lineSpacing: undefined, figureLabel: undefined }
    }
    const resolved = resolveDocumentStyle(patched)
    expect(resolved.lineSpacing).toBeCloseTo(1.15, 2)
    expect(resolved.figureLabel).toBe('Figure')
  })
})

describe('unit conversions', () => {
  it('converts points, millimetres and line-spacing multiples the way OOXML expects', () => {
    expect(halfPoints(11)).toBe(22)
    expect(ptToTwips(6)).toBe(120)
    expect(mmToTwips(12.7)).toBe(720)
    expect(lineSpacingTwips(1.15)).toBe(276)
    expect(lineSpacingTwips(2)).toBe(480)
  })
})
