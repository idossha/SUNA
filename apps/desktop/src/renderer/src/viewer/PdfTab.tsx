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
import {
  buildPageText,
  noteQuote,
  notePage,
  sortNotes,
  type NoteColor,
  type PdfTextItemLike
} from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { readLocalAuthorName } from '../state/comments'
import { useProjectStore } from '../state/project'
import { useReferencePdfsStore } from '../state/referencePdfs'
import { useRefNotesStore } from '../state/refnotes'
import { base64ToUint8Array } from './binary'
import { embedHighlights } from './embedRunner'
import { HighlightLayer } from './HighlightLayer'
import { NotesRail } from './NotesRail'
import { useNoteRects } from './useNoteRects'
import { currentPageIndex, layoutPages, type PageBox } from './pdf-layout'
import { citekeyForPdfPath, type PdfCitekeyMatch } from './pdfCitekey'
import {
  citedPageLabel,
  quoteWithCitation,
  readPdfSelection,
  type PdfSelectionResult,
  type RenderedPage
} from './pdfSelection'
import { QuotePopover } from './QuotePopover'
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
function PdfPageCanvas({
  page,
  pageNumber,
  scale,
  onTextReady,
  onTextGone
}: {
  page: PDFPageProxy
  pageNumber: number
  scale: number
  /** Reports the rendered text layer up so selections can be read against it. */
  onTextReady: (entry: RenderedPage) => void
  onTextGone: (pageNumber: number) => void
}): JSX.Element {
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
    let cancelled = false

    if (textLayerEl) {
      // getTextContent() rather than streamTextContent(): the SAME items array
      // both feeds the layer and builds the page text an anchor is measured
      // against, so `textDivs[i]` and `itemStarts[i]` cannot describe different
      // items (ADR-008). Streaming would give the layer its items and leave us
      // fetching a second, independently-ordered copy.
      void (async () => {
        try {
          const content = await page.getTextContent()
          if (cancelled || textLayerRef.current === null) return
          textLayerEl.replaceChildren()
          textLayer = new TextLayer({ textContentSource: content, container: textLayerEl, viewport })
          await textLayer.render()
          if (cancelled) return
          onTextReady({
            page: pageNumber,
            pageText: buildPageText(content.items as PdfTextItemLike[]),
            textDivs: textLayer.textDivs as HTMLElement[],
            viewport
          })
        } catch (error: unknown) {
          // Selection is best-effort: a text-layer failure never takes the
          // page render down with it.
          if (error instanceof AbortException) return
        }
      })()
    }

    return () => {
      cancelled = true
      renderTask.cancel()
      textLayer?.cancel()
      onTextGone(pageNumber)
    }
  }, [page, pageNumber, scale, onTextReady, onTextGone])

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

  const [pageLabels, setPageLabels] = useState<string[] | null>(null)
  const [selection, setSelection] = useState<PdfSelectionResult | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** The stored highlight the popover is over, and where to anchor it. */
  const [pickedNote, setPickedNote] = useState<{ id: string; rect: DOMRect } | null>(null)
  const [railOpen, setRailOpen] = useState(false)
  const [composingFor, setComposingFor] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const pageElsRef = useRef(new Map<number, HTMLDivElement>())
  const refCallbacksRef = useRef(new Map<number, (el: HTMLDivElement | null) => void>())
  const rafRef = useRef<number | null>(null)
  /** Rendered text layers by page number — the substrate a selection is read against. */
  const renderedRef = useRef(new Map<number, RenderedPage>())

  const numPages = loaded?.pages.length ?? 0
  const firstPageWidth = loaded?.naturalSizes[0]?.width ?? 0
  const effectiveScale =
    scaleMode === 'fit-width' ? fitWidthScale(containerWidth - 48, firstPageWidth) : clampZoom(manualScale)

  const pageBoxes: PageBox[] = useMemo(
    () => (loaded ? layoutPages(loaded.naturalSizes.map((s) => s.height * effectiveScale), PAGE_GAP) : []),
    [loaded, effectiveScale]
  )

  // ---- which reference is this? -----------------------------------------
  const rootDir = useProjectStore((s) => s.rootDir)
  const referenceMap = useReferencePdfsStore((s) => s.map)

  const citekeyMatch: PdfCitekeyMatch = useMemo(
    () => citekeyForPdfPath(referenceMap, path),
    [referenceMap, path]
  )

  // Rendered pages live in a ref (they change on every scroll and re-render,
  // and nothing should re-render the whole viewer for that) but highlights
  // must repaint when one arrives — so the epoch is the render signal.
  const [textEpoch, setTextEpoch] = useState(0)
  const registerPageText = useCallback((entry: RenderedPage): void => {
    renderedRef.current.set(entry.page, entry)
    setTextEpoch((n) => n + 1)
  }, [])
  const forgetPageText = useCallback((pageNumber: number): void => {
    renderedRef.current.delete(pageNumber)
    setTextEpoch((n) => n + 1)
  }, [])
  const renderedPages = useMemo(
    () => [...renderedRef.current.values()].sort((a, b) => a.page - b.page),
    [textEpoch]
  )

  // ---- reading notes for this paper -------------------------------------
  const notesFile = useRefNotesStore((s) => s.file)
  const loadNotes = useRefNotesStore((s) => s.load)
  const clearNotes = useRefNotesStore((s) => s.clear)
  const addNote = useRefNotesStore((s) => s.addNote)
  const updateNote = useRefNotesStore((s) => s.updateNote)
  const deleteNote = useRefNotesStore((s) => s.deleteNote)
  const recordEmbed = useRefNotesStore((s) => s.recordEmbed)
  const notesCitekey = useRefNotesStore((s) => s.citekey)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)

  const notes = useMemo(
    () => (notesFile === null ? [] : sortNotes(notesFile.notes)),
    [notesFile]
  )

  useEffect(() => {
    if (rootDir === null || citekeyMatch.kind !== 'one') {
      clearNotes()
      return
    }
    void loadNotes(rootDir, citekeyMatch.citekey)
  }, [rootDir, citekeyMatch, loadNotes, clearNotes])

  // Every note's rectangles, resolved ONCE and shared by the overlay and by
  // the code that writes /QuadPoints into the PDF — so what is painted and
  // what is embedded cannot drift apart.
  const pageElFor = useCallback(
    (page: number): HTMLElement | null => pageElsRef.current.get(page - 1) ?? null,
    []
  )
  const resolvedNotes = useNoteRects(notes, renderedPages, pageElFor, effectiveScale, textEpoch)

  // ---- keep the PDF's own annotations in step with the sidecar ----------
  // Debounced, because a burst of highlighting should cost one regeneration,
  // not one per colour click: each regeneration re-parses and re-serialises
  // the whole document.
  const embedTimerRef = useRef<number | null>(null)
  const lastEmbedKeyRef = useRef<string>('')
  useEffect(() => {
    if (rootDir === null || notesCitekey === null || notesFile === null) return
    // Nothing to do until the notes have geometry: rectangles come from
    // rendered pages, and embedding before page 1 has painted would write an
    // empty annotation layer over a file that has highlights.
    if (notes.length > 0 && resolvedNotes.byNote.size === 0) return

    const key = JSON.stringify(
      notes.map((n) => [n.id, n.color, n.body, [...(resolvedNotes.byNote.get(n.id)?.keys() ?? [])]])
    )
    if (key === lastEmbedKeyRef.current) return

    if (embedTimerRef.current !== null) window.clearTimeout(embedTimerRef.current)
    embedTimerRef.current = window.setTimeout(() => {
      embedTimerRef.current = null
      lastEmbedKeyRef.current = key
      const viewports = new Map(renderedPages.map((entry) => [entry.page, entry.viewport]))
      void embedHighlights({
        rootDir,
        citekey: notesCitekey,
        notes,
        rectsByNote: resolvedNotes.byNote,
        viewports,
        author: readLocalAuthorName()
      }).then((outcome) => {
        if (!outcome.ok) {
          setNote(`Highlights are saved, but the PDF was not updated: ${outcome.error ?? 'unknown'}`)
          return
        }
        // Restamp the baseline so the next open does not read SUNA's own
        // write as "this PDF changed" and run the re-anchor sweep.
        void recordEmbed({
          pristineBytes: outcome.pristineBytes ?? 0,
          pristineSha256: outcome.pristineSha256 ?? '',
          sha256: outcome.sha256 ?? '',
          pageCount: numPages,
          noteIds: notes.map((n) => n.id)
        })
      })
    }, 700)

    return () => {
      if (embedTimerRef.current !== null) window.clearTimeout(embedTimerRef.current)
    }
  }, [rootDir, notesCitekey, notesFile, notes, resolvedNotes, renderedPages, numPages, recordEmbed])

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
    setPageLabels(null)
    setSelection(null)
    setNote(null)
    renderedRef.current.clear()

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

        // Declared page labels, when the PDF has them. Nature and Frontiers
        // do; arXiv and CVPR answer null — exactly the preprints researchers
        // read most — so `citedPageLabel` falls back to the index.
        const labels = await doc.getPageLabels().catch(() => null)
        if (!cancelled && labels !== null) setPageLabels(labels)
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

  // ---- selection -> quote popover ---------------------------------------
  // Read on mouseup/keyup rather than `selectionchange`: the latter fires for
  // every pixel of a drag, and each read walks the selected spans.
  const refreshSelection = useCallback((): void => {
    const rendered = [...renderedRef.current.values()].sort((a, b) => a.page - b.page)
    setSelection(readPdfSelection(window.getSelection(), rendered))
  }, [])

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const onUp = (): void => {
      // Let the browser finish updating the selection before reading it.
      window.setTimeout(refreshSelection, 0)
    }
    root.addEventListener('mouseup', onUp)
    root.addEventListener('keyup', onUp)
    return () => {
      root.removeEventListener('mouseup', onUp)
      root.removeEventListener('keyup', onUp)
    }
  }, [refreshSelection])

  // A new selection supersedes the last notice, and supersedes a highlight
  // popover — you cannot be acting on both at once.
  useEffect(() => {
    if (selection !== null) {
      setNote(null)
      setPickedNote(null)
    }
  }, [selection])

  const dismissQuote = useCallback((): void => {
    setSelection(null)
    setPickedNote(null)
  }, [])

  const quoteCitekey = citekeyMatch.kind === 'one' ? citekeyMatch.citekey : null

  /** The note the popover is currently over, when it is over one. */
  const pickedNoteObject = pickedNote === null ? null : (notes.find((n) => n.id === pickedNote.id) ?? null)

  /** Page and text the popover is about — a fresh selection, or a stored note. */
  const popoverQuote = pickedNoteObject !== null ? noteQuote(pickedNoteObject) : (selection?.quote ?? '')
  const popoverPage =
    pickedNoteObject !== null
      ? notePage(pickedNoteObject)
      : (selection?.runs[0]?.page ?? null)
  const popoverPageLabel = popoverPage === null ? null : citedPageLabel(popoverPage, pageLabels)

  const copyQuote = useCallback((): void => {
    if (popoverQuote === '') return
    const text = quoteWithCitation(popoverQuote, quoteCitekey, popoverPageLabel)
    void navigator.clipboard.writeText(text).then(
      () => setNote(quoteCitekey === null ? 'Passage copied.' : 'Passage and citation copied.'),
      () => setNote('Could not write to the clipboard.')
    )
    setSelection(null)
    setPickedNote(null)
  }, [popoverQuote, quoteCitekey, popoverPageLabel])

  /** Copy one note's passage straight from the rail. */
  const copyNote = useCallback(
    (noteId: string): void => {
      const target = notes.find((n) => n.id === noteId)
      if (target === undefined) return
      const label = citedPageLabel(notePage(target), pageLabels)
      void navigator.clipboard.writeText(quoteWithCitation(noteQuote(target), quoteCitekey, label)).then(
        () => setNote('Passage and citation copied.'),
        () => setNote('Could not write to the clipboard.')
      )
    },
    [notes, pageLabels, quoteCitekey]
  )

  /**
   * Colour click: create a highlight from the selection, or recolour the one
   * the popover is over.
   */
  const applyColor = useCallback(
    (color: NoteColor): void => {
      if (pickedNote !== null) {
        void updateNote(pickedNote.id, { color })
        setPickedNote(null)
        return
      }
      if (selection === null) return
      if (notesCitekey === null) {
        setNote('This PDF is not a reference in this project, so there is nowhere to keep notes.')
        setSelection(null)
        return
      }
      const runs = selection.anchors.map((anchor) => ({
        page: anchor.page,
        quote: anchor.quote,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        detached: false
      }))
      void addNote(runs, color).then((created) => {
        if (created !== null) setActiveNoteId(created.id)
      })
      window.getSelection()?.removeAllRanges()
      setSelection(null)
    },
    [pickedNote, selection, notesCitekey, addNote, updateNote]
  )

  /** Note button: highlight (if needed) and open the rail composer on it. */
  const startNote = useCallback((): void => {
    if (pickedNote !== null) {
      setRailOpen(true)
      setComposingFor(pickedNote.id)
      setActiveNoteId(pickedNote.id)
      setPickedNote(null)
      return
    }
    if (selection === null || notesCitekey === null) return
    const runs = selection.anchors.map((anchor) => ({
      page: anchor.page,
      quote: anchor.quote,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      detached: false
    }))
    void addNote(runs, 'yellow').then((created) => {
      if (created === null) return
      setActiveNoteId(created.id)
      setRailOpen(true)
      setComposingFor(created.id)
    })
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [pickedNote, selection, notesCitekey, addNote])

  const removeHighlight = useCallback(
    (noteId: string): void => {
      void deleteNote(noteId)
      setPickedNote(null)
      setActiveNoteId((current) => (current === noteId ? null : current))
    },
    [deleteNote]
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
    // ⌘⇧Q: quote the live selection into the manuscript without reaching for
    // the popover — the gesture that makes skim-reading a paper one keypress
    // per passage rather than three clicks.
    if (event.shiftKey && (event.key === 'h' || event.key === 'H')) {
      event.preventDefault()
      if (selection !== null) applyColor('yellow')
      return
    }
    if (event.altKey && (event.key === 'm' || event.key === 'µ')) {
      event.preventDefault()
      setRailOpen((open) => !open)
      return
    }
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
            className="pdfview__fitwidth pdfview__notesbtn"
            aria-pressed={railOpen}
            title="Notes (⌥M)"
            onClick={() => setRailOpen((open) => !open)}
          >
            Notes{notes.length > 0 ? ` ${notes.length}` : ''}
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
      <div className="pdfview__body">
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
                      <PdfPageCanvas
                        page={page}
                        pageNumber={idx + 1}
                        scale={effectiveScale}
                        onTextReady={registerPageText}
                        onTextGone={forgetPageText}
                      />
                      {/* Between the canvas and the text layer on purpose:
                          highlights sit UNDER the selectable text, so a
                          highlighted passage is still the passage you can
                          select and quote. */}
                      <HighlightLayer
                        page={idx + 1}
                        notes={notes}
                        resolved={resolvedNotes}
                        activeNoteId={activeNoteId}
                        onActivate={(noteId, rect) => {
                          const host = pageElsRef.current.get(idx)
                          const origin = host?.getBoundingClientRect()
                          setSelection(null)
                          setActiveNoteId(noteId)
                          setPickedNote({
                            id: noteId,
                            rect: new DOMRect(
                              (origin?.left ?? 0) + rect.left,
                              (origin?.top ?? 0) + rect.top,
                              rect.width,
                              rect.height
                            )
                          })
                        }}
                      />
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

      {railOpen && (
        <NotesRail
          notes={notes}
          activeNoteId={activeNoteId}
          ambiguous={resolvedNotes.ambiguous}
          detached={resolvedNotes.detached}
          composingFor={composingFor}
          citekey={notesCitekey}
          onActivate={(noteId) => {
            setActiveNoteId(noteId)
            const target = notes.find((n) => n.id === noteId)
            if (target !== undefined) goToPage(notePage(target))
          }}
          onSaveBody={(noteId, body) => void updateNote(noteId, { body })}
          onRecolor={(noteId, color) => void updateNote(noteId, { color })}
          onDelete={removeHighlight}
          onCopy={copyNote}
          onCloseComposer={() => setComposingFor(null)}
          onHide={() => setRailOpen(false)}
        />
      )}
      </div>

      {(selection !== null || pickedNoteObject !== null) && (
        <QuotePopover
          rect={pickedNote !== null ? pickedNote.rect : selection!.rect}
          quoteLength={popoverQuote.length}
          match={citekeyMatch}
          pageLabel={popoverPageLabel}
          pageSpan={
            pickedNoteObject !== null
              ? new Set(pickedNoteObject.runs.map((run) => run.page)).size
              : new Set(selection!.runs.map((run) => run.page)).size
          }
          existing={
            pickedNoteObject === null
              ? undefined
              : { color: pickedNoteObject.color, hasBody: pickedNoteObject.body.trim() !== '' }
          }
          onCopy={copyQuote}
          onDismiss={dismissQuote}
          onHighlight={notesCitekey === null ? undefined : applyColor}
          onNote={notesCitekey === null ? undefined : startNote}
          onRemove={
            pickedNoteObject === null ? undefined : () => removeHighlight(pickedNoteObject.id)
          }
        />
      )}

      {note !== null && (
        <div className="pdfview__note" role="status" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
    </div>
  )
}
