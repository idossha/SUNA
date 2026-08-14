import { useState, type JSX } from 'react'
import type { CanvasDocument } from '@suna/canvas'
import type { PublisherProfile } from '@suna/core'
import type { Diagnostic } from '@suna/formatter'
import { DPI_CHOICES, defaultDpi, widthPresetsFor } from './export-presets'
import { encodeTiff } from './tiff'
import { exportPixelSize, parseRasterExportError } from './units'

/**
 * Export section (canvas parity spec §5–6): SVG/PDF via the main-process
 * channel, PNG/TIFF rasterized here (Image → offscreen canvas → bytes) and
 * written back through 'figure:write-binary'. Journal-spec width/dpi
 * presets come from the active profile, never a hardcoded constant.
 */

interface ExportSectionProps {
  doc: CanvasDocument | null
  rootDir: string | null
  figureId: string | null
  profile: PublisherProfile | null
  diagnostics: Diagnostic[]
  note: (text: string) => void
  /** Ensures figure.svg on disk matches the editor before an export reads it. */
  save: () => Promise<void>
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to rasterize the figure SVG'))
    img.src = url
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

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png')
  })
}

/**
 * `encodeTiff` always allocates a fresh, exactly-sized buffer, so this is a
 * plain `ArrayBuffer` at runtime — but current DOM lib types widen typed
 * arrays to `ArrayBufferLike` (which also covers `SharedArrayBuffer`),
 * which `BlobPart` rejects. Narrow it back for the `Blob` constructor.
 */
function tiffBytesToBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
}

export function ExportSection(props: ExportSectionProps): JSX.Element {
  const { doc, rootDir, figureId, profile, diagnostics, note, save } = props
  const presets = widthPresetsFor(profile)
  const firstPreset = presets[0]
  const [presetKey, setPresetKey] = useState<string>(firstPreset?.key ?? 'single')
  const [dpi, setDpi] = useState<number>(defaultDpi(profile))
  const [transparent, setTransparent] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected = presets.find((p) => p.key === presetKey) ?? firstPreset
  const artboard = doc?.artboard ?? null
  const widthMm = selected?.widthMm ?? null
  const size =
    widthMm !== null && artboard?.widthMm && artboard.heightMm
      ? exportPixelSize(artboard.widthMm, artboard.heightMm, widthMm, dpi)
      : null

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length

  const ready = doc !== null && rootDir !== null && figureId !== null && widthMm !== null

  const runExport = async (
    format: 'svg' | 'pdf' | 'png' | 'tiff',
    fn: (dir: string, id: string, width: number) => Promise<void>
  ): Promise<void> => {
    if (!ready || !rootDir || !figureId || widthMm === null || busy) return
    setBusy(true)
    try {
      await save()
      await fn(rootDir, figureId, widthMm)
    } catch (error) {
      note(`${format.toUpperCase()} export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const exportVector = (format: 'svg' | 'pdf'): Promise<void> =>
    runExport(format, async (dir, id, width) => {
      const res = await window.suna.invoke('figure:export', {
        dir,
        figureId: id,
        format,
        widthMm: width,
        dpi,
        transparent
      })
      note(`Exported ${format.toUpperCase()} → ${res.path}`)
    })

  const exportRaster = (format: 'png' | 'tiff'): Promise<void> =>
    runExport(format, async (dir, id, width) => {
      let parsed: { path: string; widthPx: number; heightPx: number } | null = null
      try {
        await window.suna.invoke('figure:export', { dir, figureId: id, format, widthMm: width, dpi, transparent })
      } catch (error) {
        parsed = parseRasterExportError(error instanceof Error ? error.message : String(error))
      }
      if (!parsed) throw new Error('could not resolve the export path')
      const { path, widthPx, heightPx } = parsed

      const svgText = doc?.serialize() ?? ''
      const blob = new Blob([svgText], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      try {
        const img = await loadImage(url)
        const canvas = document.createElement('canvas')
        canvas.width = widthPx
        canvas.height = heightPx
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d canvas context unavailable')
        if (!transparent) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, widthPx, heightPx)
        }
        ctx.drawImage(img, 0, 0, widthPx, heightPx)

        let base64: string
        if (format === 'png') {
          base64 = await blobToBase64(await canvasToPngBlob(canvas))
        } else {
          const imageData = ctx.getImageData(0, 0, widthPx, heightPx)
          const tiffBytes = encodeTiff(imageData.data, widthPx, heightPx, { dpi })
          base64 = await blobToBase64(tiffBytesToBlob(tiffBytes))
        }
        await window.suna.invoke('figure:write-binary', { path, base64 })
        note(`Exported ${format.toUpperCase()} → ${path} (${widthPx}×${heightPx})`)
      } finally {
        URL.revokeObjectURL(url)
      }
    })

  return (
    <div className="canvas-props__section">
      <div className="canvas-props__title">Export</div>
      <div className="canvas-export__row">
        <button className="canvas-figure__action" disabled={!ready || busy} onClick={() => void exportVector('svg')}>
          SVG
        </button>
        <button className="canvas-figure__action" disabled={!ready || busy} onClick={() => void exportVector('pdf')}>
          PDF
        </button>
      </div>

      <div className="canvas-props__title canvas-export__subtitle">Journal-spec raster</div>
      <label className="canvas-props__field canvas-props__field--wide">
        <span>Width</span>
        <select value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="canvas-props__field canvas-props__field--wide">
        <span>Resolution</span>
        <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
          {DPI_CHOICES.map((d) => (
            <option key={d} value={d}>
              {d} dpi
            </option>
          ))}
        </select>
      </label>
      <label className="canvas-export__transparent">
        <input
          type="checkbox"
          checked={transparent}
          onChange={(e) => setTransparent(e.target.checked)}
        />
        Transparent background
      </label>
      {size && widthMm !== null && (
        <div className="canvas-props__mm">
          {fmtMm(widthMm)} × {fmtMm(size.heightMm)} mm @ {dpi} dpi · {size.widthPx}×{size.heightPx} px
        </div>
      )}
      {errorCount > 0 && (
        <div className="canvas-export__warning">
          {errorCount} {errorCount === 1 ? 'issue' : 'issues'} — export anyway?
        </div>
      )}
      <div className="canvas-export__row">
        <button className="canvas-figure__action" disabled={!ready || busy} onClick={() => void exportRaster('png')}>
          PNG
        </button>
        <button className="canvas-figure__action" disabled={!ready || busy} onClick={() => void exportRaster('tiff')}>
          TIFF
        </button>
      </div>
    </div>
  )
}

function fmtMm(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}
