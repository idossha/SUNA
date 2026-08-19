import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  AbortException,
  GlobalWorkerOptions,
  RenderingCancelledException,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy
} from 'pdfjs-dist'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { base64ToUint8Array } from './binary'
import { currentPageIndex, layoutPages, type PageBox } from './pdf-layout'
import { clampZoom, fitWidthScale, zoomIn, zoomOut } from './zoom'
import './viewer.css'

// electron-vite/Vite resolves this bare specifier through the same node
// resolution it uses for static imports and emits it as a built worker
// asset (this is pdf.js's own documented Vite integration pattern — see
// feature-plan-4 §0/§2). If that ever proves brittle in a real build, the
// fallback is a `?url` asset import of the same file, or
// `disableWorker: true` on getDocument; neither was needed here.
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

const PAGE_GAP = 12
/** IntersectionObserver rootMargin: render pages within ~one screen's reach
 *  of the viewport, in each direction (feature-plan-4 §2's "±1 page" — a
 *  fixed px margin rather than a literal page count, since page height
 *  varies with zoom; see PdfTab report notes). */
const RENDER_MARGIN_PX = 800

interface LoadedDoc {
  doc: PDFDocumentProxy
  pages: PDFPageProxy[]
  /** Each page's viewport at scale 1 — the basis for every other size. */
  naturalSizes: { width: number; height: number }[]
}

