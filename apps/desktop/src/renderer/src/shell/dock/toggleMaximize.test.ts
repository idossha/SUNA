import { describe, expect, it, vi } from 'vitest'
import { toggleMaximize, type MaximizableDock } from './toggleMaximize'

function makeDock(groupCount: number, maximized = false): MaximizableDock {
  const api = {
    isMaximized: () => maximized,
    maximize: vi.fn(),
    exitMaximized: vi.fn()
  }
  return {
    groups: Array.from({ length: groupCount }, () => ({})),
    activeGroup: groupCount > 0 ? { api } : undefined,
    hasMaximizedGroup: () => maximized,
    exitMaximizedGroup: vi.fn()
  }
}

describe('toggleMaximize', () => {
  it('maximizes the active group when split', () => {
    const dock = makeDock(2)
    expect(toggleMaximize(dock)).toBe(true)
    expect(dock.activeGroup?.api.maximize).toHaveBeenCalled()
  })

  it('does nothing with a single group', () => {
    const dock = makeDock(1)
    expect(toggleMaximize(dock)).toBe(false)
    expect(dock.activeGroup?.api.maximize).not.toHaveBeenCalled()
  })

  it('restores the split on a second double-click', () => {
    const dock = makeDock(2, true)
    expect(toggleMaximize(dock)).toBe(true)
    expect(dock.exitMaximizedGroup).toHaveBeenCalled()
  })
})
