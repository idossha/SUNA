import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { Document, HeadingLevel, Packer, Paragraph } from 'docx'
import { SIMPLE_DOC_COLOR, SIMPLE_DOC_FONT, escapeHtml, htmlDocument, simpleDocStyles } from './print-html'

describe('htmlDocument', () => {
  it('inlines the css and escapes the title', () => {
    const html = htmlDocument({ title: 'a < b', css: 'body{}', body: '<p>x</p>' })
    expect(html).toContain('<title>a &lt; b</title>')
    expect(html).toContain('<style>body{}</style>')
    expect(html).toContain('<p>x</p>')
  })
})

describe('escapeHtml', () => {
  it('escapes the four HTML metacharacters', () => {
    expect(escapeHtml('<a href="&">')).toBe('&lt;a href=&quot;&amp;&quot;&gt;')
  })
})

describe('simpleDocStyles', () => {
  const styles = simpleDocStyles({
    bodySizePt: 11,
    title: { sizePt: 18 },
    headings: { 1: { sizePt: 13 }, 2: { sizePt: 10, color: '6A6F76' } }
  })
  const defaults = styles.default!

  it('sets the shared serif near-black body default in half-points', () => {
    expect(defaults.document?.run).toMatchObject({
      font: SIMPLE_DOC_FONT,
      size: 22,
      color: SIMPLE_DOC_COLOR
    })
  })

  it("patches Word's built-in Title and Heading styles so the theme's blue never applies", () => {
    expect(defaults.title?.run).toMatchObject({ size: 36, color: SIMPLE_DOC_COLOR, bold: true })
    expect(defaults.heading1?.run).toMatchObject({ size: 26, color: SIMPLE_DOC_COLOR, bold: true })
    // The muted-grey point heading keeps its stated colour and pt size.
    expect(defaults.heading2?.run).toMatchObject({ size: 20, color: '6A6F76' })
    // Levels the document never emits are still patched, to a bold body-size line.
    expect(defaults.heading3?.run).toMatchObject({ size: 22, color: SIMPLE_DOC_COLOR, bold: true })
    expect(defaults.heading6?.run).toMatchObject({ size: 22, color: SIMPLE_DOC_COLOR, bold: true })
    for (const style of [defaults.title, defaults.heading1, defaults.heading2]) {
      expect(style?.basedOn).toBe('Normal')
      expect(style?.run?.font).toBe(SIMPLE_DOC_FONT)
    }
  })
})

describe('simpleDocStyles — packed', () => {
  it("lands as explicit Title/Heading overrides in styles.xml, so Word's theme never paints them", async () => {
    const doc = new Document({
      styles: simpleDocStyles({
        bodySizePt: 11,
        title: { sizePt: 18 },
        headings: { 1: { sizePt: 13 }, 2: { sizePt: 10, color: '6A6F76' } }
      }),
      sections: [
        {
          children: [
            new Paragraph({ text: 'T', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'R', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: 'P', heading: HeadingLevel.HEADING_2 })
          ]
        }
      ]
    })
    const zip = await JSZip.loadAsync(await Packer.toBuffer(doc))
    const xml = await zip.file('word/styles.xml')!.async('string')
    const styleOf = (id: string): string =>
      new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?<\\/w:style>`).exec(xml)?.[0] ?? ''
    expect(styleOf('Title')).toContain('w:val="36"')
    expect(styleOf('Title')).toContain('w:color w:val="17181A"')
    expect(styleOf('Heading1')).toContain('w:val="26"')
    expect(styleOf('Heading1')).toContain('w:color w:val="17181A"')
    expect(styleOf('Heading2')).toContain('w:val="20"')
    expect(styleOf('Heading2')).toContain('w:color w:val="6A6F76"')
    for (const id of ['Title', 'Heading1', 'Heading2']) {
      expect(styleOf(id)).toContain('w:ascii="Georgia"')
      // One definition per id: a duplicate would let Word keep the built-in.
      expect(xml.match(new RegExp(`w:styleId="${id}"`, 'g'))).toHaveLength(1)
    }
    expect(xml).not.toContain('2E74B5')
  })
})
