/**
 * Minimal PNG/PDF export for the command palette's "Export Figure as PNG/PDF"
 * commands, driven by whatever CanvasTab registered itself as visible
 * (canvas/palette-actions.ts). Deliberately narrower than ExportSection.tsx —
 * no dpi/width picker, no transparency toggle, no TIFF/SVG — this is the
 * "just export it with the journal's defaults" fast path; ExportSection
 * remains the full control surface for anyone who wants those knobs. PDF
 * goes straight through 'figure:export' (main rasterizes nothing); PNG needs
 * the same renderer-side rasterize-then-write-back round trip ExportSection
 * uses, so those few DOM/canvas lines are duplicated here rather than
 * exported from a component file.
 */
import { defaultDpi, widthPresetsFor } from './export-presets'
import { exportPixelSize, parseRasterExportError } from './units'
import type { CanvasPaletteContext } from './palette-actions'

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to rasterize the figure SVG'))
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

/** The active profile's first width preset (matches ExportSection's own initial default). */
function defaultWidthMm(ctx: CanvasPaletteContext): number {
  return widthPresetsFor(ctx.profile)[0]?.widthMm ?? 89
}

/** Export the active figure to PDF at the profile's default width/dpi. Returns the written path. */
export async function exportActiveFigurePdf(ctx: CanvasPaletteContext): Promise<string> {
  await ctx.save()
  const widthMm = defaultWidthMm(ctx)
  const dpi = defaultDpi(ctx.profile)
  const res = await window.suna.invoke('figure:export', {
    dir: ctx.rootDir,
    figureId: ctx.figureId,
    format: 'pdf',
    widthMm,
    dpi,
    transparent: false
  })
  return res.path
}

/** Export the active figure to PNG at the profile's default width/dpi. Returns the written path. */
export async function exportActiveFigurePng(ctx: CanvasPaletteContext): Promise<string> {
  await ctx.save()
  const widthMm = defaultWidthMm(ctx)
  const dpi = defaultDpi(ctx.profile)

  let parsed: { path: string; widthPx: number; heightPx: number } | null = null
  try {
    // 'figure:export' throws by design for 'png' (main has no canvas to
    // rasterize with); the message names the exact output path/size.
    await window.suna.invoke('figure:export', {
      dir: ctx.rootDir,
      figureId: ctx.figureId,
      format: 'png',
      widthMm,
      dpi,
      transparent: false
    })
  } catch (error) {
    parsed = parseRasterExportError(error instanceof Error ? error.message : String(error))
  }
  if (!parsed) {
    const artboard = ctx.doc.artboard
    if (!artboard.widthMm || !artboard.heightMm) throw new Error('figure has no artboard size')
    throw new Error('could not resolve the PNG export path')
  }
  const { path, widthPx, heightPx } = parsed

  const svgText = ctx.doc.serialize()
  const blob = new Blob([svgText], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const canvasCtx = canvas.getContext('2d')
    if (!canvasCtx) throw new Error('2d canvas context unavailable')
    canvasCtx.fillStyle = '#ffffff'
    canvasCtx.fillRect(0, 0, widthPx, heightPx)
    canvasCtx.drawImage(img, 0, 0, widthPx, heightPx)
    const base64 = await blobToBase64(await canvasToPngBlob(canvas))
    await window.suna.invoke('figure:write-binary', { path, base64 })
    return path
  } finally {
    URL.revokeObjectURL(url)
  }
}
