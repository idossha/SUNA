import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commentRunKey,
  figureRunKey,
  REPAIR_RUN_KEY,
  useAiActionsStore
} from './aiActions'

/**
 * Transition tests for the directed-action run store (DECISIONS 2026-08-17).
 * The invariant that matters most: a run key that has finished can never be
 * resurrected by a late progress tick — the done event races the adapter's
 * last synthetic "Thinking…" push, and a resurrected run would leave a
 * phantom busy card with a dead cancel handle.
 */

beforeEach(() => {
  useAiActionsStore.setState({ runs: {} })
})

describe('start', () => {
  it('creates a busy run with the note and cancel handle', () => {
    const cancel = vi.fn()
    useAiActionsStore.getState().start('comment:c1', 'Starting…', cancel)
    const run = useAiActionsStore.getState().runs['comment:c1']
    expect(run).toEqual({ status: 'busy', note: 'Starting…', cancel })
  })

  it('keeps runs under different keys independent', () => {
    useAiActionsStore.getState().start('comment:c1', 'a', () => {})
    useAiActionsStore.getState().start('figure:f1', 'b', () => {})
    useAiActionsStore.getState().finish('comment:c1')
    expect(useAiActionsStore.getState().runs['comment:c1']).toBeUndefined()
    expect(useAiActionsStore.getState().runs['figure:f1']?.note).toBe('b')
  })

  it('overwrites a re-started key with the fresh note and cancel', () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    useAiActionsStore.getState().start('repair', 'old', stale)
    useAiActionsStore.getState().start('repair', 'new', fresh)
    const run = useAiActionsStore.getState().runs['repair']
    expect(run?.note).toBe('new')
    expect(run?.cancel).toBe(fresh)
  })
})

describe('progress', () => {
  it('updates the note and preserves the cancel handle', () => {
    const cancel = vi.fn()
    useAiActionsStore.getState().start('figure:f1', 'Starting…', cancel)
    useAiActionsStore.getState().progress('figure:f1', 'Thinking…')
    const run = useAiActionsStore.getState().runs['figure:f1']
    expect(run?.note).toBe('Thinking…')
    expect(run?.cancel).toBe(cancel)
  })

  it('never resurrects a finished run from a late tick', () => {
    useAiActionsStore.getState().start('comment:c1', 'Starting…', () => {})
    useAiActionsStore.getState().finish('comment:c1')
    useAiActionsStore.getState().progress('comment:c1', 'Thinking…')
    expect(useAiActionsStore.getState().runs['comment:c1']).toBeUndefined()
  })

  it('is a no-op for a key that never started', () => {
    useAiActionsStore.getState().progress('figure:ghost', 'Thinking…')
    expect(useAiActionsStore.getState().runs).toEqual({})
  })
})

describe('finish', () => {
  it('removes the run', () => {
    useAiActionsStore.getState().start('repair', 'Starting…', () => {})
    useAiActionsStore.getState().finish('repair')
    expect(useAiActionsStore.getState().runs['repair']).toBeUndefined()
  })

  it('is a no-op when the key is absent', () => {
    const before = useAiActionsStore.getState().runs
    useAiActionsStore.getState().finish('repair')
    expect(useAiActionsStore.getState().runs).toBe(before)
  })
})

describe('key helpers', () => {
  it('spell the keys the way §2c pins them', () => {
    expect(commentRunKey('c-9')).toBe('comment:c-9')
    expect(figureRunKey('fig-density')).toBe('figure:fig-density')
    expect(REPAIR_RUN_KEY).toBe('repair')
  })
})
