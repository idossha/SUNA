import type { JSX } from 'react'
import { interact, type CanvasDocument } from '@suna/canvas'
import { ManuscriptSchema, type CanvasCommand, type ManuscriptFigure, type PublisherProfile } from '@suna/core'
import { fmt, styleValue, toHexColor, type WorldRect } from './canvas-util'
import { pickAvailableId } from './duplicate-id'
import { NumberField } from './fields'
import {
  PANEL_LETTER_ATTR,
  findAxesGroupIds,
  findPanelLetterIds,
  formatPanelLabel,
  letterFor,
  orderPanelsForLettering,
  panelLabelAnchor,
  resolvePanelLabelConvention
} from './panel-letters'

/** 1 pt = 0.3528 mm (canvas-engine.md §2). */
const MM_PER_PT = 0.3528

interface FigureSectionProps {
  doc: CanvasDocument | null
  mmPerUser: number | null
  profile: PublisherProfile | null
  rootDir: string | null
  figureId: string | null
  apply: (command: CanvasCommand, label: string) => boolean
  worldBboxOf: (id: string) => WorldRect | null
  note: (text: string) => void
}

function clamp(value: number, lo: number | null, hi: number | null): number {
  return Math.min(Math.max(value, lo ?? value), hi ?? value)
}

/**
 * Figure panel (canvas parity spec §3.3): artboard mm size, background,
 * "Duplicate figure" (figure:duplicate → manuscript:update), and
 * "Auto-letter panels" (one batch insert per axes group, one undo).
 */
