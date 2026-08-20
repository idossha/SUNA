import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { EditorView } from '@codemirror/view'
import type { CoverLetterMeta, DocumentEntry, LetterAssertion } from '@suna/core'
import { assertionAnswered, assertionFor } from '@suna/core'
import { getBundledProfile, type Diagnostic } from '@suna/formatter'
import type { AssertionRequirement } from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { ManuscriptEditor, type ManuscriptEditorHandle } from '../manuscript/ManuscriptEditor'
import { RailToggleButton } from '../comments/RailToggleButton'
import { CommentsRail } from '../comments/CommentsRail'
import { useCommentsStore } from '../state/comments'
import { docSlice, useManuscriptDocStore } from '../state/manuscriptDoc'
import { useAiActionsStore } from '../state/aiActions'
import { letterRunKey } from '../ai/directedActions'
import './documents.css'

/**
 * The letter tab (document-kinds-ux.md §A.5).
 *
 * ManuscriptTab's shape minus the title page, plus an Assertions panel.
 *
 * The panel is the point of the whole feature. A cover letter makes factual
 * claims on the author's behalf — not under consideration elsewhere, no
 * competing interests, a named colleague has read it — over the author's
 * signature. Those are not prose here and no agent can write them: they are a
 * form only a person fills, and an unanswered one shows in the editor as
 * ⟦ unanswered — id ⟧ and blocks export.
 */

