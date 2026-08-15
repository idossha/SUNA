import { getBundledProfile } from '@suna/formatter'
import { ManuscriptSchema, type ManuscriptFigure, type PublisherProfile } from '@suna/core'
import { openFileTab } from '../state/dock'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { widthPresetsFor } from './export-presets'

/**
 * "New Figure" (feature-plan-3 §4): create figures/<slug>/{figure.svg,
 * figure.json} at the active profile's double-column width, register it in
 * manuscript.json, refresh the tree, and open it on the canvas. Shared by
 * the Figures view header button and the canvas tab's own "+" (CanvasTab.tsx).
 */

export interface NewFigureResult {
  figureId: string
  svgPath: string
}

/** Width (mm) a brand-new figure's artboard gets: the active profile's double-column preset. */
export function newFigureWidthMm(profile: PublisherProfile | null): number {
  return widthPresetsFor(profile).find((p) => p.key === 'double')?.widthMm ?? 180
}

function activeProfile(): PublisherProfile | null {
  const id = useProjectStore.getState().manifest?.activeProfileId ?? null
  return id ? getBundledProfile(id) : null
}

export async function createNewFigure(
  rootDir: string,
  name: string
): Promise<NewFigureResult | null> {
  const trimmed = name.trim()
  if (trimmed === '') return null
  const widthMm = newFigureWidthMm(activeProfile())
  try {
    const created = await window.suna.invoke('figure:create', { dir: rootDir, name: trimmed, widthMm })
    const read = await window.suna.invoke('manuscript:update', { dir: rootDir, patch: {} })
    const manuscript = ManuscriptSchema.parse(read.manuscript)
    const newFigure: ManuscriptFigure = {
      id: created.figureId,
      namespace: 'main',
      canvasRef: created.canvasRef,
      widthPreset: 'double',
      caption: { title: trimmed, body: '' },
      panels: []
    }
    await window.suna.invoke('manuscript:update', {
      dir: rootDir,
      patch: { figures: [...manuscript.figures, newFigure] }
    })
    await useProjectStore.getState().refreshTree()
    openFileTab(created.svgPath)
    return { figureId: created.figureId, svgPath: created.svgPath }
  } catch (error) {
    useUiStore
      .getState()
      .setStatusNote(
        `Could not create figure: ${error instanceof Error ? error.message : String(error)}`
      )
    return null
  }
}
