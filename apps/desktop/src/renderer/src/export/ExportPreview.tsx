import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnnotationMode, GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import type { Manuscript, PublisherProfile } from '@suna/core'
import { base64ToUint8Array } from '../viewer/binary'
import { clampZoom, fitWidthScale, zoomIn, zoomOut } from '../viewer/zoom'
import { rasterizeManuscriptFigures } from './rasterizeFigures'

/**
 * The export page's live preview: what the file will look like, before it
 * exists.
 *
 * It renders nothing of its own. Every pixel here comes from the
 * 'export:preview' channel, which runs the SAME builders 'export:pdf' and
 * 'export:html' run and hands the bytes back instead of writing them — so
 * this panel cannot show a layout the export would not produce. A Word
 * export previews as its own page geometry rendered to PDF (both writers
 * share export-style.ts); the caption says so, because Word breaks lines
 * itself and a page count near a boundary can move by one.
 *
 * Speed comes from three places, none of them a shortcut in fidelity:
 *  - figures rasterize at preview resolution and are cached by their SVG
 *    text, so an unchanged figure is never re-encoded (rasterizeFigures.ts);
 *  - main reuses one hidden window for the print pass (export-preview.ts);
 *  - renders are debounced, and a stale one is dropped by generation rather
 *    than cancelled — the last request always wins.
 * The previous page stays on screen while the next render is in flight, so
 * toggling an option dims the page instead of blanking it.
 */

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

/** How long a styling change waits before it costs a render. */
const DEBOUNCE_MS = 250
/** Gap between page tiles, matching the PDF viewer's own. */
const PAGE_GAP = 16
/** 1 PDF point at 96 dpi — the factor between pdf.js's scale and a reader's "100%". */
const CSS_PX_PER_PT = 96 / 72
/** How far "fit width" may enlarge a page in a very wide panel. */
const MAX_FIT_SCALE = CSS_PX_PER_PT * 1.5

interface PreviewDoc {
  doc: PDFDocumentProxy
  pages: PDFPageProxy[]
  /** Each page's size at scale 1 — every layout number derives from these. */
  sizes: { width: number; height: number }[]
}

/** One page, drawn at the current scale and redrawn when it changes. */
function PreviewPage({ page, scale }: { page: PDFPageProxy; scale: number }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const viewport = page.getViewport({ scale })
    const outputScale = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    const task = page.render({
      canvas,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      // The preview draws the printed page, and a printed page has no widgets.
      annotationMode: AnnotationMode.DISABLE
    })
    // A cancelled render is the normal outcome of a zoom or a new document —
    // never an error worth surfacing.
    void task.promise.catch(() => undefined)
    return () => task.cancel()
  }, [page, scale])

  return <canvas ref={canvasRef} className="export-preview__page" />
}

