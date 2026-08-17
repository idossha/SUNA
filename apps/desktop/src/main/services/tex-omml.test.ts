import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { Document, Math as DocxMath, Packer, Paragraph, type MathComponent } from 'docx'
import { texToMath } from './tex-omml'

/**
 * Structure tests run against the REAL OOXML: the converted components are
 * packed into a minimal document and asserted on `word/document.xml`, the
 * same way export-docx.test.ts pins every other writer behavior — an object
 * graph the Packer would refuse or serialize differently proves nothing.
 */
async function xmlOf(components: MathComponent[]): Promise<string> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new DocxMath({ children: components })] })] }]
  })
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc))
  return (await zip.file('word/document.xml')?.async('string')) ?? ''
}

async function convert(tex: string): Promise<string> {
  const components = texToMath(tex)
  expect(components, `"${tex}" should convert`).not.toBeNull()
  return xmlOf(components as MathComponent[])
}

/** The concatenated <m:t> payloads, in order. */
function mathText(xml: string): string {
  return [...xml.matchAll(/<m:t(?: [^>]*)?>([^<]*)<\/m:t>/g)].map((m) => m[1]).join('')
}

describe('texToMath — accepted constructs', () => {
  it('renders letters, digits and operators as one m:oMath of merged runs', async () => {
    const xml = await convert('E = mc^2')
    expect(xml).toContain('<m:oMath>')
    expect(mathText(xml)).toBe('E=mc2')
    // ^2 became a real superscript object, not a literal caret.
    expect(xml).toContain('<m:sSup>')
    expect(xml).not.toContain('^')
  })

  it('merges adjacent plain characters into a single run', async () => {
    const xml = await convert('2ax+1')
    expect((xml.match(/<m:r>/g) ?? []).length).toBe(1)
    expect(mathText(xml)).toBe('2ax+1')
  })

  it('renders \\frac as m:f with numerator and denominator', async () => {
    const xml = await convert('\\frac{a}{b}')
    expect(xml).toContain('<m:f>')
    expect(xml).toContain('<m:num>')
    expect(xml).toContain('<m:den>')
    expect(mathText(xml)).toBe('ab')
  })

  it('nests fractions', async () => {
    const xml = await convert('\\frac{1}{\\frac{x}{y}}')
    expect((xml.match(/<m:f>/g) ?? []).length).toBe(2)
  })

  it('renders subscript, superscript and the combined form', async () => {
    expect(await convert('x_i')).toContain('<m:sSub>')
    expect(await convert('x^{2}')).toContain('<m:sSup>')
    const both = await convert('x_i^2')
    expect(both).toContain('<m:sSubSup>')
    const reversed = await convert('x^2_i')
    expect(reversed).toContain('<m:sSubSup>')
  })

  it('scripts a braced group as a whole', async () => {
    const xml = await convert('{ab}^2')
    const sup = /<m:sSup>([\s\S]*?)<\/m:sSup>/.exec(xml)?.[1] ?? ''
    expect(mathText(`<m:oMath>${sup}</m:oMath>`)).toContain('ab')
  })

  it('renders \\sqrt as m:rad', async () => {
    const xml = await convert('\\sqrt{x+1}')
    expect(xml).toContain('<m:rad>')
    expect(mathText(xml)).toBe('x+1')
  })

  it('maps greek macros to Unicode', async () => {
    const xml = await convert('\\alpha + \\Omega \\pi')
    expect(mathText(xml)).toBe('α+Ωπ')
  })

  it('maps symbol macros to Unicode', async () => {
    const xml = await convert('a \\times b \\leq c \\neq \\infty')
    expect(mathText(xml)).toBe('a×b≤c≠∞')
  })

  it('renders \\sum with limits as an n-ary with m:sub/m:sup', async () => {
    const xml = await convert('\\sum_{i=1}^{n} x_i')
    expect(xml).toContain('<m:nary>')
    expect(xml).toContain('<m:sub>')
    expect(xml).toContain('<m:sup>')
    expect(mathText(xml)).toContain('i=1')
    expect(mathText(xml)).toContain('n')
  })

  it('renders \\int with limits, in either script order', async () => {
    expect(await convert('\\int_0^1 f(x) dx')).toContain('<m:nary>')
    expect(await convert('\\int^1_0 f(x) dx')).toContain('<m:nary>')
  })

  it('renders \\sum without limits and hides the empty limit slots', async () => {
    const xml = await convert('\\sum x')
    expect(xml).toContain('<m:nary>')
    expect(xml).toContain('subHide')
    expect(xml).toContain('supHide')
  })

  it('renders \\text and \\mathrm as upright m:nor runs, preserving inner spaces', async () => {
    const xml = await convert('\\text{if } x')
    expect(xml).toContain('<m:nor/>')
    expect(mathText(xml)).toBe('if x')
    const rm = await convert('P_\\mathrm{ram}')
    expect(rm).toContain('<m:nor/>')
    expect(rm).toContain('<m:sSub>')
  })

  it('converts spacing macros into non-trimmable Unicode spaces', async () => {
    const xml = await convert('a\\,b\\;c\\quad d')
    expect(mathText(xml)).toBe('a\u2009b\u2005c\u2003d')
  })

  it('renders the delimiter itself for \\left/\\right, dropping the invisible "."', async () => {
    expect(mathText(await convert('\\left( x \\right)'))).toBe('(x)')
    expect(mathText(await convert('\\left. x \\right|'))).toBe('x|')
  })

  it('converts the demo paper display equation end to end', async () => {
    const xml = await convert(
      'P_\\mathrm{ram} = \\rho_\\mathrm{ICM} v^2 > 2\\pi G \\Sigma_\\ast \\Sigma_\\mathrm{gas}'
    )
    expect(xml).toContain('<m:oMath>')
    expect(xml).toContain('<m:nor/>')
    expect(mathText(xml)).toContain('ram')
    expect(mathText(xml)).toContain('ICM')
    expect(mathText(xml)).toContain('∗')
    expect(mathText(xml)).toContain('π')
  })
})

describe('texToMath — the all-or-nothing null cases', () => {
  const rejected: [string, string][] = [
    ['unknown macro', '\\foo{x}'],
    ['\\begin environment', '\\begin{align} x \\end{align}'],
    ['alignment &', 'a & b'],
    ['line break \\\\', 'a \\\\ b'],
    ['unmatched open brace', '\\frac{a}{b'],
    ['unmatched close brace', 'a } b'],
    ['\\prod (no docx n-ary object for it)', '\\prod_{i} x_i'],
    ['script with no base', '^{-1}'],
    ['double superscript', 'x^2^3'],
    ['\\sqrt with a degree', '\\sqrt[3]{x}'],
    ['\\sum with no operand', '\\sum_{i=1}^{n}'],
    ['unsupported character', 'a ~ b'],
    ['* outside the subset', 'a * b'],
    ['nested group in \\text', '\\text{a{b}}'],
    ['unknown macro inside \\text', '\\text{\\foo}'],
    ['dangling backslash', 'x \\'],
    ['empty input', '   ']
  ]

  it.each(rejected)('rejects %s', (_label, tex) => {
    expect(texToMath(tex)).toBeNull()
  })

  it('never throws, whatever the input', () => {
    for (const tex of ['{{{', '}}}', '\\', '^', '_', '\\frac', '\\frac{', '\\text{', '\\left', '\\sum_']) {
      expect(() => texToMath(tex)).not.toThrow()
      expect(texToMath(tex)).toBeNull()
    }
  })
})
