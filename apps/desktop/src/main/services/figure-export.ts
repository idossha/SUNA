import { BrowserWindow, app } from 'electron'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic'
import { exportPixelSize, parseSvgAspect } from './figure-geometry'
import { figureDirPath, projectSubdir } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * Figure export into the project's output/ dir.
 * - 'svg' is a byte-identical copy of the source.
 * - 'pdf' is vector: a hidden window sized to the artboard in mm → printToPDF.
 * - 'png'/'tiff' are rasterized in the RENDERER (Image → canvas at the exact
 *   pixel size) and written back through the 'figure:write-binary' channel,
 *   because the main process has no canvas.
 */

export interface FigureExportRequest {
  dir: string
  figureId: string
  format: 'svg' | 'png' | 'pdf' | 'tiff'
  widthMm: number
  dpi: number
  transparent: boolean
}

export interface FigureExportResult {
  path: string
  widthPx: number
  heightPx: number
}

/** Path the renderer should hand to 'figure:write-binary' for raster formats. */
export async function figureExportPath(
  dir: string,
  figureId: string,
  format: FigureExportRequest['format']
): Promise<string> {
  const outputDir = await projectSubdir(assertInsideAllowedRoot(dir), 'output')
  return join(outputDir, `${figureId}.${format}`)
}

function stripXmlPrologue(svg: string): string {
  return svg
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/i, '')
    .replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .trimStart()
}

function pdfHostDocument(svg: string, widthMm: number, heightMm: number, transparent: boolean): string {
  const background = transparent ? 'transparent' : '#ffffff'
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0 }
  html, body { margin: 0; padding: 0; background: ${background} }
  svg { display: block; width: ${widthMm}mm; height: ${heightMm}mm }
</style></head><body>
${stripXmlPrologue(svg)}
</body></html>
`
}

async function exportPdf(
  svg: string,
  target: string,
  widthMm: number,
  heightMm: number,
  transparent: boolean
): Promise<void> {
  const hostPath = join(app.getPath('temp'), `suna-figure-${process.pid}-${Date.now()}.html`)
  await writeFileAtomic(hostPath, pdfHostDocument(svg, widthMm, heightMm, transparent))
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  try {
    await win.loadFile(hostPath)
    const pdf = await win.webContents.printToPDF({
      // printToPDF takes page dimensions in microns.
      pageSize: { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: !transparent,
      preferCSSPageSize: true
    })
    await writeFileAtomic(target, pdf)
  } finally {
    win.destroy()
    await unlink(hostPath).catch(() => undefined)
  }
}

export async function exportFigure(request: FigureExportRequest): Promise<FigureExportResult> {
  const { dir, figureId, format, widthMm, dpi, transparent } = request
  const root = assertInsideAllowedRoot(dir)
  const svgPath = join(await figureDirPath(root, figureId), 'figure.svg')
  const bytes = await readFile(assertInsideAllowedRoot(svgPath))
  const svg = bytes.toString('utf8')

  const aspect = parseSvgAspect(svg)
  if (aspect === null) {
    throw new Error(`figure.svg declares no viewBox or size: ${svgPath}`)
  }
  const size = exportPixelSize(aspect, widthMm, dpi)
  const { widthPx, heightPx } = size
  // Keep the CSS page box and the printToPDF page size on the same rounded mm.
  const heightMm = Number(size.heightMm.toFixed(4))
  const target = await figureExportPath(root, figureId, format)

  if (format === 'svg') {
    // Byte-identical copy of the source of truth.
    await writeFileAtomic(target, bytes)
  } else if (format === 'pdf') {
    await exportPdf(svg, target, widthMm, heightMm, transparent)
  } else {
    throw new Error(
      `${format.toUpperCase()} is rasterized in the renderer: draw the SVG at ${widthPx}×${heightPx} px and send the bytes to 'figure:write-binary' (${target})`
    )
  }

  return { path: target, widthPx, heightPx }
}
