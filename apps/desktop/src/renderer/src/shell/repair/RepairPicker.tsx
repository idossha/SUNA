/**
 * "Repair this UI" picker (DECISIONS 2026-08-17, dev-only — the 'ai.repairUi'
 * command in state/commands.ts is gated on import.meta.env.DEV and is the
 * only caller of startRepairPick). Pick mode is a full-screen crosshair
 * layer (`.repair-picker`, a §7 probe selector) that tracks the element
 * under the pointer, outlines it gold, and freezes it on click into a small
 * report dialog. Send writes the bundle via 'ai:repair-bundle' FIRST — the
 * on-disk bundle is the fallback when no CLI is installed — then hands the
 * composed prompt to runUiRepair; progress and the outcome surface as
 * status notes keyed by aiActions['repair'].
 *
 * The layer itself receives the pointer events (so the app underneath never
 * sees a stray click while picking); the hovered element is read with
 * document.elementsFromPoint, skipping the layer's own nodes.
 */
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { create } from 'zustand'
import { runUiRepair } from '../../ai/directedActions'
import { REPAIR_RUN_KEY, useAiActionsStore } from '../../state/aiActions'
import { activePanelComponent } from '../../state/dock'
import { useUiStore } from '../../state/ui'
import {
  DOM_PATH_MAX,
  entryLabel,
  formatDomPath,
  slugForReport,
  type DomPathEntry
} from './repair-report'
import './repair.css'

interface PlainRect {
  x: number
  y: number
  width: number
  height: number
}

/** Everything the report needs, snapshotted at click time — the element itself may unmount later. */
interface RepairTarget {
  /** Target-first tag.class path entries, capped at DOM_PATH_MAX. */
  entries: DomPathEntry[]
  classList: string[]
  dataAttrs: Record<string, string>
  rect: PlainRect
}

type RepairPhase = { kind: 'idle' } | { kind: 'pick' } | { kind: 'report'; target: RepairTarget }

interface RepairPickerState {
  phase: RepairPhase
  setPhase: (phase: RepairPhase) => void
}

const useRepairPickerStore = create<RepairPickerState>((set) => ({
  phase: { kind: 'idle' },
  setPhase: (phase) => set({ phase })
}))

/** Enter pick mode. Exported for the 'ai.repairUi' command — the one entry point. */
export function startRepairPick(): void {
  useRepairPickerStore.getState().setPhase({ kind: 'pick' })
}

function snapshotTarget(el: Element): RepairTarget {
  const entries: DomPathEntry[] = []
  let cur: Element | null = el
  while (cur !== null && entries.length < DOM_PATH_MAX && cur !== document.documentElement) {
    entries.push({ tag: cur.tagName.toLowerCase(), classes: [...cur.classList] })
    cur = cur.parentElement
  }
  const dataAttrs: Record<string, string> = {}
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-')) dataAttrs[attr.name] = attr.value
  }
  // capture-rect takes PAGE coordinates; add the scroll offset like
  // CanvasTab's captureForAgent does (identity today — the shell root never
  // scrolls — but two callers of one contract must agree on its terms).
  const r = el.getBoundingClientRect()
  return {
    entries,
    classList: [...el.classList],
    dataAttrs,
    rect: { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }
  }
}

/**
 * Bundle + prompt + run. Fire-and-forget from the dialog's Send: the dialog
 * closes immediately and every step reports through the status bar, so
 * nothing here depends on the picker staying mounted.
 */
