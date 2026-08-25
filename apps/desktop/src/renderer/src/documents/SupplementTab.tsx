import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { EditorView } from '@codemirror/view'
import type { OutlineSection } from '@suna/markdown'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { ManuscriptEditor, type ManuscriptEditorHandle } from '../manuscript/ManuscriptEditor'
import { ReferencesBlock } from '../manuscript/ReferencesBlock'
import { TitlePage } from '../manuscript/TitlePage'
import { manuscriptStyleVars } from '../manuscript/msdocStyle'
import { CommentsRail } from '../comments/CommentsRail'
import { RailToggleButton } from '../comments/RailToggleButton'
import { useCommentsStore } from '../state/comments'
import { docSlice, useManuscriptDocStore } from '../state/manuscriptDoc'
import { useDocSessionMeta } from '../state/docSessions'
import { useManuscriptStore } from '../state/manuscript'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { openExportTab } from '../state/dock'
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
import '../editor/editor.css'
import '../manuscript/manuscript.css'
import './documents.css'

/** .msdoc__toolbar's height — kept clear when scrolling to a heading. */
const TOOLBAR_HEIGHT_PX = 40
/** A heading is "active" once its top is within this band below the viewport top. */
const ACTIVE_BAND_PX = 96

/**
 * The Supplementary Information tab.
 *
 * ManuscriptTab's shape: the supplement is the same
 * instrument (live-preview CodeMirror, the same typography settings, the same
 * reading/source/pages modes, the same comments rail) over
 * manuscript/supplementary.md, and it publishes its outline and scroll-spy to
 * the SAME per-document store the manuscript does — which is what makes it a
 * document in the sidebar rather than a file in the Explorer.
 *
 * Its reference list is its own: the supplement's citations are numbered by
 * first appearance IN the supplement, restarting at [1] against the same
 * references.bib (export-content.ts's buildSupplementContent), so the block is
 * titled Supplementary References.
 */
