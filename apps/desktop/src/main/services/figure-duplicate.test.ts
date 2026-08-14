import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FigureDocumentSchema } from '@suna/core'
import { duplicateFigure } from './figure-duplicate'
import { allowRoot } from './roots'

const SVG = '<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"></svg>\n'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-figdup-'))
  allowRoot(dir)
  const figure = join(dir, 'figures', 'fig-spectrum')
  await mkdir(join(figure, 'source'), { recursive: true })
  await writeFile(join(figure, 'figure.svg'), SVG, 'utf8')
  await writeFile(join(figure, 'source', 'plot.py'), 'print("hi")\n', 'utf8')
  await writeFile(
    join(figure, 'figure.json'),
    JSON.stringify(
      {
        id: 'fig-spectrum',
        caption: { title: 'Spectrum', body: 'The observed spectrum.' },
        namespace: 'main',
        widthPreset: 'double',
        panels: [{ letter: 'a' }],
        provenance: null
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('duplicateFigure', () => {
  it('copies the figure directory and returns the new id', async () => {
    expect(await duplicateFigure(dir, 'fig-spectrum', 'fig-spectrum-2')).toEqual({
      figureId: 'fig-spectrum-2'
    })
    const copy = join(dir, 'figures', 'fig-spectrum-2')
    expect(await readFile(join(copy, 'figure.svg'), 'utf8')).toBe(SVG)
    expect(await readFile(join(copy, 'source', 'plot.py'), 'utf8')).toBe('print("hi")\n')
  })

  it('rewrites the copy figure.json id and keeps it schema-valid', async () => {
    await duplicateFigure(dir, 'fig-spectrum', 'fig-spectrum-2')
    const raw = await readFile(join(dir, 'figures', 'fig-spectrum-2', 'figure.json'), 'utf8')
    const document = FigureDocumentSchema.parse(JSON.parse(raw))
    expect(document.id).toBe('fig-spectrum-2')
    expect(document.caption.title).toBe('Spectrum')
  })

  it('leaves the original untouched', async () => {
    await duplicateFigure(dir, 'fig-spectrum', 'fig-spectrum-2')
    const raw = await readFile(join(dir, 'figures', 'fig-spectrum', 'figure.json'), 'utf8')
    expect(FigureDocumentSchema.parse(JSON.parse(raw)).id).toBe('fig-spectrum')
  })

  it('never writes manuscript.json — the renderer registers the new figure', async () => {
    await mkdir(join(dir, 'manuscript'), { recursive: true })
    await writeFile(join(dir, 'manuscript', 'manuscript.json'), '{"untouched":true}', 'utf8')
    await duplicateFigure(dir, 'fig-spectrum', 'fig-spectrum-2')
    expect(await readFile(join(dir, 'manuscript', 'manuscript.json'), 'utf8')).toBe(
      '{"untouched":true}'
    )
  })

  it('refuses to overwrite an existing figure', async () => {
    await duplicateFigure(dir, 'fig-spectrum', 'fig-spectrum-2')
    await expect(duplicateFigure(dir, 'fig-spectrum', 'fig-spectrum-2')).rejects.toThrow(
      /already exists/
    )
  })

  it('rejects an id that could escape the figures directory', async () => {
    await expect(duplicateFigure(dir, 'fig-spectrum', '../escape')).rejects.toThrow(
      /invalid new figure id/
    )
    await expect(duplicateFigure(dir, 'fig-spectrum', 'fig-spectrum')).rejects.toThrow(
      /invalid new figure id/
    )
  })

  it('rejects a source that is not a figure', async () => {
    await expect(duplicateFigure(dir, 'fig-missing', 'fig-copy')).rejects.toThrow(
      /no figure to duplicate/
    )
  })
})