export function ExportPreview({
  rootDir,
  manuscript,
  profile,
  profileId,
  format,
  target,
  doubleSpacing,
  lineNumbers,
  pageNumbers,
  theme
}: {
  rootDir: string
  manuscript: Manuscript
  profile: PublisherProfile
  profileId: string
  format: 'docx' | 'pdf' | 'html'
  target: 'manuscript' | 'supplement'
  // The submission options arrive as primitives, not as one options object:
  // a fresh object literal from the parent would change identity on every
  // render and re-trigger the render effect forever.
  doubleSpacing: boolean
  lineNumbers: boolean
  pageNumbers: boolean
  theme?: string
}): JSX.Element {
  const [pdf, setPdf] = useState<PreviewDoc | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [approximate, setApproximate] = useState(false)
  const [ms, setMs] = useState<number | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** null = follow the container width; a number = the user took the wheel. */
  const [zoom, setZoom] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** Every render carries a generation; only the newest one may set state. */
  const genRef = useRef(0)
  /** The loading task, not the document: `destroy()` lives on the task (as PdfTab.tsx does it). */
  const taskRef = useRef<ReturnType<typeof getDocument> | null>(null)

  // Track the scroll area's width so "fit width" tracks a resized panel.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(el)
    setContainerWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  const naturalWidth = pdf?.sizes[0]?.width ?? 0
  // Fit the page into the column, leaving the tile's own margin. Capped so a
  // very wide panel shows a page, not a billboard.
  const fitScale = useMemo(
    () => Math.min(MAX_FIT_SCALE, fitWidthScale(Math.max(0, containerWidth - PAGE_GAP * 2), naturalWidth)),
    [containerWidth, naturalWidth]
  )
  const scale = zoom ?? fitScale
  // pdf.js measures a page in POINTS at scale 1 (612 x 792 for US Letter),
  // but every PDF reader calls 96 dpi "100%". Render in pdf.js's units and
  // report the number the user expects to see.
  const zoomPercent = Math.round((scale / CSS_PX_PER_PT) * 100)

  const run = useCallback(async (): Promise<void> => {
    const gen = genRef.current + 1
    genRef.current = gen
    setRendering(true)
    setError(null)
    try {
      // Preview resolution, cached by figure SVG: the submission-resolution
      // rasters are the real export's business, not a preview's.
      const figurePngPaths = await rasterizeManuscriptFigures(rootDir, manuscript, profile, {
        compress: true,
        cache: true
      })
      const res = await window.suna.invoke('export:preview', {
        dir: rootDir,
        profileId,
        format,
        figurePngPaths,
        options: { doubleSpacing, lineNumbers, pageNumbers, theme },
        target
      })
      if (gen !== genRef.current) return
      setApproximate(res.approximate)
      setMs(res.ms)
      if (res.kind === 'html') {
        setHtml(res.data)
        setPdf(null)
        void taskRef.current?.destroy().catch(() => undefined)
        taskRef.current = null
      } else {
        const task = getDocument({ data: base64ToUint8Array(res.data) })
        const doc = await task.promise
        const pages =
          gen === genRef.current
            ? await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
            : null
        if (pages === null || gen !== genRef.current) {
          void task.destroy().catch(() => undefined)
          return
        }
        const sizes = pages.map((p) => {
          const v = p.getViewport({ scale: 1 })
          return { width: v.width, height: v.height }
        })
        // Replace the old document only once the new one is ready — the
        // page on screen never blinks out mid-render.
        const previous = taskRef.current
        taskRef.current = task
        setPdf({ doc, pages, sizes })
        setHtml(null)
        void previous?.destroy().catch(() => undefined)
      }
    } catch (err) {
      if (gen !== genRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (gen === genRef.current) setRendering(false)
    }
  }, [rootDir, manuscript, profile, profileId, format, target, doubleSpacing, lineNumbers, pageNumbers, theme])

  // Debounced: a burst of checkbox clicks costs one render, not five.
  useEffect(() => {
    const timer = setTimeout(() => {
      void run()
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [run])

  // Tear the last document down when the panel goes away.
  useEffect(
    () => () => {
      genRef.current += 1
      void taskRef.current?.destroy().catch(() => undefined)
      taskRef.current = null
    },
    []
  )

  const pageCount = pdf?.doc.numPages ?? null

  return (
    <div className="export-preview">
      <div className="export-preview__bar">
        <span className="export-preview__status">
          {error !== null ? 'Preview failed' : rendering ? 'Rendering…' : 'Preview'}
          {pageCount !== null && !rendering && error === null && (
            <span className="export-preview__count">
              {pageCount} page{pageCount === 1 ? '' : 's'}
            </span>
          )}
          {ms !== null && !rendering && error === null && (
            <span className="export-preview__ms">{ms} ms</span>
          )}
        </span>
        {pdf !== null && (
          <span className="export-preview__zoom">
            <button type="button" onClick={() => setZoom(zoomOut(scale))} aria-label="Zoom out">
              −
            </button>
            <button type="button" className="export-preview__zoom-value" onClick={() => setZoom(null)}>
              {zoomPercent}%
            </button>
            <button type="button" onClick={() => setZoom(zoomIn(scale))} aria-label="Zoom in">
              +
            </button>
          </span>
        )}
      </div>

      {approximate && (
        <p className="export-preview__note">
          Word cannot be rendered directly. This is the same page geometry and typography the .docx
          carries — page size, margins, point sizes, spacing — printed as pages. Word breaks lines
          itself, so a page count near a boundary can differ by one.
        </p>
      )}

      <div ref={scrollRef} className="export-preview__scroll">
        {error !== null ? (
          <p className="export-preview__error">{error}</p>
        ) : html !== null ? (
          <iframe className="export-preview__frame" title="Web page preview" srcDoc={html} sandbox="" />
        ) : pdf !== null ? (
          <div
            className={`export-preview__pages${rendering ? ' export-preview__pages--stale' : ''}`}
            style={{ gap: `${PAGE_GAP}px`, padding: `${PAGE_GAP}px` }}
          >
            {pdf.pages.map((page, i) => (
              <PreviewPage key={i} page={page} scale={clampZoom(scale)} />
            ))}
          </div>
        ) : (
          <p className="export-preview__empty">Rendering the first preview…</p>
        )}
      </div>
    </div>
  )
}
