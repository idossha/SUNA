import { useEffect, useRef, useState, type JSX } from 'react'
import { AI_EFFORTS, AI_MODELS, peerReviewAiApproved, type AiEffort, type AiModel } from '@suna/core'
import { cliGate, runPointReply, type PointReplyArgs } from '../ai/directedActions'
import { AI_EFFORT_LABELS, AI_MODEL_LABELS, aiChoiceLabel } from '../settings/aiChoice'
import { pointRunKey, useAiActionsStore } from '../state/aiActions'
import { useProjectStore } from '../state/project'
import { PeerReviewApprovalSheet } from './PeerReviewApprovalSheet'
import './documents.css'

/**
 * The ✦ button beside one reply box, and everything that follows from
 * pressing it (document-kinds-ux.md §C).
 *
 * Three decisions shape this component.
 *
 * **The draft never lands in the box by itself.** The reply is signed by the
 * author and read by a referee; prose that arrives while they are looking
 * elsewhere is prose nobody chose. So the answer comes back into a proposal
 * panel with the author's own text still intact beside it, and `Use this` is
 * a deliberate act. Discarding is free and leaves no trace.
 *
 * **Waiting is a state worth rendering.** The agent reads the manuscript
 * before it answers, which takes tens of seconds — long enough that a button
 * which merely dimmed would read as broken. The busy strip says what the
 * agent is doing right now, from the CLI's own progress lines, and offers
 * Cancel throughout.
 *
 * **AI drafting is gated on a recorded human approval.** Until somebody has
 * read `context/PEER-REVIEW.md` and accepted it (the record lives in
 * suna.json), this renders one button that opens that screen and nothing
 * else. No banner announces the gate elsewhere: you meet it exactly where
 * you reach for the feature, which is the only place it is relevant.
 *
 * **Model and effort are per-run, and remembered per-session.** A one-line
 * "the reviewer means Figure 2" reply does not want the same model as a
 * methodological rebuttal, so the choice sits one click away on the card
 * rather than in Settings. It defaults to the project setting and is sticky
 * within the session, because whoever changes it is usually about to answer
 * eleven more points the same way.
 */

/** Per-session stickiness, deliberately not persisted: a model chosen for one
 * round's rebuttals should not silently govern next year's. */
let lastModel: AiModel | null = null
let lastEffort: AiEffort | null = null

export interface ReplyAssistantProps {
  /** Everything the prompt needs except the mode and the per-run overrides. */
  context: Omit<PointReplyArgs, 'mode' | 'model' | 'effort'>
  /** The reply as the box currently has it — decides Draft vs Polish. */
  currentReply: string
  /** Accept: replace the box's text with the proposal. */
  onAccept: (text: string) => void
  /** Approved guidelines, so the tab can feed them to every other card. */
  onGuidelinesApproved: (text: string) => void
}