export function LetterTab({ api, params }: DockPanelProps): JSX.Element {
  const rootDir = String(params?.['rootDir'] ?? '')
  const documentId = String(params?.['documentId'] ?? '')
  const editorRef = useRef<ManuscriptEditorHandle>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const getEditorView = useCallback((): EditorView | null => editorRef.current?.getView() ?? null, [])
  const getScrollElement = useCallback((): HTMLElement | null => rootRef.current, [])
  const allComments = useCommentsStore((s) => s.comments)
  // A directed run survives this component unmounting (dockview detaches
  // hidden panels), so the working state is read from the store rather than
  // held here.
  const draftRun = useAiActionsStore((s) => s.runs[letterRunKey(documentId)])

  const [doc, setDoc] = useState<DocumentEntry | null>(null)
  const [meta, setMeta] = useState<CoverLetterMeta | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { documents } = await window.suna.invoke('documents:list', { dir: rootDir })
      const entry = documents.find((d) => d.id === documentId) ?? null
      setDoc(entry)
      if (entry?.meta != null) {
        const res = await window.suna.invoke('letter:read', { dir: rootDir, metaFile: entry.meta })
        setMeta(res.meta)
      }
      const check = await window.suna.invoke('letter:check', { dir: rootDir, documentId })
      setDiagnostics(check.diagnostics as Diagnostic[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rootDir, documentId])

  useEffect(() => {
    void load()
  }, [load])

  // Announce mount and frontmost state so the Documents sidebar's outline
  // follows this letter rather than staying on the manuscript.
  useEffect(() => {
    const store = useManuscriptDocStore.getState()
    store.setTabMounted(documentId, true)
    store.setTabActive(documentId, api.isActive)
    const disposable = api.onDidActiveChange(({ isActive }) => {
      useManuscriptDocStore.getState().setTabActive(documentId, isActive)
    })
    return () => {
      disposable.dispose()
      useManuscriptDocStore.getState().forgetDocument(documentId)
    }
  }, [api, documentId])

  // Outline-click -> scroll, the same request the manuscript tab consumes.
  const scrollRequest = useManuscriptDocStore((s) => docSlice(s, documentId).scrollRequest)
  useEffect(() => {
    if (scrollRequest === null) return
    const view = editorRef.current?.getView()
    const slice = docSlice(useManuscriptDocStore.getState(), documentId)
    const section = slice.outline[scrollRequest.index]
    if (view !== null && view !== undefined && section !== undefined) {
      view.dispatch({ effects: [], selection: { anchor: Math.min(section.from, view.state.doc.length) } })
      const coords = view.coordsAtPos(Math.min(section.from, view.state.doc.length))
      const scroller = rootRef.current
      if (coords !== null && scroller !== null) {
        scroller.scrollTop += coords.top - scroller.getBoundingClientRect().top - 24
      }
    }
    useManuscriptDocStore.getState().consumeScrollRequest(documentId, scrollRequest.nonce)
  }, [scrollRequest, documentId])

  const save = async (next: CoverLetterMeta): Promise<void> => {
    if (doc?.meta == null) return
    setMeta(next)
    try {
      await window.suna.invoke('letter:write', { dir: rootDir, metaFile: doc.meta, meta: next })
      const check = await window.suna.invoke('letter:check', { dir: rootDir, documentId })
      setDiagnostics(check.diagnostics as Diagnostic[])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const profile = useMemo(
    () => (meta === null ? null : getBundledProfile(meta.targetProfileId)),
    [meta]
  )

  if (error !== null && doc === null) return <div className="letter letter--empty">{error}</div>
  if (doc === null || meta === null) return <div className="letter letter--empty">Loading…</div>

  return (
    <div className="letter">
      <header className="letter__head">
        <div>
          <h2>{doc.title}</h2>
          <span className="letter__sub">
            {meta.letterKind} · addressed to {profile?.journalName ?? meta.targetProfileId}
          </span>
        </div>
        <div className="letter__tools">
          <RailToggleButton docPath={doc.file} />
        </div>
      </header>

      {draftRun !== undefined && (
        <div className="letter__drafting" role="status" aria-live="polite">
          <span className="letter__drafting-pulse" aria-hidden="true" />
          <span className="letter__drafting-body">
            <strong>Drafting the letter…</strong>
            <span className="letter__drafting-note">{draftRun.note}</span>
          </span>
          <span className="letter__drafting-hint">
            The agent is reading the manuscript first. The draft arrives in one piece,
            as a change you review.
          </span>
          <button className="letter__drafting-cancel" onClick={() => draftRun.cancel()}>
            Cancel
          </button>
        </div>
      )}

      <div className="letter__body" ref={rootRef}>
        <div className={`letter__editor${draftRun === undefined ? '' : ' is-drafting'}`}>
          {doc.file !== null && (
            <ManuscriptEditor
              ref={editorRef}
              rootDir={rootDir}
              documentId={doc.id}
              contentPath={doc.file}
              live
              onSettled={() => undefined}
              onOutlineChange={(outline) =>
                useManuscriptDocStore.getState().setOutline(documentId, outline)
              }
            />
          )}
        </div>

        <AssertionsPanel
          meta={meta}
          requirements={profile?.letters?.assertions ?? []}
          journalName={profile?.journalName ?? meta.targetProfileId}
          hasRules={profile?.letters !== undefined}
          diagnostics={diagnostics}
          onChange={(next) => void save(next)}
        />

        {doc.file !== null && (
          <CommentsRail
            comments={allComments.filter(
              (c) => c.target.kind === 'section' && c.target.path === doc.file
            )}
            docPath={doc.file}
            getView={getEditorView}
            getScrollElement={getScrollElement}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The affidavit. Every requirement the venue states, what the author has said
 * about it, and the venue's own sentence with its source.
 */
function AssertionsPanel(props: {
  meta: CoverLetterMeta
  requirements: readonly AssertionRequirement[]
  journalName: string
  hasRules: boolean
  diagnostics: readonly Diagnostic[]
  onChange: (next: CoverLetterMeta) => void
}): JSX.Element {
  const { meta, requirements } = props
  const [open, setOpen] = useState<string | null>(null)

  const upsert = (id: string, patch: Partial<LetterAssertion>): void => {
    const existing = assertionFor(meta, id as LetterAssertion['id'])
    const next: LetterAssertion = {
      id: id as LetterAssertion['id'],
      placement: existing?.placement ?? 'directive',
      text: existing?.text ?? null,
      reason: existing?.reason ?? null,
      ...patch
    }
    props.onChange({
      ...meta,
      assertions: [...meta.assertions.filter((a) => a.id !== id), next].sort((a, b) =>
        a.id.localeCompare(b.id)
      )
    })
  }

  const errors = props.diagnostics.filter((d) => d.severity === 'error').length

  return (
    <aside className="assert">
      <header>
        <h3>Assertions</h3>
        {errors > 0 && <span className="assert__badge">{errors}</span>}
      </header>

      {!props.hasRules && (
        <p className="assert__unknown">
          Nobody has researched {props.journalName}’s cover-letter requirements yet, so nothing
          here is checked. That is not the same as this letter being compliant.
        </p>
      )}

      <ul className="assert__list">
        {requirements.map((req) => {
          const answer = assertionFor(meta, req.id)
          const answered = assertionAnswered(answer)
          const isOpen = open === req.id
          return (
            <li key={req.id} className={`assert__row is-${req.stance}${answered ? ' is-done' : ''}`}>
              <button className="assert__row-head" onClick={() => setOpen(isOpen ? null : req.id)}>
                <span className="assert__mark">{answered ? '✓' : req.stance === 'required' ? '✗' : '○'}</span>
                <span className="assert__id">{req.id}</span>
                <span className="assert__stance">{req.stance}</span>
              </button>

              {isOpen && (
                <div className="assert__detail">
                  <div className="assert__placements">
                    {(['directive', 'inline-prose', 'submission-form', 'not-applicable'] as const).map(
                      (p) => (
                        <button
                          key={p}
                          className={answer?.placement === p ? 'is-on' : ''}
                          onClick={() => upsert(req.id, { placement: p })}
                        >
                          {p.replace('-', ' ')}
                        </button>
                      )
                    )}
                  </div>

                  {answer?.placement === 'not-applicable' ? (
                    <textarea
                      placeholder="Why does this not apply? A reason is required."
                      defaultValue={answer.reason ?? ''}
                      onBlur={(e) =>
                        upsert(req.id, { reason: e.target.value.trim() === '' ? null : e.target.value })
                      }
                    />
                  ) : (
                    <textarea
                      placeholder="Your words. SUNA never writes this, and neither does the agent."
                      defaultValue={answer?.text ?? ''}
                      onBlur={(e) =>
                        upsert(req.id, { text: e.target.value.trim() === '' ? null : e.target.value })
                      }
                    />
                  )}

                  <p className="assert__source">
                    {req.quote !== null ? (
                      <>“{req.quote}”</>
                    ) : (
                      <>
                        {props.journalName} states this
                        {req.basis === 'documented-indexed' && (
                          <> — recorded from a search index; its own page refuses to be fetched</>
                        )}
                        .
                      </>
                    )}
                    {req.source !== null && (
                      <>
                        {' '}
                        <a href={req.source} onClick={(e) => e.preventDefault()} title={req.source}>
                          source
                        </a>
                      </>
                    )}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {props.diagnostics.length > 0 && (
        <div className="assert__diags">
          <h4>Before you send</h4>
          <ul>
            {props.diagnostics.map((d, i) => (
              <li key={i} className={`is-${d.severity}`}>
                {d.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
