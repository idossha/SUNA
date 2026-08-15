import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FigureDocumentSchema } from '@suna/core'
import {
  blankArtboardHeightMm,
  blankFigureSvg,
  createFigure,
  slugifyFigureName,
  uniqueFigureSlug
} from './figure-create'
import { allowRoot } from './roots'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-figcreate-'))
  allowRoot(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('slugifyFigureName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyFigureName('Velocity Map')).toBe('velocity-map')
  })

  it('strips diacritics (keeping the base letter) and punctuation', () => {
    expect(slugifyFigureName('Spectrum — Å scale!')).toBe('spectrum-a-scale')
  })

  it('collapses repeated separators and trims leading/trailing hyphens', () => {
    expect(slugifyFigureName('  --Foo   Bar--  ')).toBe('foo-bar')
  })

  it('never returns empty for a name with no letters/digits', () => {
    expect(slugifyFigureName('★★★')).toBe('figure')
  })
})

describe('uniqueFigureSlug', () => {
  it('returns the base slug when free', () => {
    expect(uniqueFigureSlug('spectrum', new Set())).toBe('spectrum')
  })

  it('appends -2, -3, … until a free slug is found', () => {
    const taken = new Set(['spectrum', 'spectrum-2', 'spectrum-3'])
    expect(uniqueFigureSlug('spectrum', taken)).toBe('spectrum-4')
  })
})

describe('blankArtboardHeightMm', () => {
  it('is width * 0.618', () => {
    expect(blankArtboardHeightMm(180)).toBeCloseTo(111.24, 6)
  })
})

describe('blankFigureSvg', () => {
  it('declares xmlns and a viewBox whose width/height match the pt-converted mm size', () => {
    const svg = blankFigureSvg(180, 111.24)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    const widthMatch = /width="([\d.]+)pt"/.exec(svg)
    const viewBoxMatch = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
    expect(widthMatch).not.toBeNull()
    expect(viewBoxMatch).not.toBeNull()
    const widthPt = Number(widthMatch?.[1])
    const [vbWidth, vbHeight] = [Number(viewBoxMatch?.[1]), Number(viewBoxMatch?.[2])]
    expect(vbWidth).toBeCloseTo(widthPt, 6)
    // pt -> mm at 0.3528 mm/pt round-trips to the requested width within 1mm
    // (the same tolerance the compliance checker uses for width presets).
    expect(Math.abs(widthPt * 0.3528 - 180)).toBeLessThan(1)
    expect(Math.abs(vbHeight * 0.3528 - 111.24)).toBeLessThan(1)
  })

  it('has no content — the blank-canvas hint has something to detect', () => {
    const svg = blankFigureSvg(180, 111.24)
    expect(/<svg[^>]*>\s*<\/svg>/.test(svg)).toBe(true)
  })
})

describe('createFigure', () => {
  it('creates figures/<slug>/{figure.svg,figure.json} at the requested width', async () => {
    const result = await createFigure(dir, 'New Spectrum', 180)
    expect(result.figureId).toBe('new-spectrum')
    expect(result.canvasRef).toBe('figures/new-spectrum/figure.svg')
    expect(result.widthMm).toBe(180)
    expect(result.heightMm).toBeCloseTo(111.24, 6)

    const svg = await readFile(result.svgPath, 'utf8')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')

    const json = JSON.parse(await readFile(result.jsonPath, 'utf8'))
    const doc = FigureDocumentSchema.parse(json)
    expect(doc.id).toBe('new-spectrum')
    expect(doc.caption.title).toBe('New Spectrum')
    expect(doc.widthPreset).toBe('double')
    expect(doc.panels).toEqual([])
    expect(doc.provenance).toBeNull()
  })

  it('de-duplicates the slug against existing figure directories', async () => {
    await mkdir(join(dir, 'figures', 'spectrum'), { recursive: true })
    await writeFile(join(dir, 'figures', 'spectrum', 'figure.svg'), '<svg></svg>', 'utf8')

    const result = await createFigure(dir, 'Spectrum', 180)
    expect(result.figureId).toBe('spectrum-2')
  })

  it('never writes manuscript.json — the renderer registers the new figure', async () => {
    await mkdir(join(dir, 'manuscript'), { recursive: true })
    await writeFile(join(dir, 'manuscript', 'manuscript.json'), '{"untouched":true}', 'utf8')
    await createFigure(dir, 'Spectrum', 180)
    expect(await readFile(join(dir, 'manuscript', 'manuscript.json'), 'utf8')).toBe(
      '{"untouched":true}'
    )
  })

  it('rejects a non-positive width', async () => {
    await expect(createFigure(dir, 'Spectrum', 0)).rejects.toThrow(/invalid figure width/)
    await expect(createFigure(dir, 'Spectrum', -10)).rejects.toThrow(/invalid figure width/)
  })
})
