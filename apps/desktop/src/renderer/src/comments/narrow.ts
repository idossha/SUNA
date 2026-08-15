import { useEffect, useState } from 'react'

/**
 * Below this WINDOW width the margin comment gutter collapses to dots + a
 * popover (feature-plan-3 §3: "when the window is narrow (< 1100 px)").
 *
 * Measured against `window.innerWidth`, deliberately NOT against the host
 * panel's own width. A dock panel is routinely narrower than the window
 * (sidebar + a split neighbour), so a panel-width test put the gutter in dot
 * mode on a perfectly wide window — at a 1265 px window the manuscript panel
 * measures ~930 px, and the card mode this feature is *about* never rendered.
 * Both hosts (manuscript/ManuscriptTab, editor/EditorTab) share this hook so
 * they can never disagree about which mode they are in.
 */
export const GUTTER_NARROW_BREAKPOINT_PX = 1100

function isNarrow(): boolean {
  return window.innerWidth < GUTTER_NARROW_BREAKPOINT_PX
}

export function useNarrowGutter(): boolean {
  const [narrow, setNarrow] = useState(isNarrow)
  useEffect(() => {
    const onResize = (): void => setNarrow(isNarrow())
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return narrow
}
