import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { AnnotationMode, GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import { base64ToUint8Array } from '../viewer/binary'
import { clampZoom, zoomIn, zoomOut } from '../viewer/zoom'
import { PAGE_GAP, fitScaleFor, zoomPercentOf, type PageFit } from './pageFit'
import './PagedDocument.css'

/**
 * The one component in the app that turns exported PDF bytes into pages on
 * screen (feature-plan-13 §B2).
 *
 * Two surfaces want this: the export dialog's live preview, and the editors'
 * read-only Pages mode. Neither draws a page of its own — both hand over
 * bytes that came out of the real exporter — so if there were two of these
 * they would drift, and the drift would be invisible until someone compared
 * a preview against a printed file. There is one, and both mount it.
 *
 * It owns everything page-shaped: the pdf.js document lifecycle, fit-to-width
 * against the live container, the zoom control, and the canvas per page. It
 * owns nothing about WHERE the bytes came from — no IPC, no debounce, no
 * format switch. That is each consumer's business, and it is the part that
 * legitimately differs between them.
 *
 * The previous document stays on screen, dimmed, while the next render is in
 * flight (`rendering`), so changing an option or typing a word does not blank
 * the page.
 */

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

interface LoadedDoc {
  doc: PDFDocumentProxy
  pages: PDFPageProxy[]
  /** Each page's size at scale 1 — every layout number derives from these. */
  sizes: { width: number; height: number }[]
}

/** One page, drawn at the current scale and redrawn when it changes. */
function PageCanvas({ page, scale }: { page: PDFPageProxy; scale: number }): JSX.Element {
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
      // This draws the printed page, and a printed page has no widgets.
      annotationMode: AnnotationMode.DISABLE
    })
    // A cancelled render is the normal outcome of a zoom or a new document —
    // never an error worth surfacing.
    void task.promise.catch(() => undefined)
    return () => task.cancel()
  }, [page, scale])

  return <canvas ref={canvasRef} className="paged-doc__page" />
}

export function PagedDocument({
  data,
  rendering,
  error,
  status,
  emptyLabel = 'Rendering the first page…',
  banner,
  fit = 'width',
  onPageCount
}: {
  /** Base64 PDF bytes, or null before the first render has landed. */
  data: string | null
  /** A render is in flight: the pages on screen are the previous ones. */
  rendering: boolean
  error: string | null
  /** The left side of the toolbar — each consumer words its own state. */
  status: ReactNode
  emptyLabel?: string
  /** Anything to show between the toolbar and the pages (notes, warnings). */
  banner?: ReactNode
  /**
   * What "100% of the panel" means before the user touches the zoom.
   *
   * 'width' fills the column, which is right for a preview you are reading.
   * 'page' fits the WHOLE page, which is right for a page view: the entire
   * point of pages mode is seeing where the page ends, and a view that cannot
   * show a page end is not showing pagination at all.
   */
  fit?: PageFit
  /** Reports the page count back, for consumers that show it in their own chrome. */
  onPageCount?: (count: number | null) => void
}): JSX.Element {
  const [loaded, setLoaded] = useState<LoadedDoc | null>(null)
  /** null = follow the container width; a number = the user took the wheel. */
  const [zoom, setZoom] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** Every load carries a generation; only the newest one may set state. */
  const genRef = useRef(0)
  /** The loading task, not the document: `destroy()` lives on the task (as PdfTab.tsx does it). */
  const taskRef = useRef<ReturnType<typeof getDocument> | null>(null)

  // Track the scroll area's width so "fit width" tracks a resized panel.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setContainerWidth(entry.contentRect.width)
      setContainerHeight(entry.contentRect.height)
    })
    observer.observe(el)
    setContainerWidth(el.clientWidth)
    setContainerHeight(el.clientHeight)
    return () => observer.disconnect()
  }, [])

  const load = useCallback(async (base64: string): Promise<void> => {
    const gen = genRef.current + 1
    genRef.current = gen
    const task = getDocument({ data: base64ToUint8Array(base64) })
    try {
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
      // Replace the old document only once the new one is ready — the pages
      // on screen never blink out mid-render.
      const previous = taskRef.current
      taskRef.current = task
      setLoaded({ doc, pages, sizes })
      void previous?.destroy().catch(() => undefined)
    } catch {
      // A document that will not parse is the consumer's error to report; it
      // already owns the error slot, and the previous pages stay put.
      void task.destroy().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (data === null) return
    void load(data)
  }, [data, load])

  // Tear the last document down when the panel goes away.
  useEffect(
    () => () => {
      genRef.current += 1
      void taskRef.current?.destroy().catch(() => undefined)
      taskRef.current = null
    },
    []
  )

  const pageCount = loaded?.doc.numPages ?? null
  useEffect(() => {
    onPageCount?.(pageCount)
  }, [pageCount, onPageCount])

  const naturalWidth = loaded?.sizes[0]?.width ?? 0
  const naturalHeight = loaded?.sizes[0]?.height ?? 0
  const fitScale = useMemo(
    () =>
      fitScaleFor({
        fit,
        containerWidth,
        containerHeight,
        pageWidth: naturalWidth,
        pageHeight: naturalHeight
      }),
    [fit, containerWidth, containerHeight, naturalWidth, naturalHeight]
  )
  const scale = zoom ?? fitScale
  // pdf.js measures a page in POINTS at scale 1 (612 x 792 for US Letter),
  // but every PDF reader calls 96 dpi "100%". Render in pdf.js's units and
  // report the number the user expects to see.
  const zoomPercent = zoomPercentOf(scale)

  return (
    <div className="paged-doc">
      <div className="paged-doc__bar">
        <span className="paged-doc__status">
          {status}
          {pageCount !== null && !rendering && error === null && (
            <span className="paged-doc__count">
              {pageCount} page{pageCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
        {loaded !== null && (
          <span className="paged-doc__zoom">
            <button type="button" onClick={() => setZoom(zoomOut(scale))} aria-label="Zoom out">
              −
            </button>
            <button type="button" className="paged-doc__zoom-value" onClick={() => setZoom(null)}>
              {zoomPercent}%
            </button>
            <button type="button" onClick={() => setZoom(zoomIn(scale))} aria-label="Zoom in">
              +
            </button>
          </span>
        )}
      </div>

      {banner}

      <div ref={scrollRef} className="paged-doc__scroll">
        {error !== null ? (
          <p className="paged-doc__error">{error}</p>
        ) : loaded !== null ? (
          <div
            className={`paged-doc__pages${rendering ? ' paged-doc__pages--stale' : ''}`}
            style={{ gap: `${PAGE_GAP}px`, padding: `${PAGE_GAP}px` }}
          >
            {loaded.pages.map((page, i) => (
              <PageCanvas key={i} page={page} scale={clampZoom(scale)} />
            ))}
          </div>
        ) : (
          <p className="paged-doc__empty">{emptyLabel}</p>
        )}
      </div>
    </div>
  )
}
