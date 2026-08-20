import { describe, expect, it } from 'vitest'
import { DOC_MODE_OPTIONS, DOC_VIEW_MODES, nextDocMode, type DocViewMode } from './settings'

describe('nextDocMode', () => {
  it('cycles source -> reading -> pages -> source', () => {
    expect(nextDocMode('source')).toBe('reading')
    expect(nextDocMode('reading')).toBe('pages')
    expect(nextDocMode('pages')).toBe('source')
  })

  it('returns to where it started after one full cycle', () => {
    let mode: DocViewMode = 'source'
    for (let i = 0; i < DOC_VIEW_MODES.length; i += 1) mode = nextDocMode(mode)
    expect(mode).toBe('source')
  })

})

describe('DOC_MODE_OPTIONS', () => {
  it('offers every mode exactly once, so the switch can reach all of them', () => {
    expect(DOC_MODE_OPTIONS.map((o) => o.value)).toEqual([...DOC_VIEW_MODES])
  })

  it('labels and describes every option', () => {
    for (const option of DOC_MODE_OPTIONS) {
      expect(option.label).toBeTruthy()
      expect(option.title).toBeTruthy()
    }
  })

  it('runs source -> reading -> pages, which is increasing finality', () => {
    // The order is the point: you type source, read it rendered, then see the
    // pages it becomes. A control that listed them any other way would be
    // asking the reader to hold an arbitrary order in their head.
    expect(DOC_MODE_OPTIONS.map((o) => o.value)).toEqual(['source', 'reading', 'pages'])
  })
})
