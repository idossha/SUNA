import { describe, expect, it } from 'vitest'
import type { OversizedBlock } from '@suna/core'
import { overrunLabel, oversizedMessage, oversizedToastDetail } from './oversized'

const table: OversizedBlock = { kind: 'table', label: 'Table 3', heightRatio: 1.42 }
const figure: OversizedBlock = { kind: 'figure', label: 'Figure 2', heightRatio: 2 }

describe('overrunLabel', () => {
  it('reports the overrun to one decimal', () => {
    expect(overrunLabel(table)).toBe('1.4× the printable page height')
    expect(overrunLabel(figure)).toBe('2.0× the printable page height')
  })
})

describe('oversizedMessage', () => {
  it('names the block, the overrun and what the export did anyway', () => {
    const msg = oversizedMessage(table)
    expect(msg).toContain('Table 3')
    expect(msg).toContain('1.4×')
    expect(msg).toContain('header row repeats')
  })

  it('offers a figure the remedies a figure actually has', () => {
    const msg = oversizedMessage(figure)
    expect(msg).toContain('width preset')
    // A figure has no header row to repeat — that sentence must not leak here.
    expect(msg).not.toContain('header row')
  })
})

describe('oversizedToastDetail', () => {
  it('is absent when everything fits, so the toast stays a success', () => {
    expect(oversizedToastDetail([])).toBeUndefined()
  })

  it('names a single offender', () => {
    expect(oversizedToastDetail([table])).toBe('Table 3 overruns the page')
  })

  it('counts rather than lists when several overrun', () => {
    expect(oversizedToastDetail([table, figure])).toBe('2 blocks overrun the page')
  })
})
