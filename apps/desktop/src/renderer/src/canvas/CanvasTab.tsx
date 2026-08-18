import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type DragEvent as ReactDragEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'
import {
  CanvasDocument,
  CommandHistory,
  createBrowserDomAdapter,
  interact,
  resolveTarget
} from '@suna/canvas'
import type { CanvasCommand } from '@suna/core'
import { checkFigureSvg, getBundledProfile, type Diagnostic } from '@suna/formatter'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useUiStore } from '../state/ui'
import { useProjectStore } from '../state/project'
import { autosaveEnabled } from '../state/autosave'
import { AUTOSAVE_IDLE_MS } from '../state/docSessions'
import { hasDrawableContent } from './blank-canvas'
import {
  collectUnitElements,
  firstNumber,
  fmt,
  pickTarget,
  styleValue,
  targetForElement
} from './canvas-util'
import { captureRegionFor, type ClientRectLike } from './agent-section'
import { registerCanvasToolsProvider } from './dev-seam'
import { registerCanvasPaletteContext } from './palette-actions'
import { ToolRail } from './ToolRail'
import { importOffset, nextImportGroupId, prepareSvgImport } from './import-svg'
import { pngImageSnippet, pngSizeUserUnits } from './import-png'
import { LayersPanel } from './LayersPanel'
import { NewFigureButton } from './NewFigureButton'
import { PropertiesPanel } from './PropertiesPanel'
import { rulerTicks } from './ruler-ticks'
import { Rulers, type RulersHandle } from './Rulers'
import { TextEditOverlay, type TextEditLayout } from './TextEditOverlay'

/**
 * The engine's CanvasDocument stays OFF-DOM and pristine — it is the single
 * source of truth and the only thing serialized to disk. What the user sees
 * is a mirror clone, re-synced after every engine mutation; gesture previews
 * touch only the mirror (canvas-editing-suite.md §8). All interaction logic
 * lives in the framework-free `interact` core: pointer/keyboard input is
 * converted to world coordinates here, and the ToolController's EditorEvents
 * (previews, guides, commits, selection) are applied back to the mirror, the
 * overlay, and the CommandHistory.
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

/** Snap/marquee candidates, rebuilt at each pointer-down (gesture start). */
interface GestureCache {
  elements: { id: string; bbox: interact.WorldRect }[]
  snap: interact.SnapEngine
}

/** Mirror-only preview bookkeeping for move/resize/rotate gestures. */
interface PreviewState {
  originals: Map<string, string | null>
  center: interact.WorldPoint | null
}

interface TextEditState {
  /** Engine target: element id or structural address ('#gid>nth:k'). */
  target: string
  isNew: boolean
}

const HANDLE_POS: { id: interact.HandleId; fx: number; fy: number }[] = [
  { id: 'nw', fx: 0, fy: 0 },
  { id: 'n', fx: 0.5, fy: 0 },
  { id: 'ne', fx: 1, fy: 0 },
  { id: 'e', fx: 1, fy: 0.5 },
  { id: 'se', fx: 1, fy: 1 },
  { id: 's', fx: 0.5, fy: 1 },
  { id: 'sw', fx: 0, fy: 1 },
  { id: 'w', fx: 0, fy: 0.5 }
]

