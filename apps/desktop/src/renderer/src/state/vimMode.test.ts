import { beforeEach, describe, expect, it } from 'vitest'
import { useVimModeStore } from './vimMode'

/**
 * dockview keeps hidden panels mounted, so two editors with vim installed is
 * the normal case, not an edge case. The chip is a single global slot, so it
 * has to know WHICH editor is talking.
 */
beforeEach(() => {
  useVimModeStore.setState({ owner: null, mode: null })
})

describe('useVimModeStore', () => {
  it('shows the mode of whichever editor reported last', () => {
    const manuscript = {}
    useVimModeStore.getState().setMode(manuscript, 'normal')
    expect(useVimModeStore.getState().mode).toBe('normal')
    useVimModeStore.getState().setMode(manuscript, 'insert')
    expect(useVimModeStore.getState().mode).toBe('insert')
  })

  it('does NOT blank the chip when another editor is torn down', () => {
    const manuscript = {}
    const fileTab = {}
    useVimModeStore.getState().setMode(manuscript, 'normal')
    useVimModeStore.getState().setMode(fileTab, 'normal')
    // The file tab is closed: its destroy() reports null.
    useVimModeStore.getState().setMode(fileTab, null)
    expect(useVimModeStore.getState().mode).toBeNull()

    // The reverse order is the regression: closing the file tab while the
    // manuscript editor is the one on the chip must leave the chip alone.
    useVimModeStore.getState().setMode(manuscript, 'normal')
    useVimModeStore.getState().setMode(fileTab, null)
    expect(useVimModeStore.getState()).toMatchObject({ owner: manuscript, mode: 'normal' })
  })

  it('lets the current owner clear the chip when its own vim goes away', () => {
    const manuscript = {}
    useVimModeStore.getState().setMode(manuscript, 'normal')
    useVimModeStore.getState().setMode(manuscript, null)
    expect(useVimModeStore.getState()).toMatchObject({ owner: null, mode: null })
  })
})
