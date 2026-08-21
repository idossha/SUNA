import { describe, expect, it } from 'vitest'
import { isSeedWork, normalizeDoi } from './similar'

const seed = { doi: '10.1038/s41593-023-01456-8', title: 'Non-invasive temporal interference' }

describe('normalizeDoi', () => {
  it('strips the resolver prefix and case', () => {
    expect(normalizeDoi('https://doi.org/10.1038/ABC')).toBe('10.1038/abc')
    expect(normalizeDoi('http://dx.doi.org/10.1038/abc')).toBe('10.1038/abc')
    expect(normalizeDoi('doi:10.1038/abc')).toBe('10.1038/abc')
    expect(normalizeDoi(' 10.1038/abc ')).toBe('10.1038/abc')
  })
})

describe('isSeedWork', () => {
  it('recognises the seed however its DOI is written', () => {
    expect(isSeedWork({ doi: 'https://doi.org/10.1038/S41593-023-01456-8', title: 'x' }, seed)).toBe(
      true
    )
  })

  it('keeps a different work even when the title is close', () => {
    expect(
      isSeedWork({ doi: '10.1016/j.brs.2024.01.001', title: 'Non-invasive temporal interference' }, seed)
    ).toBe(false)
  })

  it('falls back to the title when either side has no DOI', () => {
    expect(isSeedWork({ doi: null, title: 'Non-invasive  temporal interference.' }, seed)).toBe(true)
    expect(isSeedWork({ doi: null, title: 'Something else entirely' }, seed)).toBe(false)
    expect(isSeedWork({ doi: '10.1/x', title: 'Non-invasive temporal interference' }, { doi: null, title: seed.title })).toBe(true)
  })

  it('filters nothing when no search seed is active', () => {
    expect(isSeedWork({ doi: '10.1/x', title: 'anything' }, null)).toBe(false)
  })
})
