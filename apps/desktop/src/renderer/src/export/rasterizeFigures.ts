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
 *
 * With `{ compress: true }` the same pass produces the *compressed* variant
 * a PDF / web-page export embeds when the full-resolution figures make the
 * file unreasonably large: the raster is taken at COMPRESSED_DPI instead of
 * the profile's minimum and encoded as JPEG, written as a sibling
 * `<id>-compressed.jpg` so the real PNG export stays untouched. Screen and
 * review copies survive this easily; the submission copy should not use it
 * (a journal's stated minimum dpi is a compliance rule), which is why only
 * the PDF and web-page exports offer it and the DOCX one does not.
 */

/** Resolution of the compressed pass — well above screen, well below print. */
export const COMPRESSED_DPI = 150
/** JPEG quality of the compressed pass: no visible artefacts on line plots. */
export const COMPRESSED_JPEG_QUALITY = 0.72

export interface RasterizeOptions {
  /** Re-encode at COMPRESSED_DPI as JPEG rather than at the profile dpi as PNG. */
  compress?: boolean
  /**
   * Skip the encode when this figure's SVG has not changed since the last
   * pass at the same width/dpi/encoding. Only the live preview sets this:
   * it re-rasterizes on every styling change, and re-encoding an unchanged
   * figure is the slowest thing in that loop by an order of magnitude. A
   * real export never takes the cache — it always writes the bytes it is
   * about to embed.
   */
  cache?: boolean
  /**
   * PROJECT-ROOT-RELATIVE prefix an archived version's figure SVGs live
   * under (`manuscript/archive/<versionId>`): a versioned export must
   * rasterize the figure as it was LOGGED, not as it is now. A figure the
   * archive does not hold (the version was logged without a figures area,
   * or before that figure existed) falls back to the live path — same
   * fallback main's own export takes for the archived prose.
   */
  svgBase?: string
}

/** `<figureId>|<widthMm>|<dpi>|<png|jpg>` -> the SVG it was rasterized from, and where it landed. */
const rasterCache = new Map<string, { svg: string; path: string }>()

/** Drops every cached raster — a project switch invalidates all of them at once. */
export function clearRasterCache(): void {
  rasterCache.clear()
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to rasterize a figure SVG'))
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), type, quality)
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

async function rasterizeOne(
  rootDir: string,
  figureId: string,
  canvasRef: string,
  widthMm: number,
  dpi: number,
  compress: boolean,
  cache: boolean,
  svgBase?: string
): Promise<string> {
  const cacheKey = `${figureId}|${widthMm}|${dpi}|${compress ? 'jpg' : 'png'}|${svgBase ?? ''}`
  // The SVG is the figure's whole truth, so its text IS the cache stamp —
  // read first (one cheap IPC), and on a hit nothing else in this function
  // needs to run at all. A versioned export reads the ARCHIVED SVG when the
  // archive holds one, and the live SVG otherwise.
  let svgText: string
  if (svgBase !== undefined) {
    try {
      svgText = (
        await window.suna.invoke('fs:read-text', { path: `${rootDir}/${svgBase}/${canvasRef}` })
      ).content
    } catch {
      svgText = (await window.suna.invoke('fs:read-text', { path: `${rootDir}/${canvasRef}` })).content
    }
  } else {
    svgText = (await window.suna.invoke('fs:read-text', { path: `${rootDir}/${canvasRef}` })).content
  }
  if (cache) {
    const hit = rasterCache.get(cacheKey)
    if (hit !== undefined && hit.svg === svgText) return hit.path
  }

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
  const { widthPx, heightPx } = parsed
  // The compressed pass must not overwrite the figure's real PNG export —
  // it writes a sibling JPEG that only the compressed document embeds.
  const path = compress ? parsed.path.replace(/\.png$/i, '-compressed.jpg') : parsed.path

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
    const encoded = compress
      ? await canvasToBlob(canvas, 'image/jpeg', COMPRESSED_JPEG_QUALITY)
      : await canvasToBlob(canvas, 'image/png')
    const base64 = await blobToBase64(encoded)
    await window.suna.invoke('figure:write-binary', { path, base64 })
    if (cache) rasterCache.set(cacheKey, { svg: svgText, path })
    return path
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function rasterizeManuscriptFigures(
  rootDir: string,
  manuscript: Manuscript,
  profile: PublisherProfile,
  options: RasterizeOptions = {}
): Promise<Record<string, string>> {
  const compress = options.compress ?? false
  const cache = options.cache ?? false
  const presets = widthPresetsFor(profile)
  const dpi = compress ? Math.min(defaultDpi(profile), COMPRESSED_DPI) : defaultDpi(profile)
  const out: Record<string, string> = {}
  for (const figure of manuscript.figures) {
    const widthMm = presets.find((p) => p.key === figure.widthPreset)?.widthMm ?? presets[0]?.widthMm ?? 89
    out[figure.id] = await rasterizeOne(
      rootDir,
      figure.id,
      figure.canvasRef,
      widthMm,
      dpi,
      compress,
      cache,
      options.svgBase
    )
  }
  return out
}