/** One lazily-rendered page: canvas + selectable text layer, both cancelled on scale change/unmount. */
function PdfPageCanvas({ page, scale }: { page: PDFPageProxy; scale: number }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setRenderError(null)

    const viewport = page.getViewport({ scale })
    const outputScale = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`

    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
    const renderTask = page.render({ canvas, viewport, transform })
    renderTask.promise.catch((error: unknown) => {
      if (error instanceof RenderingCancelledException) return
      setRenderError(error instanceof Error ? error.message : String(error))
    })

    const textLayerEl = textLayerRef.current
    let textLayer: TextLayer | null = null
    if (textLayerEl) {
      textLayerEl.replaceChildren()
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerEl,
        viewport
      })
      // Selection is best-effort: a text-layer failure never takes the page render down with it.
      textLayer.render().catch((error: unknown) => {
        if (error instanceof AbortException) return
      })
    }

    return () => {
      renderTask.cancel()
      textLayer?.cancel()
    }
  }, [page, scale])

  return (
    <>
      <canvas ref={canvasRef} className="pdfview__canvas" />
      <div ref={textLayerRef} className="pdfview__textlayer" />
      {renderError !== null && <div className="pdfview__page-error">Could not render page: {renderError}</div>}
    </>
  )
}

/** PDF viewer (feature-plan-4 §2): continuous vertical scroll, lazy per-page
 *  canvas rendering, a selectable text layer, and fit-width/zoom controls. */
export function PdfTab({ params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path

  const [loaded, setLoaded] = useState<LoadedDoc | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scaleMode, setScaleMode] = useState<'fit-width' | 'manual'>('fit-width')
  const [manualScale, setManualScale] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [renderSet, setRenderSet] = useState<ReadonlySet<number>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)

  const scrollRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const pageElsRef = useRef(new Map<number, HTMLDivElement>())
  const refCallbacksRef = useRef(new Map<number, (el: HTMLDivElement | null) => void>())
  const rafRef = useRef<number | null>(null)

  const numPages = loaded?.pages.length ?? 0
  const firstPageWidth = loaded?.naturalSizes[0]?.width ?? 0
  const effectiveScale =
    scaleMode === 'fit-width' ? fitWidthScale(containerWidth - 48, firstPageWidth) : clampZoom(manualScale)

  const pageBoxes: PageBox[] = useMemo(
    () => (loaded ? layoutPages(loaded.naturalSizes.map((s) => s.height * effectiveScale), PAGE_GAP) : []),
    [loaded, effectiveScale]
  )

  // ---- load the document -----------------------------------------------
  useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<typeof getDocument> | null = null

    setLoaded(null)
    setLoadError(null)
    setRenderSet(new Set())
    setCurrentPage(1)
    setScaleMode('fit-width')
    setManualScale(1)

    void (async () => {
      try {
        const { base64 } = await window.suna.invoke('fs:read-binary', { path })
        if (cancelled) return
        loadingTask = getDocument({ data: base64ToUint8Array(base64) })
        const doc = await loadingTask.promise
        if (cancelled) {
          void loadingTask.destroy().catch(() => {})
          return
        }
        const pageNumbers = Array.from({ length: doc.numPages }, (_, i) => i + 1)
        const pages = await Promise.all(pageNumbers.map((n) => doc.getPage(n)))
        if (cancelled) return
        const naturalSizes = pages.map((p) => {
          const vp = p.getViewport({ scale: 1 })
          return { width: vp.width, height: vp.height }
        })
        setLoaded({ doc, pages, naturalSizes })
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      cancelled = true
      if (loadingTask) void loadingTask.destroy().catch(() => {})
    }
  }, [path])

  // ---- measure the scroll container's width for fit-width --------------
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) setContainerWidth(width)
    })
    observer.observe(el)
    setContainerWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  // ---- lazy render window: IntersectionObserver over the page wrappers -
  useEffect(() => {
    const root = scrollRef.current
    if (!root || numPages === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        setRenderSet((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const entry of entries) {
            const attr = (entry.target as HTMLElement).getAttribute('data-page')
            if (attr === null) continue
            const idx = Number(attr) - 1
            if (entry.isIntersecting) {
              if (!next.has(idx)) {
                next.add(idx)
                changed = true
              }
            } else if (next.has(idx)) {
              next.delete(idx)
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
      { root, rootMargin: `${RENDER_MARGIN_PX}px 0px ${RENDER_MARGIN_PX}px 0px`, threshold: 0 }
    )
    observerRef.current = observer
    for (const el of pageElsRef.current.values()) observer.observe(el)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [numPages])

  const getPageRefCallback = useCallback((idx: number): ((el: HTMLDivElement | null) => void) => {
    const cache = refCallbacksRef.current
    let cb = cache.get(idx)
    if (!cb) {
      cb = (el) => {
        const map = pageElsRef.current
        const observer = observerRef.current
        const prev = map.get(idx)
        if (el) {
          map.set(idx, el)
          observer?.observe(el)
        } else {
          if (prev && observer) observer.unobserve(prev)
          map.delete(idx)
        }
      }
      cache.set(idx, cb)
    }
    return cb
  }, [])

  // ---- scroll -> current page readout (rAF-throttled) -------------------
  const onScroll = useCallback((): void => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (!el) return
      setCurrentPage(currentPageIndex(el.scrollTop, pageBoxes) + 1)
    })
  }, [pageBoxes])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    []
  )

  // ---- zoom + page jump ---------------------------------------------------
  const beginManual = (next: number): void => {
    setScaleMode('manual')
    setManualScale(clampZoom(next))
  }
  const handleZoomIn = (): void => beginManual(zoomIn(effectiveScale))
  const handleZoomOut = (): void => beginManual(zoomOut(effectiveScale))
  const handleActualSize = (): void => beginManual(1)
  const handleFitWidth = (): void => setScaleMode('fit-width')

  const goToPage = (n: number): void => {
    if (numPages === 0) return
    const clamped = Math.min(Math.max(Math.round(n), 1), numPages)
    const box = pageBoxes[clamped - 1]
    if (!box || !scrollRef.current) return
    scrollRef.current.scrollTo({ top: box.top })
    setCurrentPage(clamped)
  }

  const onPageJumpKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    goToPage(Number(event.currentTarget.value))
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.key === '=' || event.key === '+') {
      event.preventDefault()
      handleZoomIn()
    } else if (event.key === '-') {
      event.preventDefault()
      handleZoomOut()
    } else if (event.key === '0') {
      event.preventDefault()
      handleActualSize()
    }
  }

  if (loadError !== null) {
    return (
      <div className="pdfview">
        <div className="pdfview__toolbar">
          <span className="pdfview__filename" title={path}>
            {fileName}
          </span>
        </div>
        <div className="pdfview__error">
          Could not open {fileName}: {loadError}
        </div>
      </div>
    )
  }

  return (
    <div className="pdfview" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="pdfview__toolbar">
        <span className="pdfview__filename" title={path}>
          {fileName}
        </span>
        <span className="pdfview__pagenav">
          <input
            key={currentPage}
            className="pdfview__pagejump"
            defaultValue={currentPage}
            inputMode="numeric"
            aria-label="Jump to page"
            disabled={numPages === 0}
            onKeyDown={onPageJumpKeyDown}
          />
          <span className="pdfview__pageinfo">of {numPages || '—'}</span>
        </span>
        <span className="pdfview__zoom">
          <button
            className="pdfview__zoombtn"
            title="Zoom out (⌘-)"
            disabled={numPages === 0}
            onClick={handleZoomOut}
          >
            −
          </button>
          <button
            className="pdfview__zoombtn"
            title="Actual size (⌘0)"
            disabled={numPages === 0}
            onClick={handleActualSize}
          >
            {Math.round(effectiveScale * 100)}%
          </button>
          <button
            className="pdfview__zoombtn"
            title="Zoom in (⌘+)"
            disabled={numPages === 0}
            onClick={handleZoomIn}
          >
            +
          </button>
          <button
            className="pdfview__fitwidth"
            aria-pressed={scaleMode === 'fit-width'}
            disabled={numPages === 0}
            onClick={handleFitWidth}
          >
            Fit width
          </button>
        </span>
      </div>
      <div className="pdfview__scroll" ref={scrollRef} onScroll={onScroll}>
        {loaded === null ? (
          <div className="pdfview__loading">Loading {fileName}…</div>
        ) : (
          <div className="pdfview__pages">
            {loaded.pages.map((page, idx) => {
              const size = loaded.naturalSizes[idx] ?? { width: 0, height: 0 }
              const width = size.width * effectiveScale
              const height = size.height * effectiveScale
              return (
                <div
                  key={idx}
                  ref={getPageRefCallback(idx)}
                  className="pdfview__page"
                  data-page={idx + 1}
                  style={{ width, height }}
                >
                  {renderSet.has(idx) ? (
                    <div
                      className="pdfview__pagesurface"
                      /* pdf.js sizes the text layer as
                         `--total-scale-factor * rawDims.pageWidth` off the
                         UNSCALED page box, so this must track the live render
                         scale or the layer stays at natural size while the
                         canvas zooms (see viewer.css). */
                      style={{ '--total-scale-factor': effectiveScale } as CSSProperties}
                    >
                      <PdfPageCanvas page={page} scale={effectiveScale} />
                    </div>
                  ) : (
                    <div className="pdfview__placeholder" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
