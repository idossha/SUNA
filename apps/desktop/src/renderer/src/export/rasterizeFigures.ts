import type { Manuscript, PublisherProfile } from '@suna/core'
import { defaultDpi, widthPresetsFor } from '../canvas/export-presets'
import { parseRasterExportError } from '../canvas/units'

/**
 * Rasterizes every manuscript figure to a PNG at the active profile's width
 * preset / minimum dpi, exactly the way the canvas's own PNG export does
 * (ExportSection.tsx, palette-export.ts): 'figure:export' throws by design
 * for 'png' (main has no canvas), naming the exact output path/pixel size;
 * the SVG is read from figures/<id>/figure.svg on disk (not a live editor
 * doc — the exported figure may not even be open), drawn to an offscreen
 * canvas, and the bytes handed to 'figure:write-binary'.
 *
 * Returns figureId -> absolute PNG path, the exact shape 'export:docx' and
 * 'export:pdf' require for `figurePngPaths`.
 */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to rasterize a figure SVG'))
    img.src = url
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png')
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('unexpected FileReader result'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

async function rasterizeOne(rootDir: string, figureId: string, canvasRef: string, widthMm: number, dpi: number): Promise<string> {
  let parsed: { path: string; widthPx: number; heightPx: number } | null = null
  try {
    await window.suna.invoke('figure:export', {
      dir: rootDir,
      figureId,
      format: 'png',
      widthMm,
      dpi,
      transparent: false
    })
  } catch (error) {
    parsed = parseRasterExportError(error instanceof Error ? error.message : String(error))
  }
  if (!parsed) throw new Error(`could not resolve the PNG export path for figure "${figureId}"`)
  const { path, widthPx, heightPx } = parsed

  const { content: svgText } = await window.suna.invoke('fs:read-text', { path: `${rootDir}/${canvasRef}` })
  const blob = new Blob([svgText], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, widthPx, heightPx)
    ctx.drawImage(img, 0, 0, widthPx, heightPx)
    const base64 = await blobToBase64(await canvasToPngBlob(canvas))
    await window.suna.invoke('figure:write-binary', { path, base64 })
    return path
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function rasterizeManuscriptFigures(
  rootDir: string,
  manuscript: Manuscript,
  profile: PublisherProfile
): Promise<Record<string, string>> {
  const presets = widthPresetsFor(profile)
  const dpi = defaultDpi(profile)
  const out: Record<string, string> = {}
  for (const figure of manuscript.figures) {
    const widthMm = presets.find((p) => p.key === figure.widthPreset)?.widthMm ?? presets[0]?.widthMm ?? 89
    out[figure.id] = await rasterizeOne(rootDir, figure.id, figure.canvasRef, widthMm, dpi)
  }
  return out
}
