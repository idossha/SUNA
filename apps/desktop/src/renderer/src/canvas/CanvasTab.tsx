import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { CanvasDocument, CommandHistory, createBrowserDomAdapter } from '@suna/canvas'
import { checkFigureSvg, getBundledProfile, type Diagnostic } from '@suna/formatter'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useUiStore } from '../state/ui'
import { useProjectStore } from '../state/project'

/**
 * The engine's CanvasDocument stays OFF-DOM and pristine — it is the single
 * source of truth and the only thing serialized to disk (serializing a node
 * adopted into the page's HTML document reorders namespaces and destroys
 * matplotlib's attribute formatting). What the user sees is a mirror clone,
 * re-synced after every engine mutation; drag previews touch only the mirror.
 */
interface Session {
  doc: CanvasDocument
  history: CommandHistory
}

interface ViewTransform {
  scale: number
  tx: number
  ty: number
}

interface DragState {
  ids: string[]
  startX: number
  startY: number
  moved: boolean
  originals: Map<string, string | null>
}

/** Semantic gids from suna_mpl ('ax0.legend', 'ax0', 'suptitle', 'legend'). */
function isSemanticId(id: string): boolean {
  return id.includes('.') || /^(ax\d+|suptitle|legend\d*)$/.test(id)
}

/**
 * Selectable unit: nearest semantic-gid ancestor if one exists (matplotlib
 * internals like patch_2/text_5 are not units), else the deepest id'd element.
 */
function pickTarget(eventTarget: EventTarget | null, svg: SVGSVGElement): string | null {
  let el = eventTarget instanceof Element ? eventTarget : null
  let fallback: string | null = null
  while (el && el !== svg) {
    const id = el.getAttribute('id')
    if (id) {
      if (isSemanticId(id)) return id
      fallback ??= id
    }
    el = el.parentElement
  }
  return fallback
}

