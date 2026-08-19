import { describe, expect, it } from 'vitest'
import { headLabel } from './GitBranches'

describe('headLabel', () => {
  it('names the branch when nothing else is going on', () => {
    expect(headLabel('main', false, 'none', null)).toBe('main')
  })

  it('says what is happening to the branch during an operation', () => {
    expect(headLabel('main', false, 'merge', 'revision-2')).toBe('main · merging')
    expect(headLabel('main', false, 'cherry-pick', null)).toBe('main · cherry-picking')
  })

  /**
   * The case this exists for: git really does detach HEAD during a rebase, and
   * "detached HEAD" is both frightening and useless to someone who pressed
   * Pull. The branch being replayed is the answer they want.
   */
  it('names the replayed branch rather than saying detached HEAD mid-rebase', () => {
    expect(headLabel(null, true, 'rebase', 'main')).toBe('main · rebasing')
  })

  it('still says something useful when the operation records no branch', () => {
    expect(headLabel(null, true, 'rebase', null)).toBe('rebasing')
  })

  /** A genuinely detached HEAD — checked out a commit — still says so. */
  it('keeps detached HEAD for a real detachment with no operation', () => {
    expect(headLabel(null, true, 'none', null)).toBe('detached HEAD')
  })

  it('shows a placeholder while the branch list is still loading', () => {
    expect(headLabel(null, false, 'none', null)).toBe('…')
  })
})
