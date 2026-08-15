import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent
} from 'react'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { dataUriForImage } from './image-mime'
import { clampZoom, fitContainScale, zoomIn, zoomOut } from './zoom'
import './viewer.css'

interface NaturalSize {
  width: number
  height: number
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  panX: number
  panY: number
}

/** Image viewer (feature-plan-4 §2): fit/100%/zoom, drag-to-pan, a pixel
 *  readout, and a checkerboard behind transparency. */
export function ImageTab({ params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path

  const [dataUri, setDataUri] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<'fit' | 'manual'>('fit')
  const [manualScale, setManualScale] = useState(1)
  const [containerSize, setContainerSize] = useState<NaturalSize>({ width: 0, height: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  // ---- load the bytes -----------------------------------------------------
  useEffect(() => {
    let disposed = false
    setDataUri(null)
    setNaturalSize(null)
    setLoadError(null)
    setMode('fit')
    setManualScale(1)
    setPan({ x: 0, y: 0 })

    void (async () => {
      try {
        const { base64 } = await window.suna.invoke('fs:read-binary', { path })
        if (!disposed) setDataUri(dataUriForImage(path, base64))
      } catch (error) {
        if (!disposed) setLoadError(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      disposed = true
    }
  }, [path])

  // ---- measure the stage for "fit" -----------------------------------------
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setContainerSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    setContainerSize({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  const effectiveScale =
    mode === 'fit'
      ? fitContainScale(
          containerSize.width - 32,
          containerSize.height - 32,
          naturalSize?.width ?? 0,
          naturalSize?.height ?? 0
        )
      : clampZoom(manualScale)

  // ---- zoom -----------------------------------------------------------------
  const beginManual = (next: number): void => {
    setMode('manual')
    setManualScale(clampZoom(next))
    setPan({ x: 0, y: 0 })
  }
  const handleZoomIn = (): void => beginManual(zoomIn(effectiveScale))
  const handleZoomOut = (): void => beginManual(zoomOut(effectiveScale))
  const handleActualSize = (): void => beginManual(1)
  const handleFit = (): void => {
    setMode('fit')
    setPan({ x: 0, y: 0 })
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

  // ---- drag to pan ------------------------------------------------------
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || dataUri === null) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPan({ x: drag.panX + (event.clientX - drag.startX), y: drag.panY + (event.clientY - drag.startY) })
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag && drag.pointerId === event.pointerId) dragRef.current = null
  }

  const onImgLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const img = event.currentTarget
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
  }
  const onImgError = (): void => {
    setLoadError('The image data could not be decoded (the file may be corrupt).')
  }

  const frameWidth = (naturalSize?.width ?? 0) * effectiveScale
  const frameHeight = (naturalSize?.height ?? 0) * effectiveScale

  return (
    <div className="imgview" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="imgview__toolbar">
        <span className="imgview__filename" title={path}>
          {fileName}
        </span>
        {naturalSize && (
          <span className="imgview__dims">
            {naturalSize.width} × {naturalSize.height}px
          </span>
        )}
        <span className="imgview__zoom">
          <button
            className="imgview__zoombtn"
            title="Zoom out (⌘-)"
            disabled={dataUri === null}
            onClick={handleZoomOut}
          >
            −
          </button>
          <button
            className="imgview__zoombtn"
            title="Actual size (⌘0)"
            disabled={dataUri === null}
            onClick={handleActualSize}
          >
            {Math.round(effectiveScale * 100)}%
          </button>
          <button
            className="imgview__zoombtn"
            title="Zoom in (⌘+)"
            disabled={dataUri === null}
            onClick={handleZoomIn}
          >
            +
          </button>
          <button
            className="imgview__fit"
            aria-pressed={mode === 'fit'}
            disabled={dataUri === null}
            onClick={handleFit}
          >
            Fit
          </button>
        </span>
      </div>
      <div
        className="imgview__stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {loadError !== null ? (
          <div className="imgview__error">
            Could not open {fileName}: {loadError}
          </div>
        ) : dataUri === null ? (
          <div className="imgview__loading">Loading {fileName}…</div>
        ) : (
          <div
            className="imgview__frame"
            style={{
              width: frameWidth,
              height: frameHeight,
              transform: `translate(${pan.x}px, ${pan.y}px)`
            }}
          >
            <img
              className="imgview__img"
              src={dataUri}
              alt={fileName}
              draggable={false}
              onLoad={onImgLoad}
              onError={onImgError}
            />
          </div>
        )}
      </div>
    </div>
  )
}
