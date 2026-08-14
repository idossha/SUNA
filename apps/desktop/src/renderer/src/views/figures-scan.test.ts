import { describe, expect, it } from 'vitest'
import type { FsNode } from '@suna/core'
import { parseFigureMeta, scanFigures, svgDataUrl } from './figures-scan'

function file(name: string, dir: string): FsNode {
  return { kind: 'file', name, path: `${dir}/${name}` }
}

const root: FsNode = {
  kind: 'dir',
  name: 'demo',
  path: '/p',
  children: [
    file('README.md', '/p'),
    {
      kind: 'dir',
      name: 'figures',
      path: '/p/figures',
      children: [
        {
          kind: 'dir',
          name: 'fig-spectrum',
          path: '/p/figures/fig-spectrum',
          children: [file('figure.svg', '/p/figures/fig-spectrum'), file('figure.json', '/p/figures/fig-spectrum')]
        },
        {
          kind: 'dir',
          name: 'drafts',
          path: '/p/figures/drafts',
          children: [file('notes.md', '/p/figures/drafts')]
        },
        file('stray.svg', '/p/figures')
      ]
    }
  ]
}

describe('scanFigures', () => {
  it('finds only figure dirs containing figure.svg', () => {
    const hits = scanFigures(root)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toEqual({
      id: 'fig-spectrum',
      dirPath: '/p/figures/fig-spectrum',
      svgPath: '/p/figures/fig-spectrum/figure.svg',
      jsonPath: '/p/figures/fig-spectrum/figure.json'
    })
  })

  it('returns empty for null or figure-less trees', () => {
    expect(scanFigures(null)).toEqual([])
    expect(scanFigures({ kind: 'dir', name: 'x', path: '/x', children: [] })).toEqual([])
  })
})

describe('parseFigureMeta', () => {
  it('reads caption title and width preset', () => {
    const meta = parseFigureMeta(
      JSON.stringify({ widthPreset: 'double', caption: { title: 'A title.' } })
    )
    expect(meta).toEqual({ captionTitle: 'A title.', widthPreset: 'double' })
  })

  it('tolerates garbage and missing fields', () => {
    expect(parseFigureMeta('not json')).toEqual({ captionTitle: null, widthPreset: null })
    expect(parseFigureMeta('{"widthPreset":"triple"}')).toEqual({
      captionTitle: null,
      widthPreset: null
    })
  })
})

describe('svgDataUrl', () => {
  it('produces an inline utf8 data url', () => {
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(url.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    expect(decodeURIComponent(url.split(',')[1] ?? '')).toContain('<svg')
  })
})
