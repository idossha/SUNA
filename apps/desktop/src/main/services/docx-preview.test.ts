import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_GEOMETRY,
  parseDocDefaults,
  parsePageGeometry,
  wrapDocxHtml
} from './docx-preview'

/** A4 with 2cm margins, in twips. */
const A4_SECTION =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708"/></w:sectPr>'

describe('parsePageGeometry', () => {
  it('reads page size and margins out of the body sectPr', () => {
    const geometry = parsePageGeometry(`<w:body><w:p/>${A4_SECTION}</w:body>`)
    expect(geometry.widthIn).toBeCloseTo(8.268, 3)
    expect(geometry.heightIn).toBeCloseTo(11.693, 3)
    expect(geometry.marginTopIn).toBeCloseTo(0.7875, 3)
    expect(geometry.marginLeftIn).toBeCloseTo(0.7875, 3)
  })

  it('takes the LAST sectPr — the body\'s, not a section-break paragraph\'s', () => {
    const letter =
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    const geometry = parsePageGeometry(`<w:body><w:p>${A4_SECTION}</w:p>${letter}</w:body>`)
    expect(geometry.widthIn).toBeCloseTo(8.5, 3)
    expect(geometry.heightIn).toBeCloseTo(11, 3)
  })

  it('falls back to Letter/1in when the document states no page setup', () => {
    expect(parsePageGeometry('<w:body><w:p/></w:body>')).toEqual(DEFAULT_PAGE_GEOMETRY)
  })

  it('ignores nonsense values rather than printing an impossible page', () => {
    const broken = '<w:sectPr><w:pgSz w:w="0" w:h="abc"/><w:pgMar w:top="-720"/></w:sectPr>'
    const geometry = parsePageGeometry(broken)
    expect(geometry.widthIn).toBe(DEFAULT_PAGE_GEOMETRY.widthIn)
    expect(geometry.heightIn).toBe(DEFAULT_PAGE_GEOMETRY.heightIn)
    expect(geometry.marginTopIn).toBe(DEFAULT_PAGE_GEOMETRY.marginTopIn)
  })
})

describe('parseDocDefaults', () => {
  it('reads the default face and half-point size', () => {
    const styles =
      '<w:styles><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:sz w:val="24"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
    expect(parseDocDefaults(styles)).toEqual({ fontFamily: 'Cambria', fontSizePt: 12 })
  })

  it('states nothing rather than guessing when the file states nothing', () => {
    expect(parseDocDefaults('<w:styles></w:styles>')).toEqual({ fontFamily: null, fontSizePt: null })
  })

  it('does not read a size out of a named style outside docDefaults', () => {
    const styles =
      '<w:styles><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault></w:docDefaults>' +
      '<w:style w:styleId="Heading1"><w:rPr><w:sz w:val="48"/></w:rPr></w:style></w:styles>'
    expect(parseDocDefaults(styles).fontSizePt).toBeNull()
  })
})

describe('wrapDocxHtml', () => {
  it('lays the body out at the page\'s text width and stated face', () => {
    const html = wrapDocxHtml(
      '<p>Hello</p>',
      { ...DEFAULT_PAGE_GEOMETRY },
      { fontFamily: 'Cambria', fontSizePt: 12 }
    )
    // 8.5in page - 1in margins on both sides.
    expect(html).toContain('width: 6.5in')
    expect(html).toContain("'Cambria'")
    expect(html).toContain('font-size: 12pt')
    expect(html).toContain('<p>Hello</p>')
  })

  it('falls back to a serif stack when the file names no face', () => {
    const html = wrapDocxHtml('<p/>', DEFAULT_PAGE_GEOMETRY, { fontFamily: null, fontSizePt: null })
    expect(html).toContain("'Times New Roman', Times, serif")
    expect(html).toContain('font-size: 11pt')
  })
})