export function SupplementTab({ api, params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')
  const documentId = String(params['documentId'] ?? 'supplement')
  const contentPath = String(params['file'] ?? 'supplementary.md')
  const title = String(params['title'] ?? 'Supplementary Information')

  const projectRoot = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const authors = useManuscriptStore((s) => s.authors)
  const refresh = useManuscriptStore((s) => s.refresh)
  const comments = useCommentsStore((s) => s.comments)

  const contentWidthCh = useEditorSettings((s) => s.contentWidthCh)
  const fontSizePx = useEditorSettings((s) => s.fontSizePx)
  const fontFamily = useEditorSettings((s) => s.fontFamily)
  const lineHeight = useEditorSettings((s) => s.lineHeight)
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  const wrapRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ManuscriptEditorHandle>(null)
  const [settled, setSettled] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const getEditorView = useCallback((): EditorView | null => editorRef.current?.getView() ?? null, [])
  const getScrollElement = useCallback((): HTMLElement | null => rootRef.current, [])

  const absPath = `${rootDir}/manuscript/${contentPath}`
  const dirty = useDocSessionMeta(absPath)?.dirty ?? false
  useEffect(() => {
    try {
      api.setTitle(dirty ? `${title} •` : title)
    } catch {
      // panel already disposed (dock unmount is deferred) — nothing to retitle
    }
  }, [dirty, api, title])

  const defaultMode = useResolved('editor.defaultMode').value as EditorViewMode
  const [mode, setMode] = useState<DocViewMode>(() => getResolved('editor.defaultMode').value)
  const userPickedModeRef = useRef(false)

  const pickMode = useCallback((next: DocViewMode): void => {
    userPickedModeRef.current = true
    editorRef.current?.setLive(next === 'reading')
    setMode(next)
  }, [])

  const toggleMode = useCallback((): void => {
    userPickedModeRef.current = true
    setMode((current) => {
      const next = nextDocMode(current)
      editorRef.current?.setLive(next === 'reading')
      return next
    })
  }, [])

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

  // Announce mount and frontmost state so the Documents sidebar's outline
  // follows the supplement rather than staying on the manuscript.
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

  const outline = useManuscriptDocStore((s) => docSlice(s, documentId).outline)
  const handleOutlineChange = useCallback(
    (next: OutlineSection[]): void => {
      useManuscriptDocStore.getState().setOutline(documentId, next)
    },
    [documentId]
  )

  // scroll-spy — the manuscript tab's rule: only headings inside CodeMirror's
  // rendered viewport have trustworthy coordinates, so anything before it
  // counts as above the band and anything after it as below.
  const recalcActive = useCallback((): void => {
    const view = editorRef.current?.getView()
    const container = rootRef.current
    if (!view || !container || outline.length === 0) return
    const containerRect = container.getBoundingClientRect()
    if (containerRect.height === 0) return
    const { from, to } = view.viewport
    let active: number | null = null
    for (let i = 0; i < outline.length; i++) {
      const pos = outline[i]!.headingFrom
      if (pos < from) {
        active = i
        continue
      }
      if (pos > to) break
      const coords = view.coordsAtPos(pos)
      if (coords === null) continue
      const top = coords.top - containerRect.top
      if (top > ACTIVE_BAND_PX) break
      active = i
    }
    if (active !== null) useManuscriptDocStore.getState().setActiveSectionIndex(documentId, active)
  }, [outline, documentId])

  useEffect(() => {
    editorRef.current?.getView()?.requestMeasure()
    recalcActive()
  }, [mode, recalcActive])

  useEffect(() => {
    const container = rootRef.current
    if (!container) return
    let scheduled = false
    const onScroll = (): void => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        recalcActive()
      })
    }
    const resizeObserver = new ResizeObserver(() => {
      recalcActive()
    })
    resizeObserver.observe(container)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('scroll', onScroll)
    }
  }, [recalcActive])

  // manuscript.json supplies the figure/table manifests the reference block
  // numbers cross-references against — the supplement embeds the project's
  // figures, it does not own a second set.
  useEffect(() => {
    void refresh()
  }, [refresh, rootDir, saveBump])

  // Outline click → scroll, held until the editor has settled.
  const scrollRequest = useManuscriptDocStore((s) => docSlice(s, documentId).scrollRequest)
  useEffect(() => {
    if (scrollRequest === null || !settled) return
    const view = editorRef.current?.getView()
    const section = outline[scrollRequest.index]
    if (view && section !== undefined) {
      view.dispatch({
        effects: EditorView.scrollIntoView(section.headingFrom, {
          y: 'start',
          yMargin: TOOLBAR_HEIGHT_PX + 16
        })
      })
    }
    useManuscriptDocStore.getState().consumeScrollRequest(documentId, scrollRequest.nonce)
  }, [scrollRequest, settled, outline, documentId])

  const documentComments = useMemo(
    () => comments.filter((c) => c.target.kind === 'section' && c.target.path === contentPath),
    [comments, contentPath]
  )

  const settingsStyle = manuscriptStyleVars({
    contentWidthCh,
    fontSizePx,
    fontFamily,
    lineHeight,
    editorTheme
  })

  const stale = projectRoot !== null && projectRoot !== rootDir

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
          <RailToggleButton docPath={contentPath} />
          <button
            className="msdoc__export-btn"
            onClick={() => !stale && openExportTab(rootDir, { kind: 'supplement' })}
            disabled={stale}
            title="Export as Word or PDF"
          >
            Export…
          </button>
          <button
            className="editor-tab__gear"
            onClick={() => setSettingsOpen((open) => !open)}
            title="Supplement appearance"
            aria-label="Supplement appearance settings"
          >
            <GearIcon />
          </button>
          {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
        </div>
        <DivergenceBanner path={absPath} />
        <ReviewBar sectionPath={contentPath} getView={getEditorView} />

        {mode === 'pages' && !stale ? (
          <DocumentPages source={{ kind: 'supplement' }} />
        ) : (
          <div className="msdoc__body">
            <div className="msdoc__page">
              {stale ? (
                <p className="msdoc__hint">
                  This supplement belongs to a project that is no longer open.
                </p>
              ) : (
                <>
                  {manuscript !== null && (
                    <>
                      {/* The supplement's cover is the manuscript's title page
                          cut to what the supplement export writes: the title
                          under "Supplementary Information:" and the SAME
                          byline. Read-only — the fields on it belong to the
                          manuscript, and that is where they are edited. */}
                      <TitlePage
                        manuscript={manuscript}
                        authors={authors.authors}
                        affiliations={authors.affiliations}
                        variant="supplement"
                      />
                      <div className="msdoc__rule" />
                    </>
                  )}
                  <ManuscriptEditor
                    documentId={documentId}
                    ref={editorRef}
                    rootDir={rootDir}
                    contentPath={contentPath}
                    live={mode === 'reading'}
                    onSettled={setSettled}
                    onOutlineChange={handleOutlineChange}
                  />
                  {manuscript !== null && (
                    <>
                      <div className="msdoc__rule" />
                      <ReferencesBlock
                        documentId={documentId}
                        rootDir={rootDir}
                        manuscriptFile={contentPath}
                        figures={manuscript.figures}
                        tables={manuscript.tables}
                        bibliography={manuscript.bibliography}
                        label="Supplementary References"
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {mode !== 'pages' && !stale && (
        <CommentsRail
          comments={documentComments}
          docPath={contentPath}
          getView={getEditorView}
          getScrollElement={getScrollElement}
        />
      )}
    </div>
  )
}
