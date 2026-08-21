import { getBundledProfile } from '@suna/formatter'
import { describe, expect, it } from 'vitest'
import {
  PANEL_LETTER_ATTR,
  findAxesGroupIds,
  findPanelLetterIds,
  formatPanelLabel,
  letterFor,
  orderPanelsForLettering,
  panelLabelAnchor,
  resolvePanelLabelConvention,
  type ElementLike
} from './panel-letters'

/** Minimal ElementLike tree, mirroring suna_mpl output (mpl-two-panel.svg). */
function el(
  id: string | null,
  children: ElementLike[] = [],
  attrs: Readonly<Record<string, string>> = {}
): ElementLike {
  return {
    getAttribute: (name) => (name === 'id' ? id : (attrs[name] ?? null)),
    children
  }
}

/** A `<text>` a previous auto-letter run inserted. */
function letterEl(id: string | null, letter = 'a'): ElementLike {
  return el(id, [], { [PANEL_LETTER_ATTR]: letter })
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

describe('findPanelLetterIds', () => {
  it('finds the ids of letters a previous run inserted, in document order', () => {
    const root = el('svg', [
      el('figure_1', [el('ax0')]),
      letterEl('suna-e1', 'a'),
      letterEl('suna-e2', 'b')
    ])
    expect(findPanelLetterIds(root)).toEqual(['suna-e1', 'suna-e2'])
  })

  it('finds one that has been moved inside a group', () => {
    const root = el('svg', [el('g1', [letterEl('suna-e1')])])
    expect(findPanelLetterIds(root)).toEqual(['suna-e1'])
  })

  it('ignores unmarked text and marked elements with no id to remove by', () => {
    const root = el('svg', [el('some-text'), letterEl(null), letterEl('')])
    expect(findPanelLetterIds(root)).toEqual([])
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

  it('defaults every null field even when a profile states none of them (neuron)', () => {
    const profile = getBundledProfile('neuron')
    expect(resolvePanelLabelConvention(profile)).toEqual({
      letterCase: 'lower',
      weight: 'bold',
      wrapper: 'none'
    })
  })

  it('reads the stated convention from nature', () => {
    const profile = getBundledProfile('nature')
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

  it('reads a parens wrapper and defaults the unstated weight from jne', () => {
    const profile = getBundledProfile('jne')
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

  it('leaves a placement that already clears the artboard top untouched', () => {
    const bounds = { x: 0, y: 0, width: 200, height: 100 }
    expect(panelLabelAnchor({ x: 10, y: 20, width: 50, height: 40 }, 10, bounds)).toEqual({
      x: 10,
      y: 16
    })
  })

  /**
   * The real matplotlib case: an axes bbox includes tick labels and the
   * title, so it starts ~6 user units from the top of a 510x164 artboard.
   * Unclamped the baseline lands at 3.24 with a whole em of ascent above it
   * — off the page, clipped, invisible. This is the bug the clamp fixes.
   */
  it('pulls a letter that would be clipped above the artboard back onto it', () => {
    const bounds = { x: 0, y: 0, width: 510.236, height: 164.409 }
    const anchor = panelLabelAnchor({ x: 6.19, y: 6.04, width: 240, height: 150 }, 7, bounds)
    expect(anchor.y).toBeCloseTo(7, 6)
    expect(anchor.y - 7).toBeGreaterThanOrEqual(bounds.y)
    expect(anchor.x).toBeCloseTo(6.19, 6)
  })

  it('keeps a letter inside the artboard left and right edges', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    expect(panelLabelAnchor({ x: -5, y: 50, width: 20, height: 20 }, 10, bounds).x).toBe(0)
    expect(panelLabelAnchor({ x: 99, y: 50, width: 20, height: 20 }, 10, bounds).x).toBe(90)
  })

  it('respects a non-zero artboard origin', () => {
    const bounds = { x: 20, y: 30, width: 100, height: 100 }
    expect(panelLabelAnchor({ x: 25, y: 31, width: 20, height: 20 }, 10, bounds)).toEqual({
      x: 25,
      y: 40
    })
  })
})
