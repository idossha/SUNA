import { describe, expect, it } from 'vitest'
import { nextCopyId, pickAvailableId } from './duplicate-id'

describe('nextCopyId', () => {
  it('suffixes -copy, then -copy-2, -copy-3, …', () => {
    expect(nextCopyId('fig1', 0)).toBe('fig1-copy')
    expect(nextCopyId('fig1', 1)).toBe('fig1-copy-2')
    expect(nextCopyId('fig1', 2)).toBe('fig1-copy-3')
  })
})

describe('pickAvailableId', () => {
  it('returns the base -copy id when free', () => {
    expect(pickAvailableId('fig1', new Set())).toBe('fig1-copy')
  })

  it('skips ids already taken', () => {
    expect(pickAvailableId('fig1', new Set(['fig1-copy', 'fig1-copy-2']))).toBe('fig1-copy-3')
  })

  it('gives up after maxAttempts and returns null', () => {
    const taken = new Set<string>()
    for (let i = 0; i < 5; i++) taken.add(nextCopyId('fig1', i))
    expect(pickAvailableId('fig1', taken, 5)).toBeNull()
  })
})
