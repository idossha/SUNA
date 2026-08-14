import { getBundledProfile } from '@suna/formatter'
import { describe, expect, it } from 'vitest'
import {
  findAxesGroupIds,
  formatPanelLabel,
  letterFor,
  orderPanelsForLettering,
  panelLabelAnchor,
  resolvePanelLabelConvention,
  type ElementLike
} from './panel-letters'

/** Minimal ElementLike tree, mirroring suna_mpl output (mpl-two-panel.svg). */
function el(id: string | null, children: ElementLike[] = []): ElementLike {
  return {
    getAttribute: (name) => (name === 'id' ? id : null),
    children
  }
}

describe('findAxesGroupIds', () => {
  it('finds axes groups nested anywhere in the tree, in document order', () => {
    const root = el('svg', [
      el('figure_1', [
        el('patch_1'),
        el('ax0', [el('matplotlib.axis_1', [el('xtick_1')])]),
        el('ax1', [el('matplotlib.axis_2')])
      ])
    ])
    expect(findAxesGroupIds(root)).toEqual(['ax0', 'ax1'])
  })

  it('ignores ids that merely contain an axes-like substring', () => {
    const root = el('svg', [el('ax0.legend'), el('axes_1'), el('myax0')])
    expect(findAxesGroupIds(root)).toEqual([])
  })

  it('does not descend into a matched group looking for nested matches', () => {
    // Not realistic suna_mpl output, but pins the "no double count" contract.
    const root = el('svg', [el('ax0', [el('ax1')])])
    expect(findAxesGroupIds(root)).toEqual(['ax0'])
  })

  it('returns an empty list for a figure with no axes groups', () => {
    expect(findAxesGroupIds(el('svg', [el('patch_1')]))).toEqual([])
  })
})

describe('resolvePanelLabelConvention', () => {
  it('defaults to lowercase bold unwrapped when there is no profile', () => {
    expect(resolvePanelLabelConvention(null)).toEqual({
      letterCase: 'lower',
      weight: 'bold',
      wrapper: 'none'
    })
  })

  it('defaults every null field even when a profile states none of them (apj-aas)', () => {
    const profile = getBundledProfile('apj-aas')
    expect(resolvePanelLabelConvention(profile)).toEqual({
      letterCase: 'lower',
      weight: 'bold',
      wrapper: 'none'
    })
  })

  it('reads the stated convention from nature-astronomy', () => {
    const profile = getBundledProfile('nature-astronomy')
    expect(resolvePanelLabelConvention(profile)).toEqual({
      letterCase: 'lower',
      weight: 'bold',
      wrapper: 'none'
    })
  })

  it('reads uppercase from science', () => {
    const profile = getBundledProfile('science')
    expect(resolvePanelLabelConvention(profile)).toEqual({
      letterCase: 'upper',
      weight: 'bold',
      wrapper: 'none'
    })
  })

  it('reads a parens wrapper and defaults the unstated weight from mnras', () => {
    const profile = getBundledProfile('mnras')
    expect(resolvePanelLabelConvention(profile)).toEqual({
      letterCase: 'lower',
      weight: 'bold',
      wrapper: 'parens'
    })
  })
})

describe('letterFor', () => {
  it('produces a, b, … z lowercase', () => {
    expect(letterFor(0, 'lower')).toBe('a')
    expect(letterFor(1, 'lower')).toBe('b')
    expect(letterFor(25, 'lower')).toBe('z')
  })

  it('extends past z with a spreadsheet-column style (aa, ab, …)', () => {
    expect(letterFor(26, 'lower')).toBe('aa')
    expect(letterFor(27, 'lower')).toBe('ab')
  })

  it('uppercases on request', () => {
    expect(letterFor(0, 'upper')).toBe('A')
    expect(letterFor(26, 'upper')).toBe('AA')
  })
})

describe('formatPanelLabel', () => {
  it('wraps in parens or leaves bare', () => {
    expect(formatPanelLabel('a', 'parens')).toBe('(a)')
    expect(formatPanelLabel('a', 'none')).toBe('a')
  })
})

describe('orderPanelsForLettering', () => {
  it('sorts a single row left-to-right regardless of input order', () => {
    const panels = [
      { id: 'ax1', bbox: { x: 100, y: 0, width: 50, height: 40 } },
      { id: 'ax0', bbox: { x: 0, y: 0, width: 50, height: 40 } }
    ]
    expect(orderPanelsForLettering(panels).map((p) => p.id)).toEqual(['ax0', 'ax1'])
  })

  it('tolerates small y jitter within one row', () => {
    const panels = [
      { id: 'ax1', bbox: { x: 100, y: 2, width: 50, height: 40 } },
      { id: 'ax0', bbox: { x: 0, y: 0, width: 50, height: 40 } }
    ]
    expect(orderPanelsForLettering(panels).map((p) => p.id)).toEqual(['ax0', 'ax1'])
  })

  it('sorts a 2x2 grid in row-major reading order', () => {
    const panels = [
      { id: 'br', bbox: { x: 60, y: 60, width: 50, height: 40 } },
      { id: 'tl', bbox: { x: 0, y: 0, width: 50, height: 40 } },
      { id: 'tr', bbox: { x: 60, y: 0, width: 50, height: 40 } },
      { id: 'bl', bbox: { x: 0, y: 60, width: 50, height: 40 } }
    ]
    expect(orderPanelsForLettering(panels).map((p) => p.id)).toEqual(['tl', 'tr', 'bl', 'br'])
  })

  it('leaves 0 or 1 panels untouched', () => {
    expect(orderPanelsForLettering([])).toEqual([])
    const one = [{ id: 'ax0', bbox: { x: 0, y: 0, width: 1, height: 1 } }]
    expect(orderPanelsForLettering(one)).toEqual(one)
  })
})

describe('panelLabelAnchor', () => {
  it('sits flush left, baseline lifted above the panel by 0.4 * font size', () => {
    expect(panelLabelAnchor({ x: 10, y: 20, width: 5, height: 5 }, 10)).toEqual({ x: 10, y: 16 })
  })
})
