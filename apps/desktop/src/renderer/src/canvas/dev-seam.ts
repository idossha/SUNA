import type { interact } from '@suna/canvas'

/**
 * Dev-only seam so e2e drivers (CDP) can steer the canvas tools without
 * synthesizing toolbar clicks. Every mounted CanvasTab registers a provider;
 * `main.tsx` exposes the stable `canvasToolsSeam` object as
 * `window.__sunaDev.canvasTools`.
 *
 * More than one figure can be open at once, and dockview keeps the inactive
 * tabs mounted (hidden, zero-size). A single "last one wins" slot would then
 * point at a canvas the driver cannot see or click — the tool would change on
 * the hidden document while the mouse events landed on the visible one. So
 * providers are kept as a stack and resolved through `isVisible()`: the seam
 * always steers the canvas that is actually on screen.
 */

export interface CanvasToolsProvider {
  setTool(tool: interact.ToolId): void
  getSelection(): string[]
  getToolState(): { tool: interact.ToolId; gesture: interact.GestureState }
  /** False while this tab is mounted but hidden behind another dock panel. */
  isVisible(): boolean
}

const providers: CanvasToolsProvider[] = []

/** The visible canvas, most recently registered first; null when none is. */
function active(): CanvasToolsProvider | null {
  for (let i = providers.length - 1; i >= 0; i--) {
    const provider = providers[i]
    if (provider && provider.isVisible()) return provider
  }
  return null
}

export const canvasToolsSeam: CanvasToolsProvider = {
  setTool: (tool) => active()?.setTool(tool),
  getSelection: () => active()?.getSelection() ?? [],
  getToolState: () => active()?.getToolState() ?? { tool: 'select', gesture: { kind: 'idle' } },
  isVisible: () => active() !== null
}

/** Register a mounted CanvasTab; returns an unregister function. */
export function registerCanvasToolsProvider(p: CanvasToolsProvider): () => void {
  providers.push(p)
  return () => {
    const at = providers.indexOf(p)
    if (at >= 0) providers.splice(at, 1)
  }
}