export function CanvasTab({ api, params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path
  // Figures live at <rootDir>/figures/<figureId>/figure.svg (figures-scan.ts);
  // the parent directory name IS the figure's id regardless of file naming.
  const pathSegments = path.split('/')
  const figureId = pathSegments.length >= 2 ? (pathSegments[pathSegments.length - 2] ?? null) : null

  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const mirrorRef = useRef<SVGSVGElement | null>(null)
  const savedRevRef = useRef(0)
  const revRef = useRef(0)
  const controllerRef = useRef<interact.ToolController | null>(null)
  if (controllerRef.current === null) controllerRef.current = new interact.ToolController()
  const controller = controllerRef.current
  const gestureCacheRef = useRef<GestureCache | null>(null)
  const previewRef = useRef<PreviewState | null>(null)
  const selectedIdsRef = useRef<string[]>([])
  const pointerActiveRef = useRef(false)
  const txTimerRef = useRef<number | null>(null)

  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [rev, setRev] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [artboardLabel, setArtboardLabel] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [toolId, setToolId] = useState<interact.ToolId>('select')
  const [gesture, setGesture] = useState<interact.GestureState>({ kind: 'idle' })
  const [guides, setGuides] = useState<interact.SnapGuide[]>([])
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null)
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth >= 1200)
  const [propsOpen, setPropsOpen] = useState(() => window.innerWidth >= 1200)
  const [rulersOn, setRulersOn] = useState(true)
  const rulersRef = useRef<RulersHandle | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const note = (text: string): void => useUiStore.getState().setStatusNote(text)

  const rootDir = useProjectStore((s) => s.rootDir)
  const activeProfileId = useProjectStore((s) => s.manifest?.activeProfileId ?? null)
  const profile = useMemo(
    () => (activeProfileId ? getBundledProfile(activeProfileId) : null),
    [activeProfileId]
  )
  const profileRef = useRef(profile)
  profileRef.current = profile

  /**
   * Compliance check against the project's active journal profile. Returns
   * the fresh list as well as setting state — the Agent section builds its
   * prompt from the return value at send time (feature-plan-8 §4), when the
   * React-state copy may still be a render behind.
   */
  const runCompliance = (): Diagnostic[] => {
    const session = sessionRef.current
    const p = profileRef.current
    if (!session || !p) return []
    try {
      const fresh = checkFigureSvg(session.doc.serialize(), p, { figureId: fileName })
      setDiagnostics(fresh)
      return fresh
    } catch {
      // compliance is advisory; never let it break the canvas
      return []
    }
  }

  const mirrorById = (id: string): Element | null => {
    const mirror = mirrorRef.current
    if (!mirror) return null
    if (mirror.getAttribute('id') === id) return mirror
    return mirror.querySelector(`[id="${CSS.escape(id)}"]`)
  }

  /** Resolve an engine target (id or structural address) in the mirror. */
  const mirrorByTarget = (target: string): Element | null => {
    const mirror = mirrorRef.current
    if (!mirror) return null
    if (!target.startsWith('#')) return mirrorById(target)
    const segments = target.slice(1).split('>')
    const anchor = segments.shift()
    let el: Element | null = anchor === 'root' ? mirror : anchor ? mirrorById(anchor) : null
    for (const seg of segments) {
      if (el === null) return null
      const m = /^nth:(\d+)$/.exec(seg)
      if (!m) return null
      el = el.children[Number(m[1])] ?? null
    }
    return el
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

  // ---- coordinate spaces -----------------------------------------------------
  const screenToWorld = (clientX: number, clientY: number): interact.WorldPoint | null => {
    const ctm = mirrorRef.current?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const worldToScreen = (x: number, y: number): { x: number; y: number } | null => {
    const ctm = mirrorRef.current?.getScreenCTM()
    const vp = viewportRef.current?.getBoundingClientRect()
    if (!ctm || !vp) return null
    const p = new DOMPoint(x, y).matrixTransform(ctm)
    return { x: p.x - vp.left, y: p.y - vp.top }
  }

  /** Screen px per world unit. */
  const zoomOf = (): number => {
    const ctm = mirrorRef.current?.getScreenCTM()
    return ctm ? Math.hypot(ctm.a, ctm.b) : 1
  }

  const worldRectFromClient = (rect: DOMRect): interact.WorldRect | null => {
    const ctm = mirrorRef.current?.getScreenCTM()
    if (!ctm) return null
    const inv = ctm.inverse()
    const p1 = new DOMPoint(rect.left, rect.top).matrixTransform(inv)
    const p2 = new DOMPoint(rect.right, rect.bottom).matrixTransform(inv)
    return interact.rectFromPoints({ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y })
  }

  /** World-space bbox of an element, measured on the mirror (engine is off-DOM). */
  const worldBboxOf = (id: string): interact.WorldRect | null => {
    const el = mirrorById(id)
    if (!el || !(el instanceof SVGGraphicsElement)) return null
    return worldRectFromClient(el.getBoundingClientRect())
  }

  const unionWorldBbox = (ids: readonly string[]): interact.WorldRect | null =>
    interact.unionRects(
      ids.map(worldBboxOf).filter((b): b is interact.WorldRect => b !== null)
    )

  const artboardRect = (): interact.WorldRect => {
    const vb = sessionRef.current?.doc.artboard.viewBox
    if (vb) return { x: vb.minX, y: vb.minY, width: vb.width, height: vb.height }
    const mirror = mirrorRef.current
    if (mirror) {
      const r = worldRectFromClient(mirror.getBoundingClientRect())
      if (r) return r
    }
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  /** Rotation (deg) baked into an element's transform, for the properties panel. */
  const rotationOf = (id: string): number => {
    const el = mirrorById(id)
    if (!el || !(el instanceof SVGGraphicsElement)) return 0
    const m = el.transform.baseVal.consolidate()?.matrix
    if (!m) return 0
    return Math.round(((Math.atan2(m.b, m.a) * 180) / Math.PI) * 10) / 10
  }

  // ---- interaction-core context ----------------------------------------------
  /** Style defaults from the active publisher profile (spec §4). */
  const shapeDefaults = (): interact.ShapeDefaults => {
    const mmPerUser = sessionRef.current?.doc.artboard.mmPerUser ?? null
    const fig = profileRef.current?.figures
    const base = interact.DEFAULT_SHAPE_DEFAULTS
    const clamp = (v: number, lo: number | null, hi: number | null): number =>
      Math.min(Math.max(v, lo ?? v), hi ?? v)
    return {
      strokeWidthPt: clamp(base.strokeWidthPt, fig?.lineWeightPt.min ?? null, fig?.lineWeightPt.max ?? null),
      palette: fig?.palette.suggestedHex ?? base.palette,
      fontPt: clamp(7, fig?.minFontPt ?? null, fig?.maxFontPt ?? null),
      fontFamily: fig?.preferredFontFamilies?.[0] ?? base.fontFamily,
      userPerPt: mmPerUser !== null && mmPerUser > 0 ? 0.3528 / mmPerUser : 1
    }
  }

  /** Rebuild marquee candidates + snap engine at gesture start. */
  const rebuildGestureCache = (excludeForSnap: ReadonlySet<string>): void => {
    const mirror = mirrorRef.current
    if (!mirror || !sessionRef.current) {
      gestureCacheRef.current = null
      return
    }
    const units = collectUnitElements(mirror)
    const excludedEls: Element[] = []
    for (const id of excludeForSnap) {
      const el = mirrorById(id)
      if (el) excludedEls.push(el)
    }
    const elements: { id: string; bbox: interact.WorldRect }[] = []
    const siblings: interact.WorldRect[] = []
    for (const u of units) {
      const bbox = worldBboxOf(u.id)
      if (!bbox || (bbox.width === 0 && bbox.height === 0)) continue
      elements.push({ id: u.id, bbox })
      const excluded =
        excludeForSnap.has(u.id) ||
        excludedEls.some((x) => x === u.el || x.contains(u.el) || u.el.contains(x))
      if (!excluded) siblings.push(bbox)
    }
    gestureCacheRef.current = { elements, snap: new interact.SnapEngine(artboardRect(), siblings) }
  }

  const makeCtx = (eventTarget: EventTarget | null): interact.ToolContext | null => {
    const session = sessionRef.current
    const mirror = mirrorRef.current
    if (!session || !mirror) return null
    const cache = gestureCacheRef.current
    return {
      selection: selectedIdsRef.current,
      bboxOf: (id) => worldBboxOf(id),
      hitTest: () => pickTarget(eventTarget, mirror),
      artboard: artboardRect(),
      zoom: zoomOf(),
      snap: cache?.snap ?? new interact.SnapEngine(artboardRect()),
      elements: cache?.elements ?? [],
      allocateId: () => session.doc.allocateId(),
      hasId: (id) => session.doc.getById(id) !== null,
      defaults: shapeDefaults()
    }
  }

  // ---- history transactions (properties-panel control gestures) ---------------
  const flushTx = (): void => {
    if (txTimerRef.current !== null) {
      window.clearTimeout(txTimerRef.current)
      txTimerRef.current = null
    }
    const session = sessionRef.current
    if (session?.history.inTransaction) session.history.commit()
  }

  /** One-shot edit → one history entry. */
  const applyCommand = (command: CanvasCommand, label: string): boolean => {
    const session = sessionRef.current
    if (!session) return false
    flushTx()
    const result = session.history.apply(command, label)
    if (!result.ok) {
      note(`${label} failed: ${result.error.code}`)
      return false
    }
    syncMirror()
    bump()
    return true
  }

  /** Continuous control gesture: buffered into ONE transaction, idle-committed. */
  const gestureApplyCommand = (command: CanvasCommand, label: string): void => {
    const session = sessionRef.current
    if (!session) return
    if (!session.history.inTransaction) session.history.begin(label)
    const result = session.history.apply(command)
    if (!result.ok) note(`${label} failed: ${result.error.code}`)
    syncMirror()
    bump()
    if (txTimerRef.current !== null) window.clearTimeout(txTimerRef.current)
    txTimerRef.current = window.setTimeout(flushTx, 400)
  }

  // ---- selection ---------------------------------------------------------------
  const setSelection = (ids: string[]): void => {
    selectedIdsRef.current = ids
    setSelectedIds(ids)
  }

  /** Drop ids nested inside other selected ids (a marquee over an axes must
   *  not select both `ax0` and `ax0.legend` — translate would double-move). */
  const normalizeSelection = (ids: string[]): string[] => {
    if (ids.length < 2) return ids
    const els = new Map<string, Element>()
    for (const id of ids) {
      const el = mirrorById(id)
      if (el) els.set(id, el)
    }
    return ids.filter((id) => {
      const el = els.get(id)
      if (!el) return true
      return !ids.some((other) => {
        if (other === id) return false
        const oe = els.get(other)
        return oe !== undefined && oe !== el && oe.contains(el)
      })
    })
  }

  // ---- mirror previews ---------------------------------------------------------
  const ensurePreview = (ids: readonly string[]): PreviewState => {
    let p = previewRef.current
    if (p === null) {
      p = { originals: new Map(), center: null }
      previewRef.current = p
    }
    for (const id of ids) {
      if (!p.originals.has(id)) {
        const el = mirrorById(id)
        if (el) p.originals.set(id, el.getAttribute('transform'))
      }
    }
    return p
  }

  const setPreviewTransforms = (ids: readonly string[], prefix: string | null): void => {
    const p = ensurePreview(ids)
    for (const id of ids) {
      const el = mirrorById(id)
      if (!el) continue
      const original = p.originals.get(id) ?? null
      if (prefix === null) {
        if (original === null) el.removeAttribute('transform')
        else el.setAttribute('transform', original)
      } else {
        el.setAttribute('transform', original ? `${prefix} ${original}` : prefix)
      }
    }
  }

  const clearPreview = (restore: boolean): void => {
    const p = previewRef.current
    previewRef.current = null
    if (!p || !restore) return
    for (const [id, original] of p.originals) {
      const el = mirrorById(id)
      if (!el) continue
      if (original === null) el.removeAttribute('transform')
      else el.setAttribute('transform', original)
    }
  }

  const applyPreview = (g: interact.GestureState): void => {
    switch (g.kind) {
      case 'idle':
        clearPreview(true)
        break
      case 'move':
        setPreviewTransforms(g.ids, g.dx === 0 && g.dy === 0 ? null : `translate(${g.dx} ${g.dy})`)
        break
      case 'resize':
        setPreviewTransforms(
          g.ids,
          interact.isIdentityMatrix(g.matrix) ? null : `matrix(${g.matrix.join(' ')})`
        )
        break
      case 'rotate': {
        const p = ensurePreview(g.ids)
        p.center ??= (() => {
          const bbox = unionWorldBbox(g.ids)
          return bbox ? interact.rectCenter(bbox) : { x: 0, y: 0 }
        })()
        const m = interact.rotationMatrix(p.center, g.angle)
        setPreviewTransforms(g.ids, g.angle === 0 ? null : `matrix(${m.join(' ')})`)
        break
      }
      case 'marquee':
      case 'create':
        break
    }
    setGesture(g)
  }

  // ---- controller event application ---------------------------------------------
  /** Spec §2: resizing a lone text element scales its font size, not its matrix. */
  const refineCommit = (command: CanvasCommand, label: string): CanvasCommand => {
    if (label !== 'Resize' || command.kind !== 'transform') return command
    const session = sessionRef.current
    if (!session) return command
    const el = session.doc.getById(command.target)
    if (!el || el.localName !== 'text') return command
    const [a, , , d] = command.matrix
    const s = Math.abs(Math.abs(a) - 1) >= Math.abs(Math.abs(d) - 1) ? Math.abs(a) : Math.abs(d)
    const current = firstNumber(styleValue(el, 'font-size'))
    if (!(s > 0) || current === null) return command
    return { kind: 'set-style', target: command.target, props: { 'font-size': fmt(current * s) } }
  }

  const applyEvents = (events: interact.EditorEvent[]): void => {
    for (const ev of events) {
      switch (ev.kind) {
        case 'selection':
          setSelection(normalizeSelection(ev.ids))
          break
        case 'guides':
          setGuides(ev.guides)
          break
        case 'preview':
          applyPreview(ev.gesture)
          break
        case 'commit': {
          const session = sessionRef.current
          if (!session) break
          flushTx()
          previewRef.current = null // mirror resync supersedes any preview
          const result = session.history.apply(refineCommit(ev.command, ev.label), ev.label)
          if (!result.ok) note(`${ev.label} failed: ${result.error.code}`)
          syncMirror()
          bump()
          break
        }
        case 'enter-text-edit':
          setTextEdit({ target: ev.id, isNew: true })
          break
      }
    }
    setToolId(controller.tool)
  }

  const selectTool = (tool: interact.ToolId): void => {
    applyEvents(controller.setTool(tool))
    viewportRef.current?.focus()
  }

  // ---- load & mount --------------------------------------------------------
  // Liveness for BOTH loads of figure.svg from disk: the initial mount and
  // the agent-edit reload (§4) can each resolve after the tab is gone, and
  // neither may resurrect sessionRef past the cleanup that nulled it.
  const aliveRef = useRef(true)

  /**
   * THE load path: read figure.svg from disk into a fresh engine session.
   * Used at mount and re-used verbatim after a successful agent edit
   * (feature-plan-8 §4) — deliberately not resetting pan/zoom, so a reload
   * keeps the user's view. Returns null when the tab died mid-read.
   */
  const loadFromDisk = async (): Promise<CanvasDocument | null> => {
    const { content } = await window.suna.invoke('fs:read-text', { path })
    if (!aliveRef.current) return null
    const doc = new CanvasDocument(content, createBrowserDomAdapter())
    sessionRef.current = { doc, history: new CommandHistory(doc) }
    syncMirror()
    const ab = doc.artboard
    if (ab.widthMm && ab.heightMm) {
      setArtboardLabel(`${ab.widthMm.toFixed(1)} × ${ab.heightMm.toFixed(1)} mm`)
    }
    runCompliance()
    return doc
  }

  useEffect(() => {
    aliveRef.current = true
    void (async () => {
      try {
        const doc = await loadFromDisk()
        if (doc === null) return

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
        if (aliveRef.current) setLoadError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      aliveRef.current = false
      flushTx()
      sessionRef.current = null
      mirrorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Dev seam: let e2e drivers steer the tools (registered while mounted).
  useEffect(() => {
    return registerCanvasToolsProvider({
      setTool: (t) => selectTool(t),
      getSelection: () => selectedIdsRef.current,
      getToolState: () => ({ tool: controller.tool, gesture: controller.gesture }),
      // dockview keeps inactive panels mounted at zero size
      isVisible: () => (viewportRef.current?.getBoundingClientRect().width ?? 0) > 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- persistence ---------------------------------------------------------
  /** `quiet` (an autosave) skips the status note; failures always speak up. */
  const save = async (quiet = false): Promise<void> => {
    const session = sessionRef.current
    if (!session) return
    flushTx()
    try {
      await window.suna.invoke('fs:write-text', { path, content: session.doc.serialize() })
      useProjectStore.getState().noteFileSaved(path)
      savedRevRef.current = revRef.current
      api.setTitle(fileName)
      if (!quiet) note(`Saved ${fileName}`)
      runCompliance()
    } catch (error) {
      note(`Could not save ${fileName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Autosave (global 'editor.autosave', on by default), the canvas half of
   * what docSessions does for text: after a pause in editing, a dirty figure
   * writes itself out. Keyed on `rev`, which only advances on a COMMITTED
   * command — a drag in progress bumps nothing, so no save ever lands
   * mid-gesture. The setting is re-read when the timer fires, so switching it
   * off in Settings stops the very next one.
   */
  useEffect(() => {
    if (rev === savedRevRef.current) return
    if (!autosaveEnabled()) return
    const timer = window.setTimeout(() => {
      if (!aliveRef.current) return
      if (revRef.current === savedRevRef.current || !autosaveEnabled()) return
      void save(true)
    }, AUTOSAVE_IDLE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev])

  // ---- directed AI figure edits (feature-plan-8 §4) --------------------------
  /**
   * Union of the selected ids' MIRROR rects (the mirror is layout truth; the
   * engine doc is off-DOM), or the artboard when nothing is selected, padded
   * 12 px, through 'app:capture-rect'. The selection overlay stays visible
   * in the shot ON PURPOSE — the gold boxes are how the agent knows what
   * "the selection" means. Null (nothing measurable, capture failed) still
   * sends the prompt, just without a screenshot.
   */
  const captureForAgent = async (): Promise<{ path: string; ids: string[] } | null> => {
    const mirror = mirrorRef.current
    if (!mirror) return null
    const ids: string[] = []
    const rects: ClientRectLike[] = []
    for (const id of selectedIdsRef.current) {
      const el = mirrorById(id)
      if (!el || !(el instanceof SVGGraphicsElement)) continue
      ids.push(id)
      rects.push(el.getBoundingClientRect())
    }
    if (rects.length === 0) rects.push(mirror.getBoundingClientRect())
    // client → page coordinates: the identity while the root document never
    // scrolls, but 'app:capture-rect' is specified in page coordinates.
    const rect = captureRegionFor(rects, 12, window.scrollX, window.scrollY)
    if (rect === null) return null
    try {
      const res = await window.suna.invoke('app:capture-rect', { rect })
      return { path: res.path, ids }
    } catch {
      return null
    }
  }

  /**
   * §4 success hook: the agent edited figure.svg on disk. A clean tab
   * reloads through THE load path (which also re-runs compliance); a dirty
   * tab has genuinely diverged from disk, so never clobber the user's
   * unsaved work — say so and let them resolve it.
   */
  const afterAgentEdit = async (): Promise<void> => {
    if (!aliveRef.current || sessionRef.current === null) return
    if (revRef.current !== savedRevRef.current) {
      note('Agent edited figure.svg on disk — save or undo your local edits, then reopen')
      return
    }
    try {
      const doc = await loadFromDisk()
      if (doc === null) return
      // Same broadcast a manual save makes: the figure changed on disk, so
      // the manuscript's live preview and the Figures view must re-read it.
      useProjectStore.getState().noteFileSaved(path)
      // The fresh session is by definition in sync with disk.
      revRef.current += 1
      savedRevRef.current = revRef.current
      setRev(revRef.current)
      api.setTitle(fileName)
      setSelection(selectedIdsRef.current.filter((id) => doc.getById(id) !== null))
    } catch (error) {
      note(`Could not reload ${fileName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Command palette seam: "Run Compliance Check" / "Export Figure as PNG/PDF"
  // (feature-plan-4 §5) act on whichever figure is on screen.
  useEffect(() => {
    if (rootDir === null || figureId === null) return
    return registerCanvasPaletteContext({
      rootDir,
      figureId,
      profile,
      get doc() {
        // sessionRef can be replaced (a new file loads into the same tab id
        // is not expected here, but the getter keeps this honest either way)
        if (!sessionRef.current) throw new Error('figure not loaded yet')
        return sessionRef.current.doc
      },
      save,
      runCompliance,
      isVisible: () => (viewportRef.current?.getBoundingClientRect().width ?? 0) > 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootDir, figureId, profile])

  // ---- clipboard-ish -------------------------------------------------------
  /** ⌘D: serialized copies from the ENGINE doc, +8/+8, one undo step. */
  const duplicateSelection = (): void => {
    const session = sessionRef.current
    if (!session || selectedIdsRef.current.length === 0) return
    const copies: interact.DuplicateSource[] = []
    for (const id of selectedIdsRef.current) {
      const el = session.doc.getById(id)
      if (!el) continue
      const clone = el.cloneNode(true) as Element
      clone.removeAttribute('id')
      for (const child of clone.querySelectorAll('[id]')) child.removeAttribute('id')
      const parent = el.parentElement
      const parentId = parent && parent !== session.doc.root ? parent.getAttribute('id') : null
      const source: interact.DuplicateSource = {
        id: session.doc.allocateId(),
        svg: session.doc.adapter.serialize(clone)
      }
      if (parentId) source.parent = parentId
      copies.push(source)
    }
    const command = interact.duplicateCommand(copies)
    if (!command) return
    flushTx()
    const result = session.history.apply(command, 'Duplicate')
    if (!result.ok) {
      note(`Duplicate failed: ${result.error.code}`)
      return
    }
    syncMirror()
    bump()
    setSelection(copies.map((c) => c.id))
  }

  // ---- import (drag-drop / ⌘⇧I) ------------------------------------------------
  /** Fresh `imported-N` id + matching `impN-` prefix, not colliding with the doc. */
  const nextImport = (): { groupId: string; n: number; offset: { dx: number; dy: number } } => {
    const session = sessionRef.current
    const groupId = nextImportGroupId((id) => (session ? session.doc.getById(id) !== null : false))
    const n = Number(groupId.slice('imported-'.length)) || 1
    return { groupId, n, offset: importOffset(n) }
  }

  const importSvgText = (text: string): void => {
    const { groupId, n, offset } = nextImport()
    let svg: string
    try {
      svg = prepareSvgImport(text, groupId, `imp${n}-`, offset)
    } catch (error) {
      note(`Could not import SVG: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    applyCommand({ kind: 'insert', svg }, 'Import SVG')
  }

  const importPngFile = async (file: File): Promise<void> => {
    const session = sessionRef.current
    if (!session) return
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch (error) {
      note(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    let dataUri: string
    try {
      dataUri = await new Promise<string>((resolvePromise, rejectPromise) => {
        const reader = new FileReader()
        reader.onload = () => resolvePromise(String(reader.result))
        reader.onerror = () => rejectPromise(reader.error ?? new Error('could not read file'))
        reader.readAsDataURL(file)
      })
    } catch (error) {
      note(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const mmPerUser = session.doc.artboard.mmPerUser ?? 1
    const size = pngSizeUserUnits({ widthPx: bitmap.width, heightPx: bitmap.height }, mmPerUser)
    const { groupId, offset } = nextImport()
    const artboard = artboardRect()
    const at = { x: artboard.x + offset.dx, y: artboard.y + offset.dy }
    const svg = pngImageSnippet(groupId, dataUri, size, at)
    applyCommand({ kind: 'insert', svg }, 'Import image')
  }

  /** Single dispatch point for both drag-drop and the ⌘⇧I file picker. */
  const importFile = (file: File): void => {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.svg') || file.type === 'image/svg+xml') {
      void file
        .text()
        .then(importSvgText)
        .catch((error: unknown) =>
          note(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
        )
    } else if (lower.endsWith('.png') || file.type === 'image/png') {
      void importPngFile(file)
    } else {
      note(`Unsupported import: ${file.name} (only .svg and .png)`)
    }
  }

  const importFileList = (files: FileList | null | undefined): void => {
    const first = files && files.length > 0 ? files[0] : null
    if (first) importFile(first)
  }

  const onImportInputChange = (event: ReactChangeEvent<HTMLInputElement>): void => {
    importFileList(event.target.files)
    event.target.value = ''
  }

  const onCanvasDragOver = (event: ReactDragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const onCanvasDragLeave = (): void => setDragOver(false)

  const onCanvasDrop = (event: ReactDragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragOver(false)
    importFileList(event.dataTransfer.files)
  }

  // ---- text editing ----------------------------------------------------------
  const commitTextEdit = (text: string): void => {
    const session = sessionRef.current
    const edit = textEdit
    setTextEdit(null)
    if (!session || !edit) return
    if (edit.isNew && text.trim() === '') {
      // Empty new text is noise: revert the insert entirely.
      if (session.history.undo()) {
        setSelection([])
        syncMirror()
        bump()
      }
      return
    }
    const engineEl = resolveTarget(session.doc, edit.target)
    if (text !== (engineEl?.textContent ?? '')) {
      const result = session.history.apply(
        { kind: 'set-text', target: edit.target, text },
        'Edit text'
      )
      if (!result.ok) note(`Edit text failed: ${result.error.code}`)
      syncMirror()
      bump()
    }
  }

  const cancelTextEdit = (): void => {
    const session = sessionRef.current
    const edit = textEdit
    setTextEdit(null)
    if (!session || !edit || !edit.isNew) return
    if (session.history.undo()) {
      setSelection([])
      syncMirror()
      bump()
    }
  }

  // Hide the mirror's text while the contenteditable overlay covers it.
  useEffect(() => {
    if (!textEdit) return
    const el = mirrorByTarget(textEdit.target)
    if (el instanceof SVGElement) el.style.visibility = 'hidden'
    return () => {
      if (el instanceof SVGElement) el.style.visibility = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textEdit, rev])

  // ---- rulers ---------------------------------------------------------------
  // Which ticks exist is pure mm math off the artboard; WHERE they sit on
  // screen comes from the artboard's live CTM, which only reflects the new
  // pan/zoom after React has committed it — hence a layout effect, never a
  // render-time read (that leaves the ruler one frame behind the canvas).
  const artboardForRulers = sessionRef.current?.doc.artboard ?? null
  const rulerWidthMm = artboardForRulers?.widthMm ?? 0
  const rulerHeightMm = artboardForRulers?.heightMm ?? 0
  const hTicks = useMemo(
    () => (rulersOn ? rulerTicks(rulerWidthMm) : []),
    [rulersOn, rulerWidthMm]
  )
  const vTicks = useMemo(
    () => (rulersOn ? rulerTicks(rulerHeightMm) : []),
    [rulersOn, rulerHeightMm]
  )
  const rulersActive = rulersOn && hTicks.length > 0 && vTicks.length > 0

  useLayoutEffect(() => {
    if (!rulersActive) return
    const artboard = sessionRef.current?.doc.artboard
    const vb = artboard?.viewBox
    const mmPer = artboard?.mmPerUser ?? null
    if (!vb || mmPer === null || mmPer <= 0) return
    const hPx = hTicks.map((t) => worldToScreen(vb.minX + t.mm / mmPer, vb.minY)?.x ?? 0)
    const vPx = vTicks.map((t) => worldToScreen(vb.minX, vb.minY + t.mm / mmPer)?.y ?? 0)
    rulersRef.current?.setTickPx(hPx, vPx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulersActive, hTicks, vTicks, view, rev])

  // ---- pointer interactions ------------------------------------------------
  const onPointerDown = (event: ReactPointerEvent): void => {
    if (event.button !== 0 || !sessionRef.current || !mirrorRef.current) return
    viewportRef.current?.focus()
    const point = screenToWorld(event.clientX, event.clientY)
    if (!point) return
    const exclude = new Set(selectedIdsRef.current)
    const hit = pickTarget(event.target, mirrorRef.current)
    if (hit) exclude.add(hit)
    rebuildGestureCache(exclude)
    const ctx = makeCtx(event.target)
    if (!ctx) return
    pointerActiveRef.current = true
    applyEvents(
      controller.pointerDown({ ...point, shiftKey: event.shiftKey, altKey: event.altKey }, ctx)
    )
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /** Ruler cursor marker: imperative DOM update, never React state (every mousemove). */
  const updateRulerCursor = (event: ReactPointerEvent): void => {
    const vp = viewportRef.current?.getBoundingClientRect()
    if (!vp) return
    rulersRef.current?.setCursorPx(event.clientX - vp.left, event.clientY - vp.top)
  }

  const onPointerMove = (event: ReactPointerEvent): void => {
    updateRulerCursor(event)
    const point = screenToWorld(event.clientX, event.clientY)
    if (!point) return
    if (pointerActiveRef.current) {
      const ctx = makeCtx(null)
      if (!ctx) return
      applyEvents(
        controller.pointerMove({ ...point, shiftKey: event.shiftKey, altKey: event.altKey }, ctx)
      )
      return
    }
    // Hover feedback: transform-handle cursors (hit-tested before canvas picking).
    const vp = viewportRef.current
    if (!vp) return
    let cursor = ''
    if (controller.tool === 'select' && selectedIdsRef.current.length > 0) {
      const bbox = unionWorldBbox(selectedIdsRef.current)
      if (bbox) {
        const handle = interact.hitHandle(bbox, point, zoomOf())
        if (handle === 'rotate') cursor = 'crosshair'
        else if (handle !== null) cursor = interact.cursorForHandle(handle)
      }
    }
    if (vp.style.cursor !== cursor) vp.style.cursor = cursor
  }

  const onPointerUp = (event: ReactPointerEvent): void => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    const point = screenToWorld(event.clientX, event.clientY)
    const ctx = makeCtx(null)
    if (!point || !ctx) return
    applyEvents(
      controller.pointerUp({ ...point, shiftKey: event.shiftKey, altKey: event.altKey }, ctx)
    )
  }

  const onPointerCancel = (): void => {
    pointerActiveRef.current = false
    applyEvents(controller.cancelGesture())
  }

  const onPointerLeaveViewport = (): void => {
    rulersRef.current?.setCursorPx(null, null)
  }

  /** Double-click a <text> (or a unit containing the click point) → edit it. */
  const onDoubleClick = (event: React.MouseEvent): void => {
    const mirror = mirrorRef.current
    const session = sessionRef.current
    if (!mirror || !session || controller.tool !== 'select') return
    let el = event.target instanceof Element ? event.target : null
    let textEl: Element | null = null
    while (el && el !== mirror) {
      if (el.localName === 'text') {
        textEl = el
        break
      }
      el = el.parentElement
    }
    if (!textEl) return
    const target = targetForElement(textEl, mirror)
    if (!target || resolveTarget(session.doc, target) === null) return
    setTextEdit({ target, isNew: false })
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
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
      return
    }
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      flushTx()
      const result = event.shiftKey ? session.history.redo() : session.history.undo()
      if (result) {
        syncMirror()
        bump()
        setSelection(selectedIdsRef.current.filter((id) => session.doc.getById(id) !== null))
      }
      return
    }
    if (mod && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      duplicateSelection()
      return
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      importInputRef.current?.click()
      return
    }
    const ctx = makeCtx(null)
    if (!ctx) return
    const toolBefore = controller.tool
    const events = controller.keyDown(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey
      },
      ctx
    )
    if (events.length > 0 || controller.tool !== toolBefore || event.key === 'Escape') {
      event.preventDefault()
    }
    applyEvents(events)
  }

  // ---- layers helpers --------------------------------------------------------
  const renameElement = (oldId: string, newId: string): void => {
    if (!applyCommand({ kind: 'set-attrs', target: oldId, attrs: { id: newId } }, 'Rename')) return
    setSelection(selectedIdsRef.current.map((id) => (id === oldId ? newId : id)))
  }

  const selectFromLayers = (id: string, additive: boolean): void => {
    if (additive) {
      const cur = selectedIdsRef.current
      setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
    } else {
      setSelection([id])
    }
    viewportRef.current?.focus()
  }

  // ---- overlay geometry (screen space) ----------------------------------------
  const vpRect = viewportRef.current?.getBoundingClientRect()
  const overlayBoxes: { id: string; left: number; top: number; width: number; height: number }[] =
    []
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

  let handleFrame: { left: number; top: number; width: number; height: number } | null = null
  const first = overlayBoxes[0]
  if (toolId === 'select' && first && !textEdit && gesture.kind !== 'marquee') {
    let left = first.left
    let top = first.top
    let right = first.left + first.width
    let bottom = first.top + first.height
    for (const b of overlayBoxes.slice(1)) {
      left = Math.min(left, b.left)
      top = Math.min(top, b.top)
      right = Math.max(right, b.left + b.width)
      bottom = Math.max(bottom, b.top + b.height)
    }
    handleFrame = { left, top, width: right - left, height: bottom - top }
  }

  let marqueeBox: { left: number; top: number; width: number; height: number } | null = null
  if (gesture.kind === 'marquee') {
    const a = worldToScreen(gesture.start.x, gesture.start.y)
    const b = worldToScreen(gesture.current.x, gesture.current.y)
    if (a && b) {
      marqueeBox = {
        left: Math.min(a.x, b.x),
        top: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y)
      }
    }
  }

  const guideSegments: { key: string; left: number; top: number; width: number; height: number }[] =
    []
  guides.forEach((g, i) => {
    const p1 = g.axis === 'x' ? worldToScreen(g.position, g.from) : worldToScreen(g.from, g.position)
    const p2 = g.axis === 'x' ? worldToScreen(g.position, g.to) : worldToScreen(g.to, g.position)
    if (!p1 || !p2) return
    if (g.axis === 'x') {
      guideSegments.push({
        key: `g${i}`,
        left: p1.x,
        top: Math.min(p1.y, p2.y),
        width: 1,
        height: Math.max(Math.abs(p2.y - p1.y), 1)
      })
    } else {
      guideSegments.push({
        key: `g${i}`,
        left: Math.min(p1.x, p2.x),
        top: p1.y,
        width: Math.max(Math.abs(p2.x - p1.x), 1),
        height: 1
      })
    }
  })

  let ghostShape: JSX.Element | null = null
  if (gesture.kind === 'create') {
    const a = worldToScreen(gesture.start.x, gesture.start.y)
    const b = worldToScreen(gesture.current.x, gesture.current.y)
    if (a && b) {
      if (gesture.tool === 'line' || gesture.tool === 'arrow') {
        ghostShape = <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      } else if (gesture.tool === 'ellipse') {
        ghostShape = (
          <ellipse
            cx={(a.x + b.x) / 2}
            cy={(a.y + b.y) / 2}
            rx={Math.abs(b.x - a.x) / 2}
            ry={Math.abs(b.y - a.y) / 2}
          />
        )
      } else {
        ghostShape = (
          <rect
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.abs(b.x - a.x)}
            height={Math.abs(b.y - a.y)}
          />
        )
      }
    }
  }

  // ---- text edit overlay layout -----------------------------------------------
  let textEditView: { layout: TextEditLayout; initialText: string } | null = null
  if (textEdit && sessionRef.current && vpRect) {
    const engineEl = resolveTarget(sessionRef.current.doc, textEdit.target)
    const mirrorEl = mirrorByTarget(textEdit.target)
    const ctm = mirrorEl instanceof SVGGraphicsElement ? mirrorEl.getScreenCTM() : null
    if (engineEl && ctm) {
      const x = firstNumber(engineEl.getAttribute('x')) ?? 0
      const y = firstNumber(engineEl.getAttribute('y')) ?? 0
      const p = new DOMPoint(x, y).matrixTransform(ctm)
      const scale = Math.hypot(ctm.a, ctm.b)
      const fontPx = Math.max((firstNumber(styleValue(engineEl, 'font-size')) ?? 10) * scale, 4)
      textEditView = {
        layout: {
          left: p.x - vpRect.left - 2,
          top: p.y - vpRect.top - fontPx * 0.9,
          fontSizePx: fontPx,
          fontFamily: styleValue(engineEl, 'font-family') ?? 'sans-serif',
          fontWeight: styleValue(engineEl, 'font-weight') ?? 'normal',
          color: styleValue(engineEl, 'fill') ?? '#000000'
        },
        initialText: engineEl.textContent ?? ''
      }
    }
  }

  if (loadError) {
    return (
      <div className="sidebar__empty">
        Could not open {fileName}: {loadError}
      </div>
    )
  }

  const doc = sessionRef.current?.doc ?? null
  const mmPerUser = doc?.artboard.mmPerUser ?? null

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
          <button
            className="canvas-tab__rulers-toggle"
            aria-pressed={rulersOn}
            title={rulersOn ? 'Hide rulers' : 'Show rulers'}
            onClick={() => setRulersOn((on) => !on)}
          >
            Rulers
          </button>
          {rootDir !== null && (
            <NewFigureButton
              rootDir={rootDir}
              className="canvas-tab__new-figure"
              inputClassName="canvas-tab__new-figure-input"
              title="New figure"
            />
          )}
          {Math.round(view.scale * 100)}%
        </span>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept=".svg,.png,image/svg+xml,image/png"
        className="canvas-tab__import-input"
        onChange={onImportInputChange}
      />
      {diagnosticsOpen && diagnostics.length > 0 && (
        <div className="canvas-diagnostics">
          {diagnostics.slice(0, 50).map((d, i) => (
            <div key={`${d.id}-${i}`} className="canvas-diagnostics__row">
              <span className={`canvas-diagnostics__dot canvas-diagnostics__dot--${d.severity}`} />
              <span className="canvas-diagnostics__rule">{d.id}</span>
              <span className="canvas-diagnostics__msg">{d.message}</span>
            </div>
          ))}
          {diagnostics.length > 50 && (
            <div className="canvas-diagnostics__row">…and {diagnostics.length - 50} more</div>
          )}
        </div>
      )}
      <div className="canvas-tab__body">
        <ToolRail tool={toolId} onSelectTool={selectTool} />
        <LayersPanel
          doc={doc}
          rev={rev}
          selectedIds={selectedIds}
          open={layersOpen}
          onToggle={() => setLayersOpen((o) => !o)}
          onSelect={selectFromLayers}
          apply={applyCommand}
          rename={renameElement}
          note={note}
        />
        <div className={`canvas-canvasarea${rulersActive ? ' canvas-canvasarea--rulers' : ''}`}>
          {rulersActive && (
            <>
              <div className="canvas-ruler-corner" />
              <Rulers ref={rulersRef} hTicks={hTicks} vTicks={vTicks} />
            </>
          )}
          <div
            ref={viewportRef}
            className={`canvas-viewport${toolId !== 'select' ? ' canvas-viewport--create' : ''}${dragOver ? ' canvas-viewport--drag' : ''}`}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={onPointerLeaveViewport}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
            onDragOver={onCanvasDragOver}
            onDragLeave={onCanvasDragLeave}
            onDrop={onCanvasDrop}
          >
            <div
              ref={worldRef}
              className="canvas-world"
              style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
            />
            {doc !== null && !hasDrawableContent(doc.root) && (
              <div className="canvas-viewport__hint">
                Drop or import a plot · ⌘⇧I import SVG/PNG · or draw with the tools
              </div>
            )}
            <div className="canvas-overlay">
              {overlayBoxes.map((box) => (
                <div
                  key={box.id}
                  className="canvas-overlay__box"
                  style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                />
              ))}
              {guideSegments.map((s) => (
                <div
                  key={s.key}
                  className="canvas-overlay__guide"
                  style={{ left: s.left, top: s.top, width: s.width, height: s.height }}
                />
              ))}
              {marqueeBox && (
                <div
                  className="canvas-overlay__marquee"
                  style={{
                    left: marqueeBox.left,
                    top: marqueeBox.top,
                    width: marqueeBox.width,
                    height: marqueeBox.height
                  }}
                />
              )}
              {ghostShape && (
                <svg className="canvas-overlay__ghost" aria-hidden="true">
                  {ghostShape}
                </svg>
              )}
              {handleFrame && (
                <>
                  <div
                    className="canvas-overlay__rotate"
                    style={{
                      left: handleFrame.left + handleFrame.width / 2,
                      top: handleFrame.top - interact.ROTATE_HANDLE_OFFSET
                    }}
                  />
                  {HANDLE_POS.map((h) => (
                    <div
                      key={h.id}
                      className="canvas-overlay__handle"
                      data-handle={h.id}
                      style={{
                        left: handleFrame.left + handleFrame.width * h.fx,
                        top: handleFrame.top + handleFrame.height * h.fy
                      }}
                    />
                  ))}
                </>
              )}
            </div>
            {textEdit && textEditView && (
              <TextEditOverlay
                key={textEdit.target}
                layout={textEditView.layout}
                initialText={textEditView.initialText}
                selectAll={textEdit.isNew}
                onCommit={commitTextEdit}
                onCancel={cancelTextEdit}
              />
            )}
          </div>
        </div>
        <PropertiesPanel
          doc={doc}
          rev={rev}
          selectedIds={selectedIds}
          open={propsOpen}
          onToggle={() => setPropsOpen((o) => !o)}
          mmPerUser={mmPerUser}
          profile={profile}
          worldBboxOf={worldBboxOf}
          rotationOf={rotationOf}
          apply={applyCommand}
          gestureApply={gestureApplyCommand}
          rootDir={rootDir}
          figureId={figureId}
          diagnostics={diagnostics}
          note={note}
          save={save}
          captureForAgent={captureForAgent}
          afterAgentEdit={afterAgentEdit}
        />
      </div>
    </div>
  )
}
