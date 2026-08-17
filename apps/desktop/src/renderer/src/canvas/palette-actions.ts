import type { CanvasDocument } from '@suna/canvas'
import type { PublisherProfile } from '@suna/core'
import type { Diagnostic } from '@suna/formatter'

/**
 * Lets the command palette's figure commands ("Run Compliance Check",
 * "Export Figure as PNG/PDF" — feature-plan-4 §5 BUILD step 2) act on
 * whichever CanvasTab is actually on screen, without commands.ts reaching
 * into CanvasTab's internals. Same provider-stack shape as
 * `canvas/dev-seam.ts`'s `canvasToolsSeam`: more than one figure can be
 * open, dockview keeps inactive tabs mounted at zero size, so the seam
 * resolves through `isVisible()` rather than "last registered wins".
 */
export interface CanvasPaletteContext {
  rootDir: string
  figureId: string
  profile: PublisherProfile | null
  doc: CanvasDocument
  /** Flushes the editor's in-memory doc to figure.svg on disk (export reads the file, not the live doc). */
  save: () => Promise<void>
  /**
   * Re-checks compliance, updates the tab's diagnostics UI, and RETURNS the
   * fresh list — the Agent section (feature-plan-8 §4) reads it at send
   * time, when the tab's cached React state may be stale.
   */
  runCompliance: () => Diagnostic[]
  isVisible: () => boolean
}

const providers: CanvasPaletteContext[] = []

/** The visible figure's context, most recently registered first; null when none is on screen. */
export function activeCanvasPaletteContext(): CanvasPaletteContext | null {
  for (let i = providers.length - 1; i >= 0; i -= 1) {
    const provider = providers[i]
    if (provider && provider.isVisible()) return provider
  }
  return null
}

/** Register a mounted CanvasTab's context; returns an unregister function. */
export function registerCanvasPaletteContext(context: CanvasPaletteContext): () => void {
  providers.push(context)
  return () => {
    const at = providers.indexOf(context)
    if (at >= 0) providers.splice(at, 1)
  }
}
