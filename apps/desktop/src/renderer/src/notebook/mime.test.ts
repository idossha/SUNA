import { describe, expect, it } from 'vitest'
import { dataUri, pickRepresentation } from './mime'
import { interactiveHtml } from './interactiveHtml'

describe('pickRepresentation', () => {
  // The case this exists for: matplotlib sends both, and the plot wins.
  it('prefers the figure over its repr', () => {
    expect(
      pickRepresentation({ 'image/png': 'AAAA', 'text/plain': '<Figure size 640x480>' })
    ).toEqual({ kind: 'image', mime: 'image/png', data: 'AAAA' })
  })

  it('prefers a vector figure over a raster one', () => {
    expect(pickRepresentation({ 'image/svg+xml': '<svg/>', 'image/png': 'AAAA' })).toEqual({
      kind: 'svg',
      svg: '<svg/>'
    })
  })

  it('prefers a DataFrame table over its text repr', () => {
    expect(pickRepresentation({ 'text/html': '<table></table>', 'text/plain': 'a b' })).toEqual({
      kind: 'html',
      html: '<table></table>'
    })
  })

  it('accepts a line list as readily as a string', () => {
    expect(pickRepresentation({ 'text/plain': ['one\n', 'two'] })).toEqual({
      kind: 'text',
      text: 'one\ntwo'
    })
  })

  it('keeps application/json as a value, never as text', () => {
    expect(pickRepresentation({ 'application/json': { a: 1 } })).toEqual({
      kind: 'json',
      value: { a: 1 }
    })
  })

  it('falls past a type it cannot read down to one it can', () => {
    // an image whose payload is an object, not base64
    expect(pickRepresentation({ 'image/png': { oops: true }, 'text/plain': 'x' })).toEqual({
      kind: 'text',
      text: 'x'
    })
  })

  it('reports nothing renderable rather than guessing', () => {
    expect(pickRepresentation({})).toEqual({ kind: 'none' })
    expect(pickRepresentation({ 'application/vnd.custom': 'x' })).toEqual({ kind: 'none' })
  })
})

describe('dataUri', () => {
  it('strips the line wrapping kernels put in base64', () => {
    expect(dataUri('image/png', 'AAAA\nBBBB\n')).toBe('data:image/png;base64,AAAABBBB')
  })
})

describe('interactive output', () => {
  it('prefers a live plotly figure over the static png sent beside it', () => {
    const rep = pickRepresentation({
      'application/vnd.plotly.v1+json': { data: [], layout: {} },
      'image/png': 'iVBOR',
      'text/plain': '<plotly.Figure>'
    })
    expect(rep.kind).toBe('interactive')
  })

  it('sends html that carries a script to the sandboxed frame, and plain html not', () => {
    expect(pickRepresentation({ 'text/html': '<div id="p"></div><script>go()</script>' }).kind).toBe(
      'script-html'
    )
    expect(pickRepresentation({ 'text/html': '<table><tr><td>1</td></tr></table>' }).kind).toBe(
      'html'
    )
  })

  it('builds runnable html for the libraries it knows, and nothing for the rest', () => {
    const plotly = interactiveHtml('application/vnd.plotly.v1+json', {
      data: [{ y: [1, 2] }],
      layout: { title: 'x' }
    })
    expect(plotly).toContain('Plotly.newPlot')
    expect(plotly).toContain('"y":[1,2]')
    expect(interactiveHtml('application/vnd.vegalite.v5+json', { mark: 'bar' })).toContain(
      'vegaEmbed'
    )
    expect(interactiveHtml('application/vnd.jupyter.widget-view+json', {})).toBeNull()
  })

  it('never lets a spec close the script block it sits in', () => {
    const html = interactiveHtml('application/vnd.plotly.v1+json', {
      data: [{ name: '</script><script>stolen()' }]
    }) as string
    expect(html).not.toContain('</script><script>stolen()')
  })
})
