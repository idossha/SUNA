import { describe, expect, it } from 'vitest'
import type { ManuscriptFigure } from '@suna/core'
import type { FigureHit } from '../views/figures-scan'
import { figureChoices, filterFigureChoices } from './figureChoices'

const ROOT = '/work/paper'

function figure(id: string, title = '', canvasRef = `figures/${id}/figure.svg`): ManuscriptFigure {
  return {
    id,
    namespace: 'main',
    canvasRef,
    widthPreset: 'single',
    caption: { title, body: '' },
    panels: []
  }
}

function hit(id: string): FigureHit {
  return {
    id,
    dirPath: `${ROOT}/figures/${id}`,
    svgPath: `${ROOT}/figures/${id}/figure.svg`,
    jsonPath: `${ROOT}/figures/${id}/figure.json`
  }
}

describe('figureChoices', () => {
  it('keeps manuscript order — the order figure numbering is derived from', () => {
    const choices = figureChoices(ROOT, [figure('zeta'), figure('alpha')], [hit('alpha'), hit('zeta')])
    expect(choices.map((c) => c.id)).toEqual(['zeta', 'alpha'])
    expect(choices.every((c) => c.inManuscript)).toBe(true)
  })

  it('carries the caption title, and nulls an empty one', () => {
    const choices = figureChoices(ROOT, [figure('a', 'Spectrum of the host'), figure('b', '  ')], [])
    expect(choices[0]?.title).toBe('Spectrum of the host')
    expect(choices[1]?.title).toBeNull()
  })

  it('lists figures that exist on disk but not in manuscript.json, flagged, after the rest', () => {
    const choices = figureChoices(ROOT, [figure('listed')], [hit('zzz-orphan'), hit('aaa-orphan')])
    expect(choices.map((c) => c.id)).toEqual(['listed', 'aaa-orphan', 'zzz-orphan'])
    expect(choices.map((c) => c.inManuscript)).toEqual([true, false, false])
  })

  it('resolves the SVG path from canvasRef when the tree has not been scanned', () => {
    const choices = figureChoices(ROOT, [figure('a', '', 'figures/custom/plot.svg')], [])
    expect(choices[0]?.svgPath).toBe('/work/paper/figures/custom/plot.svg')
  })

  it('prefers the scanned path when the tree knows the figure', () => {
    const choices = figureChoices(ROOT, [figure('a', '', 'figures/stale/plot.svg')], [hit('a')])
    expect(choices[0]?.svgPath).toBe('/work/paper/figures/a/figure.svg')
  })

  it('has no path to offer a thumbnail outside a project', () => {
    expect(figureChoices(null, [figure('a')], [])[0]?.svgPath).toBeNull()
  })

  it('lists a repeated id once, at its first position', () => {
    const choices = figureChoices(ROOT, [figure('a', 'first'), figure('b'), figure('a', 'again')], [])
    expect(choices.map((c) => c.id)).toEqual(['a', 'b'])
    expect(choices[0]?.title).toBe('first')
  })

  it('is empty for an empty project', () => {
    expect(figureChoices(ROOT, [], [])).toEqual([])
  })
})

describe('filterFigureChoices', () => {
  const choices = figureChoices(
    ROOT,
    [figure('fig-spectrum', 'Emission-line spectrum'), figure('fig-velocity-map', 'Velocity field')],
    [hit('fig-scratch')]
  )

  it('returns everything for an empty or whitespace query', () => {
    expect(filterFigureChoices(choices, '')).toHaveLength(3)
    expect(filterFigureChoices(choices, '   ')).toHaveLength(3)
  })

  it('matches the id, case-insensitively', () => {
    expect(filterFigureChoices(choices, 'VELOCITY').map((c) => c.id)).toEqual(['fig-velocity-map'])
  })

  it('matches the caption title', () => {
    expect(filterFigureChoices(choices, 'emission').map((c) => c.id)).toEqual(['fig-spectrum'])
  })

  it('matches a disk-only figure, which has an id but no title', () => {
    expect(filterFigureChoices(choices, 'scratch').map((c) => c.id)).toEqual(['fig-scratch'])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterFigureChoices(choices, 'nothing here')).toEqual([])
  })
})