export function CanvasTab({ api, params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path

  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const mirrorRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const savedRevRef = useRef(0)
  const revRef = useRef(0)

  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [rev, setRev] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [artboardLabel, setArtboardLabel] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  const note = (text: string): void => useUiStore.getState().setStatusNote(text)

  /** Compliance check against the project's active journal profile. */
  const runCompliance = (): void => {
    const session = sessionRef.current
    const profileId = useProjectStore.getState().manifest?.activeProfileId
    if (!session || !profileId) return
    const profile = getBundledProfile(profileId)
    if (!profile) return
    try {
      setDiagnostics(checkFigureSvg(session.doc.serialize(), profile, { figureId: fileName }))
    } catch {
      // compliance is advisory; never let it break the canvas
    }
  }

  const mirrorById = (id: string): Element | null => {
    const mirror = mirrorRef.current
    if (!mirror) return null
    if (mirror.getAttribute('id') === id) return mirror
    return mirror.querySelector(`[id="${CSS.escape(id)}"]`)
  }

  /** Re-clone the pristine engine document into the visible world layer. */
  const syncMirror = (): void => {
    const session = sessionRef.current
    const world = worldRef.current
    if (!session || !world) return
    const clone = document.importNode(session.doc.root, true) as SVGSVGElement
    world.replaceChildren(clone)
    mirrorRef.current = clone
  }

  const bump = (): void => {
    revRef.current += 1
    setRev(revRef.current)
    api.setTitle(revRef.current === savedRevRef.current ? fileName : `${fileName} •`)
  }

  // ---- load & mount --------------------------------------------------------
  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', { path })
        if (disposed) return
        const doc = new CanvasDocument(content, createBrowserDomAdapter())
        sessionRef.current = { doc, history: new CommandHistory(doc) }
        syncMirror()

        const ab = doc.artboard
        if (ab.widthMm && ab.heightMm) {
          setArtboardLabel(`${ab.widthMm.toFixed(1)} × ${ab.heightMm.toFixed(1)} mm`)
        }
        runCompliance()

        const viewport = viewportRef.current
        const mirror = mirrorRef.current
        if (!viewport || !mirror) return
        const svgRect = mirror.getBoundingClientRect()
        const vpRect = viewport.getBoundingClientRect()
        if (svgRect.width > 0) {
          const scale = Math.min(
            (vpRect.width * 0.86) / svgRect.width,
            (vpRect.height * 0.86) / svgRect.height,
            4
          )
          setView({
            scale,
            tx: (vpRect.width - svgRect.width * scale) / 2,
            ty: (vpRect.height - svgRect.height * scale) / 2
          })
        }
      } catch (error) {
        if (!disposed) setLoadError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      disposed = true
      sessionRef.current = null
      mirrorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // ---- persistence ---------------------------------------------------------
  const save = async (): Promise<void> => {
    const session = sessionRef.current
    if (!session) return
    try {
      await window.suna.invoke('fs:write-text', { path, content: session.doc.serialize() })
      savedRevRef.current = revRef.current
      api.setTitle(fileName)
      note(`Saved ${fileName}`)
      runCompliance()
    } catch (error) {
      note(`Could not save ${fileName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---- pointer interactions ------------------------------------------------
  const screenDeltaToWorld = (dx: number, dy: number): { dx: number; dy: number } => {
    const ctm = mirrorRef.current?.getScreenCTM()
    if (!ctm) return { dx, dy }
    const inv = ctm.inverse()
    const p0 = new DOMPoint(0, 0).matrixTransform(inv)
    const p1 = new DOMPoint(dx, dy).matrixTransform(inv)
    return { dx: p1.x - p0.x, dy: p1.y - p0.y }
  }

  const onPointerDown = (event: ReactPointerEvent): void => {
    const mirror = mirrorRef.current
    if (!mirror || event.button !== 0) return
    viewportRef.current?.focus()

    const targetId = pickTarget(event.target, mirror)
    if (!targetId) {
      setSelectedIds([])
      return
    }
    let ids: string[]
    if (event.shiftKey) {
      ids = selectedIds.includes(targetId)
        ? selectedIds.filter((id) => id !== targetId)
        : [...selectedIds, targetId]
    } else {
      ids = selectedIds.includes(targetId) ? selectedIds : [targetId]
    }
    setSelectedIds(ids)
    if (ids.length === 0) return

    const originals = new Map<string, string | null>()
    for (const id of ids) {
      const el = mirrorById(id)
      if (el) originals.set(id, el.getAttribute('transform'))
    }
    dragRef.current = {
      ids,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      originals
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent): void => {
    const drag = dragRef.current
    if (!drag) return
    const dxScreen = event.clientX - drag.startX
    const dyScreen = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dxScreen, dyScreen) < 3) return
    drag.moved = true
    const { dx, dy } = screenDeltaToWorld(dxScreen, dyScreen)
    for (const [id, original] of drag.originals) {
      const el = mirrorById(id)
      if (!el) continue
      const suffix = original ? ` ${original}` : ''
      el.setAttribute('transform', `translate(${dx} ${dy})${suffix}`)
    }
    setRev((r) => r + 1) // reposition selection overlay
  }

  const onPointerUp = (event: ReactPointerEvent): void => {
    const drag = dragRef.current
    const session = sessionRef.current
    dragRef.current = null
    if (!drag || !session) return
    if (!drag.moved) {
      setRev((r) => r + 1)
      return
    }
    const { dx, dy } = screenDeltaToWorld(event.clientX - drag.startX, event.clientY - drag.startY)
    const result = session.history.apply(
      { kind: 'translate', targets: drag.ids, dx, dy },
      'move'
    )
    if (!result.ok) note(`Move failed: ${result.error.code}`)
    syncMirror() // discard preview; render the engine's truth
    bump()
  }

  const onWheel = (event: ReactWheelEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      const vp = viewportRef.current?.getBoundingClientRect()
      if (!vp) return
      const factor = Math.exp(-event.deltaY * 0.01)
      setView((v) => {
        const scale = Math.min(Math.max(v.scale * factor, 0.05), 12)
        const cx = event.clientX - vp.left
        const cy = event.clientY - vp.top
        const k = scale / v.scale
        return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }
      })
    } else {
      setView((v) => ({ ...v, tx: v.tx - event.deltaX, ty: v.ty - event.deltaY }))
    }
  }

  // ---- keyboard ------------------------------------------------------------
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const session = sessionRef.current
    if (!session) return
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key === 's') {
      event.preventDefault()
      void save()
    } else if (mod && event.key === 'z') {
      event.preventDefault()
      const result = event.shiftKey ? session.history.redo() : session.history.undo()
      if (result) {
        syncMirror()
        bump()
      }
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && selectedIds.length > 0) {
      event.preventDefault()
      const result = session.history.apply({ kind: 'remove', targets: selectedIds }, 'delete')
      if (result.ok) {
        setSelectedIds([])
        syncMirror()
        bump()
      } else {
        note(`Delete failed: ${result.error.code}`)
      }
    } else if (event.key === 'Escape') {
      setSelectedIds([])
    }
  }

  // ---- selection overlay geometry ------------------------------------------
  const overlayBoxes: { id: string; left: number; top: number; width: number; height: number }[] = []
  const vpRect = viewportRef.current?.getBoundingClientRect()
  if (vpRect) {
    for (const id of selectedIds) {
      const el = mirrorById(id)
      if (!el || !(el instanceof SVGGraphicsElement)) continue
      const rect = el.getBoundingClientRect()
      overlayBoxes.push({
        id,
        left: rect.left - vpRect.left,
        top: rect.top - vpRect.top,
        width: rect.width,
        height: rect.height
      })
    }
  }
  void rev // overlay depends on rev to recompute after mutations

  if (loadError) {
    return <div className="sidebar__empty">Could not open {fileName}: {loadError}</div>
  }

  return (
    <div className="canvas-tab">
      <div className="canvas-tab__toolbar">
        <span className="canvas-tab__meta">
          {artboardLabel}
          {selectedIds.length > 0 && (
            <span className="canvas-tab__selection">
              {selectedIds.length === 1 ? selectedIds[0] : `${selectedIds.length} selected`}
            </span>
          )}
        </span>
        <span className="canvas-tab__meta">
          {diagnostics.length > 0 && (
            <button
              className={`canvas-tab__issues ${diagnostics.some((d) => d.severity === 'error') ? 'canvas-tab__issues--error' : ''}`}
              onClick={() => setDiagnosticsOpen((open) => !open)}
            >
              {diagnostics.length} {diagnostics.length === 1 ? 'issue' : 'issues'}
            </button>
          )}
          {Math.round(view.scale * 100)}%
        </span>
      </div>
      {diagnosticsOpen && diagnostics.length > 0 && (
        <div className="canvas-diagnostics">
          {diagnostics.slice(0, 50).map((d, i) => (
            <div key={`${d.id}-${i}`} className="canvas-diagnostics__row">
              <span
                className={`canvas-diagnostics__dot canvas-diagnostics__dot--${d.severity}`}
              />
              <span className="canvas-diagnostics__rule">{d.id}</span>
              <span className="canvas-diagnostics__msg">{d.message}</span>
            </div>
          ))}
          {diagnostics.length > 50 && (
            <div className="canvas-diagnostics__row">…and {diagnostics.length - 50} more</div>
          )}
        </div>
      )}
      <div
        ref={viewportRef}
        className="canvas-viewport"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <div
          ref={worldRef}
          className="canvas-world"
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
        />
        <div className="canvas-overlay">
          {overlayBoxes.map((box) => (
            <div
              key={box.id}
              className="canvas-overlay__box"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
