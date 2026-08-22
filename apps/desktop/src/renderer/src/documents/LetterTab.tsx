import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { EditorView } from '@codemirror/view'
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
import { useDocSessionMeta } from '../state/docSessions'
import { useUiStore } from '../state/ui'
import { useEditorSettings } from '../editor/settings'
import { DivergenceBanner } from '../editor/DivergenceBanner'
import { ReviewBar } from '../editor/ReviewBar'
import { DOC_MODE_OPTIONS, nextDocMode, type DocViewMode, type EditorViewMode } from '../editor/settings'
import { DocumentPages } from '../export/DocumentPages'
import { SegmentedControl } from '../shell/SegmentedControl'
import { getResolved, useResolved } from '../state/settings'
import { editorThemeClass } from '../editor/themes'
import { SettingsPopover } from '../editor/SettingsPopover'
import { GearIcon } from '../editor/GearIcon'
import { NewDocumentMenu } from './NewDocumentMenu'
import { notifyExported } from '../export/exportToast'
import { manuscriptStyleVars } from '../manuscript/msdocStyle'
import '../editor/editor.css'
import '../manuscript/manuscript.css'
import './documents.css'

/** Same labels as the manuscript tab's toolbar, so the two read alike. */
/** .msdoc__toolbar's height — kept clear when scrolling to a heading. */
const TOOLBAR_HEIGHT_PX = 40

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
  const wrapRef = useRef<HTMLDivElement>(null)
  const [settled, setSettled] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // A letter is prose, and it is written with the same instrument as the
  // manuscript: the same typography settings, the same reading/source
  // toggle, the same theme. Subscribed field-by-field so a change in the
  // popover reflows this tab live (manuscript/ManuscriptTab does the same).
  const contentWidthCh = useEditorSettings((s) => s.contentWidthCh)
  const fontSizePx = useEditorSettings((s) => s.fontSizePx)
  const fontFamily = useEditorSettings((s) => s.fontFamily)
  const lineHeight = useEditorSettings((s) => s.lineHeight)
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  const defaultMode = useResolved('editor.defaultMode').value as EditorViewMode
  const [mode, setMode] = useState<DocViewMode>(() => getResolved('editor.defaultMode').value)
  const userPickedModeRef = useRef(false)

  /** One place both the segmented control and ⌘E land in. */
  const pickMode = useCallback((next: DocViewMode): void => {
    userPickedModeRef.current = true
    editorRef.current?.setLive(next === 'reading')
    setMode(next)
  }, [])

  // ⌘E still cycles. The control shows every mode, so the shortcut is now a
  // convenience rather than the only way to discover the others.
  const toggleMode = useCallback((): void => {
    userPickedModeRef.current = true
    setMode((current) => {
      const next = nextDocMode(current)
      editorRef.current?.setLive(next === 'reading')
      return next
    })
  }, [])

  // adopt the persisted default until the user picks a mode with ⌘E
  useEffect(() => {
    if (userPickedModeRef.current) return
    setMode(defaultMode)
    editorRef.current?.setLive(defaultMode === 'reading')
  }, [defaultMode])

  // ⌘E reading ⇄ source, ⌘⌥M the comments rail — the manuscript tab's keys.
  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 'e') {
        event.preventDefault()
        toggleMode()
      }
      if (event.altKey && (event.key === 'm' || event.code === 'KeyM')) {
        event.preventDefault()
        useUiStore.getState().toggleCommentsRail()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
  }, [toggleMode])

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

  // Outline-click -> scroll, through CodeMirror's own ancestor-aware
  // scrollIntoView (the manuscript tab's mechanism), held until the editor
  // has settled — scrolling earlier targets a view that does not exist yet.
  const scrollRequest = useManuscriptDocStore((s) => docSlice(s, documentId).scrollRequest)
  useEffect(() => {
    if (scrollRequest === null || !settled) return
    const view = editorRef.current?.getView()
    const slice = docSlice(useManuscriptDocStore.getState(), documentId)
    const section = slice.outline[scrollRequest.index]
    if (view !== null && view !== undefined && section !== undefined) {
      view.dispatch({
        effects: EditorView.scrollIntoView(section.headingFrom, {
          y: 'start',
          yMargin: TOOLBAR_HEIGHT_PX + 16
        })
      })
    }
    useManuscriptDocStore.getState().consumeScrollRequest(documentId, scrollRequest.nonce)
  }, [scrollRequest, settled, documentId])

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

  // The shared doc session's dirty flag — one source of truth with the raw
  // editor tab on the same file, exactly as the manuscript tab reads it.
  const dirty = useDocSessionMeta(doc?.file == null ? '' : `${rootDir}/manuscript/${doc.file}`)?.dirty ?? false

  const settingsStyle = manuscriptStyleVars({
    contentWidthCh,
    fontSizePx,
    fontFamily,
    lineHeight,
    editorTheme
  })

  if (error !== null && doc === null) return <div className="letter letter--empty">{error}</div>
  if (doc === null || meta === null) return <div className="letter letter--empty">Loading…</div>

  return (
    <div ref={wrapRef} className="mstab">
      <div
        ref={rootRef}
        className={`msdoc msdoc--${mode} editor-tab ${editorThemeClass(editorTheme)}`}
        style={settingsStyle}
      >
        <div className="msdoc__toolbar">
          {dirty && <span className="msdoc__dirty" aria-hidden="true" />}
          <SegmentedControl
            className="msdoc__modes"
            label="View"
            value={mode}
            options={DOC_MODE_OPTIONS}
            onChange={pickMode}
          />
          <RailToggleButton docPath={doc.file} />
          <LetterExportButton
            rootDir={rootDir}
            documentId={documentId}
            outputName={outputNameFor(doc)}
            // Required only, matching what the exporter refuses over: an
            // optional assertion the author left alone is a choice, not a gap.
            unanswered={(profile?.letters?.assertions ?? [])
              .filter((req) => req.stance === 'required')
              .map((req) => req.id)
              .filter((id) => !assertionAnswered(assertionFor(meta, id)))}
          />
          <button
            className="editor-tab__gear"
            onClick={() => setSettingsOpen((open) => !open)}
            title="Letter appearance"
            aria-label="Letter appearance settings"
          >
            <GearIcon />
          </button>
          {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
        </div>
        {doc.file !== null && <DivergenceBanner path={`${rootDir}/manuscript/${doc.file}`} />}
        <ReviewBar sectionPath={doc.file} getView={getEditorView} />

        {mode === 'pages' ? (
          <DocumentPages source={{ kind: 'letter', documentId }} />
        ) : (
        <div className="msdoc__body">
          <div className="msdoc__page">
            <header className="letter__head">
              <div>
                <h2>{doc.title}</h2>
                <span className="letter__sub">
                  {meta.letterKind} · addressed to {profile?.journalName ?? meta.targetProfileId}
                </span>
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

            <div className={`letter__editor${draftRun === undefined ? '' : ' is-drafting'}`}>
              {doc.file !== null && (
                <ManuscriptEditor
                  ref={editorRef}
                  rootDir={rootDir}
                  documentId={doc.id}
                  contentPath={doc.file}
                  live={mode === 'reading'}
                  onSettled={setSettled}
                  onOutlineChange={(outline) =>
                    useManuscriptDocStore.getState().setOutline(documentId, outline)
                  }
                />
              )}
            </div>
          </div>
        </div>
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

      {mode !== 'pages' && doc.file !== null && (
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
  )
}

/**
 * The letter's own Export — the manuscript's button, in the manuscript's
 * place on the toolbar, wired to the letter exporter rather than the journal
 * pipeline (main/services/export-letter.ts). A letter has no figures to
 * rasterize and no submission format to satisfy, so this asks the one
 * question that has an answer: which file type.
 *
 * A refusal is a real outcome here, not a failure: the exporter will not
 * write a letter that still carries an unanswered assertion, and that
 * sentence is what the status note shows.
 */
function LetterExportButton({
  rootDir,
  documentId,
  outputName,
  unanswered
}: {
  rootDir: string
  documentId: string
  outputName: string
  /** Assertion ids this venue requires that the sidecar has no answer for. */
  unanswered: readonly string[]
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // The format the author picked while assertions are still unanswered —
  // held until they say whether to export anyway.
  const [confirming, setConfirming] = useState<'pdf' | 'docx' | 'html' | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const run = async (format: 'pdf' | 'docx' | 'html', acknowledge: boolean): Promise<void> => {
    setConfirming(null)
    setBusy(true)
    try {
      const { path } = await window.suna.invoke('export:letter', {
        dir: rootDir,
        documentId,
        format,
        outputName,
        acknowledgeUnanswered: acknowledge
      })
      // The shared export toast (export/exportToast.ts), same as every other
      // export in the app: it OFFERS Open / Reveal rather than popping a
      // Finder window, because exporting is often the second of three (pdf,
      // docx, html) and a folder per format is noise.
      notifyExported(
        path,
        acknowledge && unanswered.length > 0
          ? `${unanswered.length} assertion${unanswered.length === 1 ? '' : 's'} still unanswered`
          : undefined
      )
    } catch (err) {
      useUiStore
        .getState()
        .setStatusNote(`Letter export failed — ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const pick = (format: 'pdf' | 'docx' | 'html'): void => {
    if (unanswered.length > 0) {
      setConfirming(format)
      return
    }
    void run(format, false)
  }

  return (
    <span className="docs__new-wrap">
      <button
        ref={btnRef}
        className="msdoc__export-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={busy || rootDir === ''}
        title="Export this letter as PDF, Word or a web page"
      >
        {busy ? 'Exporting…' : 'Export…'}
      </button>
      {open && confirming === null && btnRef.current !== null && (
        <NewDocumentMenu
          anchorEl={btnRef.current}
          onClose={() => setOpen(false)}
          items={[
            { label: 'PDF', onSelect: () => pick('pdf') },
            { label: 'Word (.docx)', onSelect: () => pick('docx') },
            { label: 'Web page (.html)', onSelect: () => pick('html') }
          ]}
        />
      )}
      {confirming !== null && (
        <LetterExportConfirm
          unanswered={unanswered}
          onCancel={() => {
            setConfirming(null)
            setOpen(false)
          }}
          onConfirm={() => {
            setOpen(false)
            void run(confirming, true)
          }}
        />
      )}
    </span>
  )
}

/**
 * The acknowledgement.
 *
 * An unanswered assertion is a real gap, so it is named rather than counted
 * away — but it is not a reason to withhold the author's own file. A draft
 * for a co-author, or a letter whose declarations go in the submission
 * portal, is a legitimate thing to export; what SUNA will not do is write the
 * missing sentence, so the exported letter simply goes without it.
 */
function LetterExportConfirm({
  unanswered,
  onCancel,
  onConfirm
}: {
  unanswered: readonly string[]
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <>
      <div className="docs__menu-scrim" onClick={onCancel} role="presentation" />
      <div className="lxconfirm" role="dialog" aria-label="Export with unanswered assertions">
        <p className="lxconfirm__lead">
          {unanswered.length} assertion{unanswered.length === 1 ? '' : 's'} still unanswered:
        </p>
        <p className="lxconfirm__ids">{unanswered.join(', ')}</p>
        <p className="lxconfirm__note">
          The exported letter will simply go without {unanswered.length === 1 ? 'it' : 'them'} —
          SUNA never writes an assertion for you.
        </p>
        <div className="lxconfirm__row">
          <button className="lxconfirm__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="lxconfirm__go" onClick={onConfirm}>
            Export anyway
          </button>
        </div>
      </div>
    </>
  )
}

/** `letters/cover-letter-science.md` -> `cover-letter-science`. */
function outputNameFor(doc: DocumentEntry): string {
  const base = doc.file === null ? doc.id : (doc.file.split('/').pop() ?? doc.id)
  return base.replace(/\.md$/, '')
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
