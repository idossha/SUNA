import { useEffect, useState, type JSX } from 'react'
import { cliGate, runFigureEdit, type CliGateResult } from '../ai/directedActions'
import { figureRunKey, useAiActionsStore } from '../state/aiActions'
import { complianceLines, selectionReadout } from './agent-section'
import { activeCanvasPaletteContext } from './palette-actions'

/**
 * Agent section (feature-plan-8 §4): send the current selection + a prompt
 * to the headless agent CLI as a directed figure edit. Identity for the
 * BUSY key comes from props (per-tab correct even while dockview hides the
 * panel); the send-time facts — rootDir, doc, profile, fresh compliance —
 * come from the CanvasPaletteContext seam, which resolves to this tab
 * because only the visible tab's Send is clickable.
 */

interface AgentSectionProps {
  figureId: string | null
  selectedIds: string[]
  /** CanvasTab's §4 capture: selection union (or artboard) → PNG; null = no screenshot. */
  captureForAgent: () => Promise<{ path: string; ids: string[] } | null>
  /** CanvasTab's §4 success hook: reload figure.svg from disk, or warn when dirty. */
  afterAgentEdit: () => Promise<void>
}

/** Shown on Send until the one cliGate round trip resolves. */
const GATE_PENDING: CliGateResult = { ok: false, reason: 'Checking for an AI CLI…' }

export function AgentSection(props: AgentSectionProps): JSX.Element {
  const { figureId, selectedIds } = props
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)
  const [gate, setGate] = useState<CliGateResult>(GATE_PENDING)
  const run = useAiActionsStore((s) =>
    figureId !== null ? s.runs[figureRunKey(figureId)] : undefined
  )

  useEffect(() => {
    let stale = false
    void cliGate().then((g) => {
      if (!stale) setGate(g)
    })
    return () => {
      stale = true
    }
  }, [])

  const busy = sending || run !== undefined
  const sendable = gate.ok && !busy && figureId !== null && instruction.trim() !== ''

  const send = async (): Promise<void> => {
    if (!sendable) return
    const context = activeCanvasPaletteContext()
    if (context === null || context.figureId !== figureId) return
    setSending(true)
    try {
      // Capture first — the gold selection overlay is deliberately in shot,
      // and the prompt tells the agent that is what "the selection" means.
      const capture = await props.captureForAgent()
      const artboard = context.doc.artboard
      const round = (n: number | null): number => (n === null ? 0 : Math.round(n * 10) / 10)
      const outcome = await runFigureEdit({
        rootDir: context.rootDir,
        figureId: context.figureId,
        svgPath: `${context.rootDir}/figures/${context.figureId}/figure.svg`,
        artboardMm: { width: round(artboard.widthMm), height: round(artboard.heightMm) },
        selectedIds: capture?.ids ?? selectedIds,
        screenshotPath: capture?.path ?? null,
        profileName: context.profile?.id ?? null,
        // Re-run rather than trust the tab's cached list — it only refreshes
        // on load/save, and the user may have edited since.
        complianceIssues: complianceLines(context.runCompliance()),
        instruction: instruction.trim()
      })
      if (outcome.text !== null) {
        setInstruction('')
        await props.afterAgentEdit()
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="canvas-props__section canvas-agent">
      <div className="canvas-props__title">Agent</div>
      <div className="canvas-agent__target">{selectionReadout(selectedIds)}</div>
      <textarea
        className="canvas-agent__prompt"
        rows={2}
        placeholder="Describe the edit…"
        value={instruction}
        disabled={busy}
        spellCheck={false}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
        }}
      />
      {run !== undefined && (
        <div className="canvas-agent__busy">
          <span className="canvas-agent__note">✦ {run.note}</span>
          <button className="canvas-figure__action canvas-agent__cancel" onClick={() => run.cancel()}>
            Cancel
          </button>
        </div>
      )}
      <button
        className="canvas-figure__action canvas-agent__send"
        disabled={!sendable}
        title={gate.ok ? 'Send the selection and prompt to the AI agent' : gate.reason}
        onClick={() => void send()}
      >
        ✦ Send to agent
      </button>
    </div>
  )
}
