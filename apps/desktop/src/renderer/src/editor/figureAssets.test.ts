import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cachedAsset,
  figureSvgPath,
  loadAsset,
  rasterMimeFor,
  resetFigureAssetCache,
  resolveImageUrl,
  stripXmlProlog
} from './figureAssets'

const invoke = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: { suna: { invoke } },
  writable: true,
  configurable: true
})

beforeEach(() => {
  resetFigureAssetCache()
  invoke.mockReset()
})

afterEach(() => {
  resetFigureAssetCache()
})

describe('figureSvgPath', () => {
  it('points at figures/<id>/figure.svg under the project root', () => {
    expect(figureSvgPath('/work/paper', 'fig-spectrum')).toBe(
      '/work/paper/figures/fig-spectrum/figure.svg'
    )
  })
})

describe('rasterMimeFor', () => {
  it('maps the raster formats we can inline, case-insensitively', () => {
    expect(rasterMimeFor('a/b.png')).toBe('image/png')
    expect(rasterMimeFor('a/b.JPG')).toBe('image/jpeg')
    expect(rasterMimeFor('a/b.jpeg')).toBe('image/jpeg')
    expect(rasterMimeFor('a/b.webp')).toBe('image/webp')
  })

  it('refuses what it cannot inline', () => {
    expect(rasterMimeFor('a/b.pdf')).toBeNull()
    expect(rasterMimeFor('a/b')).toBeNull()
    // .svg is handled as text, not as a raster data URI
    expect(rasterMimeFor('a/b.svg')).toBeNull()
  })
})

describe('resolveImageUrl', () => {
  const file = '/work/paper/manuscript/manuscript.md'

  it('resolves a relative path against the file that contains it', () => {
    expect(resolveImageUrl('images/plot.png', file)).toBe(
      '/work/paper/manuscript/images/plot.png'
    )
  })

  it('walks up out of the containing directory', () => {
    expect(resolveImageUrl('../figures/fig-1/figure.svg', file)).toBe(
      '/work/paper/figures/fig-1/figure.svg'
    )
  })

  it('collapses "./" segments', () => {
    expect(resolveImageUrl('./a/./b.png', file)).toBe('/work/paper/manuscript/a/b.png')
  })

  it('passes an absolute path through', () => {
    expect(resolveImageUrl('/elsewhere/x.png', file)).toBe('/elsewhere/x.png')
  })

  it('strips a query or fragment', () => {
    expect(resolveImageUrl('plot.png?v=2', file)).toBe('/work/paper/manuscript/plot.png')
    expect(resolveImageUrl('plot.png#top', file)).toBe('/work/paper/manuscript/plot.png')
  })

  it('refuses remote urls rather than fetching them', () => {
    // the renderer's CSP blocks external hosts; a silent broken image would
    // be the alternative to saying so
    expect(resolveImageUrl('https://example.com/x.png', file)).toBeNull()
    expect(resolveImageUrl('data:image/png;base64,AAAA', file)).toBeNull()
  })

  it('accepts a file:// url by stripping the scheme', () => {
    expect(resolveImageUrl('file:///work/paper/x.png', file)).toBe('/work/paper/x.png')
  })

  it('returns null for an empty url', () => {
    expect(resolveImageUrl('', file)).toBeNull()
  })
})

describe('loadAsset', () => {
  it('reads an SVG as text and inlines it', async () => {
    invoke.mockResolvedValue({
      content: '<?xml version="1.0"?>\n<svg viewBox="0 0 10 10"></svg>'
    })
    const asset = await loadAsset('/p/figures/f/figure.svg')
    // the XML prolog is stripped on the way in, so the widget can innerHTML it
    expect(asset).toEqual({ kind: 'svg', svg: '<svg viewBox="0 0 10 10"></svg>' })
    expect(invoke).toHaveBeenCalledWith('fs:read-text', { path: '/p/figures/f/figure.svg' })
  })

  it('reads a raster as base64 and builds a data URI with the right mime', async () => {
    invoke.mockResolvedValue({ base64: 'QUJD', bytes: 3 })
    const asset = await loadAsset('/p/img/plot.png')
    expect(asset).toEqual({ kind: 'raster', dataUri: 'data:image/png;base64,QUJD' })
    expect(invoke).toHaveBeenCalledWith('fs:read-binary', { path: '/p/img/plot.png' })
  })

  it('reports a missing file instead of throwing, so the widget can say so', async () => {
    invoke.mockRejectedValue(new Error('ENOENT: no such file'))
    const asset = await loadAsset('/p/figures/gone/figure.svg')
    expect(asset.kind).toBe('missing')
    expect(asset.kind === 'missing' && asset.reason).toContain('ENOENT')
  })

  it('reports an unsupported type without touching the disk', async () => {
    const asset = await loadAsset('/p/notes.txt')
    expect(asset.kind).toBe('missing')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reads each path once and serves the rest from cache', async () => {
    invoke.mockResolvedValue({ content: '<svg/>' })
    await loadAsset('/p/figures/f/figure.svg')
    await loadAsset('/p/figures/f/figure.svg')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(cachedAsset('/p/figures/f/figure.svg')).toEqual({ kind: 'svg', svg: '<svg/>' })
  })

  it('coalesces concurrent loads of the same path into one read', async () => {
    invoke.mockResolvedValue({ content: '<svg/>' })
    const [a, b] = await Promise.all([
      loadAsset('/p/figures/f/figure.svg'),
      loadAsset('/p/figures/f/figure.svg')
    ])
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('has nothing cached before the first load', () => {
    expect(cachedAsset('/p/figures/f/figure.svg')).toBeUndefined()
  })
})

describe('stripXmlProlog', () => {
  it('drops the XML declaration and DOCTYPE a matplotlib figure starts with', () => {
    const real =
      '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"\n  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      '<svg width="510pt" viewBox="0 0 510 164"><g/></svg>'
    expect(stripXmlProlog(real)).toBe('<svg width="510pt" viewBox="0 0 510 164"><g/></svg>')
  })

  it('leaves an already-clean document alone', () => {
    const clean = '<svg viewBox="0 0 1 1"></svg>'
    expect(stripXmlProlog(clean)).toBe(clean)
  })

  it('returns input unchanged when there is no svg root, so it fails visibly', () => {
    expect(stripXmlProlog('not markup at all')).toBe('not markup at all')
  })
})
