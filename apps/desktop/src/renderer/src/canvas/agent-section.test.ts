import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@suna/formatter'
import { captureRegionFor, complianceLines, selectionReadout } from './agent-section'

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom
})

describe('captureRegionFor', () => {
  it('pads a single rect by the given amount on every side', () => {
    expect(captureRegionFor([rect(100, 50, 300, 150)], 12)).toEqual({
      x: 88,
      y: 38,
      width: 224,
      height: 124
    })
  })

  it('unions multiple rects before padding', () => {
    const region = captureRegionFor([rect(100, 100, 200, 200), rect(150, 50, 400, 120)], 12)
    expect(region).toEqual({ x: 88, y: 38, width: 324, height: 174 })
  })

  it('offsets client coordinates into page coordinates', () => {
    const region = captureRegionFor([rect(10, 20, 30, 40)], 0, 5, 7)
    expect(region).toEqual({ x: 15, y: 27, width: 20, height: 20 })
  })

  it('returns null when there is nothing measurable', () => {
    expect(captureRegionFor([], 12)).toBeNull()
    expect(captureRegionFor([rect(0, 0, 0, 0), rect(40, 40, 40, 40)], 12)).toBeNull()
  })

  it('keeps a zero-extent rect on one axis (a line) and gives it area via padding', () => {
    expect(captureRegionFor([rect(10, 30, 90, 30)], 12)).toEqual({
      x: -2,
      y: 18,
      width: 104,
      height: 24
    })
  })

  it('drops 0x0 rects but unions the rest', () => {
    const region = captureRegionFor([rect(0, 0, 0, 0), rect(10, 10, 20, 20)], 2)
    expect(region).toEqual({ x: 8, y: 8, width: 14, height: 14 })
  })
})

describe('selectionReadout', () => {
  it('names the whole figure when nothing is selected', () => {
    expect(selectionReadout([])).toBe('Whole figure')
  })

  it('shows the lone selected id', () => {
    expect(selectionReadout(['ax0.title'])).toBe('Selection: ax0.title')
  })

  it('shows the first id plus a count for multi-selection', () => {
    expect(selectionReadout(['ax0.title', 'ax0.legend', 'ax1'])).toBe(
      'Selection: ax0.title (+2 more)'
    )
  })
})

describe('complianceLines', () => {
  it('renders severity, rule id, and message per issue', () => {
    const diagnostics: Diagnostic[] = [
      { id: 'fig.min-font', severity: 'error', surface: 'figure', message: 'text is 4.2pt, minimum is 5pt' },
      { id: 'fig.stroke', severity: 'warning', surface: 'figure', message: 'hairline stroke' }
    ]
    expect(complianceLines(diagnostics)).toEqual([
      'error fig.min-font: text is 4.2pt, minimum is 5pt',
      'warning fig.stroke: hairline stroke'
    ])
  })

  it('is empty for a clean figure', () => {
    expect(complianceLines([])).toEqual([])
  })
})
