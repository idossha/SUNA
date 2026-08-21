import { describe, expect, it } from 'vitest'
import { DOCX_STYLE_MAP, countOmmlEquations } from './docx-parts'

describe('countOmmlEquations', () => {
  it('counts <m:oMath> elements in raw document.xml text', () => {
    const xml =
      '<w:document><w:body><w:p><m:oMath><m:r>x</m:r></m:oMath></w:p>' +
      '<w:p><m:oMathPara><m:oMath><m:r>y</m:r></m:oMath></m:oMathPara></w:p></w:body></w:document>'
    expect(countOmmlEquations(xml)).toBe(2)
  })

  it('is zero for a document with no equations', () => {
    expect(countOmmlEquations('<w:document><w:body><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:body></w:document>')).toBe(0)
  })
})

describe('DOCX_STYLE_MAP', () => {
  it('is the ONE style map both docx routes convert with', () => {
    // Import and the viewer must agree about what a heading is: the same
    // file read two ways cannot have two different section structures.
    expect(DOCX_STYLE_MAP).toContain("p[style-name='Heading 1'] => h1:fresh")
    expect(DOCX_STYLE_MAP).toContain("p[style-name='Quote'] => blockquote:fresh")
  })
})