async function sendReport(target: RepairTarget, report: string): Promise<void> {
  const setStatusNote = (note: string): void => useUiStore.getState().setStatusNote(note)
  try {
    const dev = await window.suna.invoke('app:dev-info', {})
    if (!dev.isDev || dev.repoRoot === null) {
      setStatusNote('Repair this UI is dev-only — a packaged app has no source repo.')
      return
    }
    // The same shape lands in context.json and in the prompt's CONTEXT block
    // (§5). `report` is added on disk so the bundle stays a complete bug
    // report even when no CLI is installed — the bundle IS the fallback.
    const context = {
      domPath: formatDomPath(target.entries),
      classList: target.classList,
      dataAttrs: target.dataAttrs,
      rect: target.rect,
      activePanelComponent: activePanelComponent(),
      activeView: useUiStore.getState().activeView,
      appVersion: 'SUNA 0.1',
      platform: window.suna.platform
    }
    const hasArea = target.rect.width > 0 && target.rect.height > 0
    const bundle = await window.suna.invoke('ai:repair-bundle', {
      slug: slugForReport(report),
      contextJson: JSON.stringify({ ...context, report }, null, 2),
      ...(hasArea ? { rect: target.rect } : {})
    })
    setStatusNote(`Report saved → ${bundle.bundleDir}`)
    await runUiRepair({
      bundleDir: bundle.bundleDir,
      shotPath: bundle.shotPath,
      context,
      report,
      repoRoot: dev.repoRoot
    })
  } catch (error) {
    setStatusNote(`Repair report failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface Hover {
  rect: PlainRect
  label: string
}

export function RepairPicker(): JSX.Element | null {
  const phase = useRepairPickerStore((s) => s.phase)
  const setPhase = useRepairPickerStore((s) => s.setPhase)
  const repairRun = useAiActionsStore((s) => s.runs[REPAIR_RUN_KEY])
  const [hover, setHover] = useState<Hover | null>(null)
  const [report, setReport] = useState('')
  const layerRef = useRef<HTMLDivElement | null>(null)

  // §5: progress surfaces as a status note. The final success/error note is
  // pushed by directedActions after finish(), which lands after this effect's
  // undefined tick — so the two writers never fight over the last word.
  useEffect(() => {
    if (repairRun !== undefined) {
      useUiStore.getState().setStatusNote(`✦ Repair: ${repairRun.note}`)
    }
  }, [repairRun])

  // Esc exits pick mode (and abandons the report dialog). Capture phase +
  // stopPropagation: while the picker is up, Esc must not also deselect in
  // the canvas or close another overlay underneath.
  useEffect(() => {
    if (phase.kind === 'idle') return
    setHover(null)
    setReport('')
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      useRepairPickerStore.getState().setPhase({ kind: 'idle' })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [phase.kind])

  if (phase.kind === 'idle') return null

  const pickAt = (x: number, y: number): Element | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (layerRef.current !== null && layerRef.current.contains(el)) continue
      if (el === document.documentElement || el === document.body) continue
      return el
    }
    return null
  }

  const onMouseMove = (event: ReactMouseEvent): void => {
    if (phase.kind !== 'pick') return
    const el = pickAt(event.clientX, event.clientY)
    if (el === null) {
      setHover(null)
      return
    }
    const r = el.getBoundingClientRect()
    setHover({
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      label: entryLabel({ tag: el.tagName.toLowerCase(), classes: [...el.classList] })
    })
  }

  const onLayerClick = (event: ReactMouseEvent): void => {
    if (phase.kind === 'pick') {
      const el = pickAt(event.clientX, event.clientY)
      if (el === null) return
      setPhase({ kind: 'report', target: snapshotTarget(el) })
      return
    }
    // report phase: a click outside the dialog (which stops propagation) abandons it
    setPhase({ kind: 'idle' })
  }

  const outline = phase.kind === 'report' ? phase.target.rect : hover?.rect ?? null
  const firstEntry = phase.kind === 'report' ? phase.target.entries[0] : undefined
  const label = phase.kind === 'report' ? (firstEntry ? entryLabel(firstEntry) : '') : hover?.label ?? ''
  const busy = repairRun !== undefined

  const send = (): void => {
    if (phase.kind !== 'report' || report.trim() === '' || busy) return
    const { target } = phase
    const text = report
    setPhase({ kind: 'idle' })
    void sendReport(target, text)
  }

  return (
    <div
      ref={layerRef}
      className={phase.kind === 'pick' ? 'repair-picker repair-picker--pick' : 'repair-picker'}
      onMouseMove={onMouseMove}
      onClick={onLayerClick}
    >
      {outline !== null && (
        <div
          className="repair-picker__outline"
          style={{
            left: `${outline.x}px`,
            top: `${outline.y}px`,
            width: `${outline.width}px`,
            height: `${outline.height}px`
          }}
        />
      )}
      {outline !== null && label !== '' && (
        <div
          className="repair-picker__tag"
          style={{ left: `${outline.x}px`, top: `${Math.max(4, outline.y - 22)}px` }}
        >
          {label}
        </div>
      )}
      {phase.kind === 'pick' && (
        <div className="repair-picker__hint">Click the broken element · Esc to cancel</div>
      )}
      {phase.kind === 'report' && (
        <div
          className="repair-picker__dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Report / repair this UI"
          onClick={(e: ReactMouseEvent) => e.stopPropagation()}
        >
          <div className="repair-picker__identity" title={formatDomPath(phase.target.entries)}>
            {label}
          </div>
          <textarea
            className="repair-picker__prompt"
            rows={3}
            autoFocus
            placeholder="What is wrong here?"
            value={report}
            onChange={(e) => setReport(e.target.value)}
          />
          <div className="repair-picker__actions">
            <button type="button" onClick={() => setPhase({ kind: 'idle' })}>
              Cancel
            </button>
            <button
              type="button"
              className="repair-picker__send"
              disabled={report.trim() === '' || busy}
              title={busy ? 'A repair run is already in flight' : undefined}
              onClick={send}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
