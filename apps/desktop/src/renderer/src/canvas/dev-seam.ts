import type { interact } from '@suna/canvas'

/**
 * Dev-only seam so e2e drivers (CDP) can steer the canvas tools without
 * synthesizing toolbar clicks. The active CanvasTab registers a provider on
 * mount; `main.tsx` exposes the stable `canvasToolsSeam` object as
 * `window.__sunaDev.canvasTools`.
 */

export interface CanvasToolsProvider {
  setTool(tool: interact.ToolId): void
  getSelection(): string[]
  getToolState(): { tool: interact.ToolId; gesture: interact.GestureState }
}

let provider: CanvasToolsProvider | null = null

export const canvasToolsSeam: CanvasToolsProvider = {
  setTool: (tool) => provider?.setTool(tool),
  getSelection: () => provider?.getSelection() ?? [],
  getToolState: () => provider?.getToolState() ?? { tool: 'select', gesture: { kind: 'idle' } }
}

/** Register the mounted CanvasTab; returns an unregister function. */
export function registerCanvasToolsProvider(p: CanvasToolsProvider): () => void {
  provider = p
  return () => {
    if (provider === p) provider = null
  }
}