export function FigureSection(props: FigureSectionProps): JSX.Element {
  const { doc, mmPerUser, profile, rootDir, figureId, apply, worldBboxOf, note } = props
  const artboard = doc?.artboard ?? null
  const widthMm = artboard?.widthMm ?? null
  const heightMm = artboard?.heightMm ?? null
  const bgRaw = doc ? styleValue(doc.root, 'background-color') : null
  const bgHex = toHexColor(bgRaw)

  const handleDuplicate = async (): Promise<void> => {
    if (!rootDir || !figureId) {
      note('Open a project to duplicate this figure')
      return
    }
    try {
      const read = await window.suna.invoke('manuscript:update', { dir: rootDir, patch: {} })
      const manuscript = ManuscriptSchema.parse(read.manuscript)
      const newId = pickAvailableId(figureId, new Set(manuscript.figures.map((f) => f.id)))
      if (!newId) {
        note('Could not find a free id for the duplicate')
        return
      }
      await window.suna.invoke('figure:duplicate', { dir: rootDir, figureId, newId })
      const source = manuscript.figures.find((f) => f.id === figureId)
      const canvasRef = source
        ? source.canvasRef.split(`/${figureId}/`).join(`/${newId}/`)
        : `figures/${newId}/figure.svg`
      const newFigure: ManuscriptFigure = source
        ? { ...source, id: newId, canvasRef }
        : {
            id: newId,
            namespace: 'main',
            canvasRef,
            widthPreset: 'single',
            caption: { title: 'Untitled', body: '' },
            panels: []
          }
      await window.suna.invoke('manuscript:update', {
        dir: rootDir,
        patch: { figures: [...manuscript.figures, newFigure] }
      })
      note(`Duplicated figure → ${newId}`)
    } catch (error) {
      note(`Duplicate failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleAutoLetter = (): void => {
    if (!doc) return
    const ids = findAxesGroupIds(doc.root)
    if (ids.length === 0) {
      note('No axes groups found (ids like ax0, ax1, …)')
      return
    }
    const items = ids
      .map((id) => ({ id, bbox: worldBboxOf(id) }))
      .filter((x): x is { id: string; bbox: WorldRect } => x.bbox !== null)
    if (items.length === 0) {
      note('Could not measure any axes group on the canvas')
      return
    }
    const ordered = orderPanelsForLettering(items)
    const convention = resolvePanelLabelConvention(profile)
    // Placement is clamped to the artboard: a matplotlib axes bbox starts at
    // the very top of the page, so an unclamped letter lands outside the
    // viewport and is clipped away (see panelLabelAnchor).
    const vb = doc.artboard.viewBox
    const bounds: WorldRect | null = vb
      ? { x: vb.minX, y: vb.minY, width: vb.width, height: vb.height }
      : null
    const fig = profile?.figures
    const fontPt = clamp(9, fig?.minFontPt ?? null, fig?.maxFontPt ?? null)
    const userPerPt = mmPerUser !== null && mmPerUser > 0 ? MM_PER_PT / mmPerUser : 1
    const fontSizeUser = fontPt * userPerPt
    const fontFamily = fig?.preferredFontFamilies?.[0] ?? interact.DEFAULT_SHAPE_DEFAULTS.fontFamily

    const commands: CanvasCommand[] = ordered.map((item, i) => {
      const letter = letterFor(i, convention.letterCase)
      const label = formatPanelLabel(letter, convention.wrapper)
      const anchor = panelLabelAnchor(item.bbox, fontSizeUser, bounds)
      const weight = convention.weight === 'bold' ? 'bold' : 'normal'
      const svg =
        `<text x="${interact.formatNumber(anchor.x)}" y="${interact.formatNumber(anchor.y)}" ` +
        `font-family="${interact.escapeXml(fontFamily)}" font-size="${interact.formatNumber(fontSizeUser)}" ` +
        `font-weight="${weight}" fill="#000000" ${PANEL_LETTER_ATTR}="${interact.escapeXml(letter)}">` +
        `${interact.escapeXml(label)}</text>`
      return { kind: 'insert', svg }
    })
    // Replace this feature's own previous letters rather than stacking a
    // second set on top of them, still as ONE undo.
    const stale = findPanelLetterIds(doc.root)
    if (stale.length > 0) commands.unshift({ kind: 'remove', targets: stale })
    apply({ kind: 'batch', commands, label: 'Auto-letter panels' }, 'Auto-letter panels')
    note(`Lettered ${ordered.length} panel${ordered.length === 1 ? '' : 's'}`)
  }

  return (
    <div className="canvas-props__section">
      <div className="canvas-props__title">Figure</div>
      <div className="canvas-props__grid">
        <NumberField
          label="W mm"
          value={widthMm}
          step={1}
          disabled={!doc}
          onCommit={(n) => n > 0 && apply({ kind: 'set-artboard', widthMm: n }, 'Set artboard width')}
        />
        <NumberField
          label="H mm"
          value={heightMm}
          step={1}
          disabled={!doc}
          onCommit={(n) => n > 0 && apply({ kind: 'set-artboard', heightMm: n }, 'Set artboard height')}
        />
      </div>
      {widthMm !== null && heightMm !== null && (
        <div className="canvas-props__mm">
          = {fmt(widthMm)} × {fmt(heightMm)} mm
        </div>
      )}
      <div className="canvas-props__color-row canvas-figure__bg">
        <span className="canvas-props__color-label">Bg</span>
        <input
          type="color"
          className="canvas-props__swatch"
          value={bgHex ?? '#ffffff'}
          disabled={!doc}
          title="Background color"
          onChange={(e) =>
            apply(
              { kind: 'set-style', target: '#root', props: { 'background-color': e.target.value } },
              'Background color'
            )
          }
        />
        <button
          className={`canvas-props__none${bgHex === null ? ' canvas-props__none--active' : ''}`}
          title="Transparent background"
          disabled={!doc}
          onClick={() =>
            apply(
              { kind: 'set-style', target: '#root', props: { 'background-color': null } },
              'Clear background'
            )
          }
        >
          ∅
        </button>
      </div>
      <div className="canvas-figure__actions">
        <button
          className="canvas-figure__action"
          disabled={!rootDir || !figureId}
          onClick={() => void handleDuplicate()}
        >
          Duplicate figure
        </button>
        <button className="canvas-figure__action" disabled={!doc} onClick={handleAutoLetter}>
          Auto-letter panels (a, b, c)
        </button>
      </div>
    </div>
  )
}