export function ReplyAssistant({
  context,
  currentReply,
  onAccept,
  onGuidelinesApproved
}: ReplyAssistantProps): JSX.Element {
  const key = pointRunKey(context.pointId)
  const run = useAiActionsStore((s) => s.runs[key])
  const proposal = useAiActionsStore((s) => s.proposals[key])
  const clearProposal = useAiActionsStore((s) => s.clearProposal)

  const [open, setOpen] = useState(false)
  const [model, setModel] = useState<AiModel | null>(lastModel)
  const [effort, setEffort] = useState<AiEffort | null>(lastEffort)
  const [gate, setGate] = useState<{ ok: boolean; reason?: string } | null>(null)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const approved = useProjectStore((s) => peerReviewAiApproved(s.manifest?.approvals))
  const [note, setNote] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const hasReply = currentReply.trim() !== ''

  // The CLI probe is a round trip; do it once when the menu first opens
  // rather than on every card in a 84-point round.
  useEffect(() => {
    if (!open || gate !== null) return
    void cliGate().then(setGate)
  }, [open, gate])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current?.contains(e.target as Node) === false) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const start = (mode: 'draft' | 'polish'): void => {
    setOpen(false)
    setNote(null)
    lastModel = model
    lastEffort = effort
    void runPointReply({
      ...context,
      mode,
      currentReply,
      ...(model === null ? {} : { model }),
      ...(effort === null ? {} : { effort })
    }).then((outcome) => {
      if (outcome.text === null) setNote(outcome.error ?? 'The AI action failed.')
    })
  }

  const busy = run !== undefined
  const primary: 'draft' | 'polish' = hasReply ? 'polish' : 'draft'

  if (!approved) {
    return (
      <div className="reply-ai">
        <div className="reply-ai__bar">
          <span className="reply-ai__ctx" title="SUNA drafts nothing until a person has read and accepted the guidelines it would follow">
            AI replies are off for this project
          </span>
          <button className="reply-ai__go" onClick={() => setApprovalOpen(true)}>
            <span aria-hidden="true">✦</span> Enable AI replies…
          </button>
        </div>
        {approvalOpen && (
          <PeerReviewApprovalSheet
            rootDir={context.rootDir}
            onClose={() => setApprovalOpen(false)}
            onApproved={onGuidelinesApproved}
          />
        )}
      </div>
    )
  }

  return (
    <div className="reply-ai">
      <div className="reply-ai__bar">
        <span className="reply-ai__ctx" title="What the agent is given: the reviewer’s words in context, every reply already written in this round, the manuscript itself, and context/PEER-REVIEW.md">
          reads the paper first
        </span>
        <button
          className="reply-ai__go"
          disabled={busy}
          onClick={() => start(primary)}
          title={
            primary === 'polish'
              ? 'Rework the reply you have written, keeping its position'
              : 'Draft a reply from the manuscript and this project’s conventions'
          }
        >
          <span aria-hidden="true">✦</span> {primary === 'polish' ? 'Polish' : 'Draft'}
        </button>
        <div className="reply-ai__menu-wrap" ref={menuRef}>
          <button
            className="reply-ai__more"
            aria-label="AI options"
            aria-expanded={open}
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
            title={model === null && effort === null ? 'AI options' : aiChoiceLabel(model ?? 'sonnet', effort ?? 'medium')}
          >
            ▾
          </button>
          {open && (
            <div className="reply-ai__menu" role="menu">
              <button
                role="menuitem"
                onClick={() => start(primary === 'polish' ? 'draft' : 'polish')}
                disabled={primary === 'draft' && !hasReply}
                title={
                  primary === 'polish'
                    ? 'Ignore what is written and draft a fresh reply'
                    : 'There is nothing written to polish yet'
                }
              >
                {primary === 'polish' ? '✦ Draft from scratch instead' : '✦ Polish what is written'}
              </button>
              <hr />
              <label>
                Model
                <select
                  value={model ?? ''}
                  onChange={(e) => setModel(e.target.value === '' ? null : (e.target.value as AiModel))}
                >
                  <option value="">Project default</option>
                  {AI_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {AI_MODEL_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Effort
                <select
                  value={effort ?? ''}
                  onChange={(e) => setEffort(e.target.value === '' ? null : (e.target.value as AiEffort))}
                >
                  <option value="">Project default</option>
                  {AI_EFFORTS.map((x) => (
                    <option key={x} value={x}>
                      {AI_EFFORT_LABELS[x]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="reply-ai__hint">
                For this point only. A one-line clarification does not need what a
                methodological rebuttal needs.
              </p>
              {gate !== null && !gate.ok && <p className="reply-ai__gate">{gate.reason}</p>}
            </div>
          )}
        </div>
      </div>

      {busy && (
        <div className="reply-ai__busy" role="status" aria-live="polite">
          <span className="reply-ai__pulse" aria-hidden="true" />
          <span className="reply-ai__busy-body">
            <strong>{primary === 'polish' ? 'Polishing this reply…' : 'Drafting this reply…'}</strong>
            <span className="reply-ai__busy-note">{run.note}</span>
          </span>
          <button className="reply-ai__cancel" onClick={() => run.cancel()}>
            Cancel
          </button>
        </div>
      )}

      {proposal !== undefined && !busy && (
        <div className="reply-ai__proposal">
          <header>
            <strong>Proposed reply</strong>
            <span>Nothing has been written to your reply yet.</span>
          </header>
          <div className="reply-ai__proposal-text">{proposal}</div>
          <div className="reply-ai__proposal-acts">
            <button
              className="reply-ai__accept"
              onClick={() => {
                onAccept(proposal)
                clearProposal(key)
              }}
            >
              {hasReply ? 'Replace my reply' : 'Use this'}
            </button>
            {hasReply && (
              <button
                onClick={() => {
                  onAccept(`${currentReply.trimEnd()}\n\n${proposal}`)
                  clearProposal(key)
                }}
                title="Keep what you wrote and add this underneath"
              >
                Append
              </button>
            )}
            <button onClick={() => clearProposal(key)}>Discard</button>
          </div>
        </div>
      )}

      {note !== null && <p className="reply-ai__error">{note}</p>}
    </div>
  )
}
