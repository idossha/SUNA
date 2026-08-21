import { beforeEach, describe, expect, it } from 'vitest'
import { useRoundFocusStore } from './roundFocus'

/**
 * The round workspace's selection, which is where the two-pane compare view
 * lives or dies: the panes are only useful if a pick aimed at one of them
 * leaves the other exactly where it was.
 */
const reset = (): void =>
  useRoundFocusStore.setState({
    roundId: null,
    points: { a: null, b: null },
    activePane: 'a',
    split: false,
    mode: 'scroll',
    filter: 'all',
    nonces: { a: 0, b: 0 }
  })

describe('roundFocus', () => {
  beforeEach(reset)

  it('focuses the active pane by default', () => {
    const st = useRoundFocusStore.getState()
    st.focus('r1', 'p1')
    expect(useRoundFocusStore.getState().points).toEqual({ a: 'p1', b: null })

    st.setActivePane('b')
    useRoundFocusStore.getState().focus('r1', 'p2')
    expect(useRoundFocusStore.getState().points).toEqual({ a: 'p1', b: 'p2' })
  })

  it('leaves the other pane alone, including its nonce', () => {
    const st = useRoundFocusStore.getState()
    st.focus('r1', 'p1', 'a')
    const before = useRoundFocusStore.getState().nonces
    useRoundFocusStore.getState().focus('r1', 'p2', 'b')
    const after = useRoundFocusStore.getState().nonces
    expect(after.a).toBe(before.a)
    expect(after.b).toBe(before.b + 1)
  })

  it('re-picking the same point still bumps that pane, so it re-scrolls', () => {
    useRoundFocusStore.getState().focus('r1', 'p1', 'a')
    const first = useRoundFocusStore.getState().nonces.a
    useRoundFocusStore.getState().focus('r1', 'p1', 'a')
    expect(useRoundFocusStore.getState().nonces.a).toBe(first + 1)
  })

  it('marks without bumping the nonce — the scroll-spy must not re-scroll', () => {
    useRoundFocusStore.getState().focus('r1', 'p1', 'a')
    const before = useRoundFocusStore.getState().nonces.a
    useRoundFocusStore.getState().mark('r1', 'p9', 'a')
    expect(useRoundFocusStore.getState().points.a).toBe('p9')
    expect(useRoundFocusStore.getState().nonces.a).toBe(before)
  })

  it('clears both panes when the round changes', () => {
    const st = useRoundFocusStore.getState()
    st.focus('r1', 'p1', 'a')
    useRoundFocusStore.getState().focus('r1', 'p2', 'b')
    useRoundFocusStore.getState().focus('r2', 'q1', 'a')
    expect(useRoundFocusStore.getState().points).toEqual({ a: 'q1', b: null })
  })

  it('seeds pane B from pane A when the split opens, and only when B is empty', () => {
    useRoundFocusStore.getState().focus('r1', 'p1', 'a')
    useRoundFocusStore.getState().setSplit(true)
    expect(useRoundFocusStore.getState().points.b).toBe('p1')

    useRoundFocusStore.getState().focus('r1', 'p5', 'b')
    useRoundFocusStore.getState().setSplit(false)
    useRoundFocusStore.getState().setSplit(true)
    expect(useRoundFocusStore.getState().points.b).toBe('p5')
  })

  it('hands the outline back to pane A when the split closes', () => {
    useRoundFocusStore.getState().setSplit(true)
    useRoundFocusStore.getState().setActivePane('b')
    useRoundFocusStore.getState().setSplit(false)
    expect(useRoundFocusStore.getState().activePane).toBe('a')
  })

  it('toggles both ways', () => {
    useRoundFocusStore.getState().toggleSplit()
    expect(useRoundFocusStore.getState().split).toBe(true)
    useRoundFocusStore.getState().toggleSplit()
    expect(useRoundFocusStore.getState().split).toBe(false)
  })
})
