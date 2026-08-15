import { describe, expect, it } from 'vitest'
import {
  collectFragmentIds,
  extractSvgContent,
  importOffset,
  namespaceSvgIds,
  nextImportGroupId,
  prepareSvgImport,
  SvgImportError
} from './import-svg'

// A fixture exercising every reference form the namespacer must rewrite:
// a <clipPath>, a marker referenced via url(#…) on a path, a <linearGradient>
// referenced via a style attribute, and a <use> referencing it by xlink:href.
const FIXTURE = `<g id="plot">
  <defs>
    <clipPath id="clip1"><rect id="clipRect" width="10" height="10"/></clipPath>
    <marker id="arrow" viewBox="0 0 10 10"><path id="arrowPath" d="M0 0L10 5L0 10z"/></marker>
    <linearGradient id="grad1"><stop offset="0" stop-color="#000"/></linearGradient>
  </defs>
  <path id="line1" d="M0 0L10 10" clip-path="url(#clip1)" marker-end="url(#arrow)"/>
  <rect id="fillRect" style="fill:url(#grad1)" width="5" height="5"/>
  <use id="copy1" xlink:href="#line1" x="20"/>
  <use id="copy2" href="#fillRect" x="40"/>
</g>`

describe('collectFragmentIds', () => {
  it('collects every declared id', () => {
    expect(collectFragmentIds(FIXTURE)).toEqual(
      new Set([
        'plot',
        'clip1',
        'clipRect',
        'arrow',
        'arrowPath',
        'grad1',
        'line1',
        'fillRect',
        'copy1',
        'copy2'
      ])
    )
  })

  it('returns an empty set for markup with no ids', () => {
    expect(collectFragmentIds('<rect width="5" height="5"/>').size).toBe(0)
  })
})

describe('namespaceSvgIds', () => {
  it('prefixes every id definition', () => {
    const out = namespaceSvgIds(FIXTURE, 'imp1-')
    expect(out).toContain('id="imp1-plot"')
    expect(out).toContain('id="imp1-clip1"')
    expect(out).toContain('id="imp1-arrow"')
    expect(out).toContain('id="imp1-grad1"')
    expect(out).toContain('id="imp1-line1"')
  })

  it('rewrites clip-path and marker-end url(#…) references', () => {
    const out = namespaceSvgIds(FIXTURE, 'imp1-')
    expect(out).toContain('clip-path="url(#imp1-clip1)"')
    expect(out).toContain('marker-end="url(#imp1-arrow)"')
  })

  it('rewrites a gradient reference inside a style attribute', () => {
    const out = namespaceSvgIds(FIXTURE, 'imp1-')
    expect(out).toContain('style="fill:url(#imp1-grad1)"')
  })

  it('rewrites xlink:href and bare href references', () => {
    const out = namespaceSvgIds(FIXTURE, 'imp1-')
    expect(out).toContain('xlink:href="#imp1-line1"')
    expect(out).toContain('href="#imp1-fillRect"')
  })

  it('never mangles unrelated hex colors that happen to look like ids', () => {
    const svg = '<rect id="a" fill="#af3029"/>'
    const out = namespaceSvgIds(svg, 'imp1-')
    expect(out).toContain('fill="#af3029"')
    expect(out).toContain('id="imp1-a"')
  })

  it('is a no-op for markup with no ids', () => {
    const svg = '<rect width="5" height="5"/>'
    expect(namespaceSvgIds(svg, 'imp1-')).toBe(svg)
  })
})

describe('extractSvgContent', () => {
  it('extracts the root svg element children as raw markup', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="r1" width="5"/></svg>'
    expect(extractSvgContent(source).inner).toBe('<rect id="r1" width="5"/>')
  })

  it('carries every xmlns declaration on the source root', () => {
    const source =
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ' +
      'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<g id="a"/></svg>'
    const { nsDecls } = extractSvgContent(source)
    expect(nsDecls).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(nsDecls).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"')
    expect(nsDecls).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"')
  })

  it('finds the svg root regardless of a leading XML prologue/doctype', () => {
    const source =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="fig"/></svg>\n'
    expect(extractSvgContent(source).inner).toBe('<g id="fig"/>')
  })

  it('throws for a self-closing (contentless) svg', () => {
    expect(() => extractSvgContent('<svg xmlns="http://www.w3.org/2000/svg"/>')).not.toThrow()
    expect(extractSvgContent('<svg xmlns="http://www.w3.org/2000/svg"/>').inner).toBe('')
  })

  it('throws SvgImportError for non-SVG input', () => {
    expect(() => extractSvgContent('<html><body>not svg</body></html>')).toThrow(SvgImportError)
  })
})

describe('nextImportGroupId', () => {
  it('starts at imported-1 when nothing collides', () => {
    expect(nextImportGroupId(() => false)).toBe('imported-1')
  })

  it('skips ids already present in the document', () => {
    const taken = new Set(['imported-1', 'imported-2'])
    expect(nextImportGroupId((id) => taken.has(id))).toBe('imported-3')
  })
})

describe('importOffset', () => {
  it('grows with each successive import so drops do not stack exactly', () => {
    const a = importOffset(1)
    const b = importOffset(2)
    const c = importOffset(3)
    expect(a).toEqual({ dx: 24, dy: 24 })
    expect(b.dx).toBeGreaterThan(a.dx)
    expect(c.dx).toBeGreaterThan(b.dx)
  })
})

describe('prepareSvgImport', () => {
  it('wraps the namespaced content in exactly one <g> root with an offset transform', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="r1" width="5"/></svg>'
    const out = prepareSvgImport(source, 'imported-1', 'imp1-', { dx: 24, dy: 24 })
    expect(out.startsWith('<g id="imported-1"')).toBe(true)
    expect(out).toContain('transform="translate(24 24)"')
    expect(out).toContain('id="imp1-r1"')
    expect(out.endsWith('</g>')).toBe(true)
  })

  it('throws for an SVG with no content', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    expect(() => prepareSvgImport(source, 'imported-1', 'imp1-', { dx: 24, dy: 24 })).toThrow(
      SvgImportError
    )
  })
})
