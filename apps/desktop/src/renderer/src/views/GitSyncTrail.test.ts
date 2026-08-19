import { describe, expect, it } from 'vitest'
import { activeStage, buildTrail } from './GitSyncTrail'

describe('buildTrail', () => {
  it('lays the four resting places out in the order work moves through them', () => {
    const trail = buildTrail({ unstaged: 1, staged: 2, ahead: 3, hasRemote: true })
    expect(trail.map((s) => s.tone)).toEqual(['working', 'staged', 'local', 'remote'])
    expect(trail.map((s) => s.count)).toEqual([1, 2, 3, 0])
  })

  it('singularizes the labels for a count of one', () => {
    const trail = buildTrail({ unstaged: 1, staged: 1, ahead: 1, hasRemote: true })
    expect(trail[0]?.label).toBe('edited file')
    expect(trail[1]?.label).toBe('staged file')
    expect(trail[2]?.label).toBe('commit to push')
  })

  it('pluralizes for anything else, zero included', () => {
    const trail = buildTrail({ unstaged: 0, staged: 2, ahead: 5, hasRemote: true })
    expect(trail[0]?.label).toBe('edited files')
    expect(trail[1]?.label).toBe('staged files')
    expect(trail[2]?.label).toBe('commits to push')
  })

  /**
   * The bug this pins: a project with no remote is the LEAST safe state there
   * is, and an earlier version drew it with a green tick because the stage was
   * simply "not counting anything".
   */
  it('never presents a missing remote as a good state', () => {
    const none = buildTrail({ unstaged: 0, staged: 0, ahead: 0, hasRemote: false })
    expect(none[3]?.ok).toBe(false)
    expect(none[3]?.doneLabel).toBe('Not backed up')
    expect(none[3]?.hint).toMatch(/nothing is backed up/i)
  })

  it('marks a real remote as the safe resting state', () => {
    const some = buildTrail({ unstaged: 0, staged: 0, ahead: 0, hasRemote: true })
    expect(some[3]?.ok).toBe(true)
    expect(some[3]?.doneLabel).toBe('Backed up')
  })
})

describe('activeStage', () => {
  it('points at the leftmost place that is actually holding work', () => {
    expect(activeStage(buildTrail({ unstaged: 2, staged: 1, ahead: 1, hasRemote: true }))).toBe(
      'working'
    )
    expect(activeStage(buildTrail({ unstaged: 0, staged: 1, ahead: 1, hasRemote: true }))).toBe(
      'staged'
    )
    expect(activeStage(buildTrail({ unstaged: 0, staged: 0, ahead: 1, hasRemote: true }))).toBe(
      'local'
    )
  })

  it('points at nothing when every stage is clear', () => {
    expect(activeStage(buildTrail({ unstaged: 0, staged: 0, ahead: 0, hasRemote: true }))).toBeNull()
  })
})
