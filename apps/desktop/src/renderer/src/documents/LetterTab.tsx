import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { EditorView } from '@codemirror/view'
import type { CoverLetterMeta, DocumentEntry } from '@suna/core'
import { getBundledProfile } from '@suna/formatter'
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
import { openExportTab } from '../state/dock'
import { editorThemeClass } from '../editor/themes'
import { SettingsPopover } from '../editor/SettingsPopover'
import { GearIcon } from '../editor/GearIcon'
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
 * ManuscriptTab's shape minus the title page. A letter is plain prose now —
 * the assertion sidecar is retired — so this tab is the editor, the preview,
 * and an Export button that funnels into the unified export page, where the
 * venue's published letter requirements and the letter checker's advisory
 * findings live.
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
          <button
            className="msdoc__export-btn"
            onClick={() => openExportTab(rootDir, { kind: 'letter', id: documentId })}
            disabled={rootDir === ''}
            title="Export this letter from the export page"
          >
            Export…
          </button>
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
